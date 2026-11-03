from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .encoding import encode_state
from .game import GomokuGame
from .tactical import analyze_tactical_evidence


Evaluator = Callable[[GomokuGame], dict[str, object]]


@dataclass(frozen=True)
class PUCTConfig:
    """Configuration for the baseline neural PUCT search."""

    simulations: int = 128
    c_puct: float = 1.25
    candidate_radius: int = 2
    tactical_prior_weights: tuple[float, float, float] = (0.25, 0.25, 0.15)
    dirichlet_alpha: float = 0.3
    root_noise_fraction: float = 0.25

    def __post_init__(self) -> None:
        if (
            isinstance(self.simulations, bool)
            or not isinstance(self.simulations, int)
            or self.simulations < 1
        ):
            raise ValueError("simulations must be a positive integer")

        if not math.isfinite(self.c_puct) or self.c_puct <= 0:
            raise ValueError("c_puct must be finite and positive")

        if (
            isinstance(self.candidate_radius, bool)
            or not isinstance(self.candidate_radius, int)
            or self.candidate_radius < 0
        ):
            raise ValueError("candidate_radius must be a non-negative integer")

        if len(self.tactical_prior_weights) != 3:
            raise ValueError("tactical_prior_weights must contain 3 values")

        if not all(
            math.isfinite(weight) and weight >= 0
            for weight in self.tactical_prior_weights
        ):
            raise ValueError("tactical prior weights must be finite and non-negative")

        if not math.isfinite(self.dirichlet_alpha) or self.dirichlet_alpha <= 0:
            raise ValueError("dirichlet_alpha must be finite and positive")

        if (
            not math.isfinite(self.root_noise_fraction)
            or not 0.0 <= self.root_noise_fraction <= 1.0
        ):
            raise ValueError("root_noise_fraction must be in [0, 1]")


@dataclass
class SearchNode:
    """A node whose value is always measured from its side-to-move perspective."""

    prior: float = 1.0
    visit_count: int = 0
    value_sum: float = 0.0
    children: dict[int, SearchNode] = field(default_factory=dict)
    expanded: bool = False
    terminal: bool = False
    terminal_value: float = 0.0
    forced_loss: bool = False

    @property
    def mean_value(self) -> float:
        if self.visit_count == 0:
            return 0.0
        return self.value_sum / self.visit_count


@dataclass(frozen=True)
class SearchResult:
    """Root decision and diagnostics returned by a PUCT search."""

    best_move: int | None
    visit_counts: dict[int, int]
    visit_policy: np.ndarray
    root_priors: dict[int, float]
    root_value: float
    simulations: int
    forced_loss: bool


class TorchEvaluator:
    """
    Adapter from GomokuGame to a PyTorch TEBA-Net-S model.

    The model is moved to the requested device and switched to eval mode.
    Inference uses torch.inference_mode() and returns CPU NumPy arrays so the
    search tree itself remains device-independent.
    """

    def __init__(self, model, device: str = "cpu") -> None:
        import torch

        self.torch = torch
        self.device = torch.device(device)
        self.model = model.to(self.device)
        self.model.eval()

    def __call__(self, game: GomokuGame) -> dict[str, object]:
        encoded = encode_state(
            game.board,
            current_player=game.current_player,
            last_move=game.last_move,
        )
        tensor = self.torch.from_numpy(encoded).unsqueeze(0).to(self.device)

        with self.torch.inference_mode():
            outputs = self.model(tensor)

        return {
            "policy_logits": outputs["policy_logits"][0].detach().cpu().numpy(),
            "value": float(outputs["value"][0].detach().cpu().item()),
            "tactical_logits": (
                outputs["tactical_logits"][0].detach().cpu().numpy()
            ),
        }


class PUCTSearch:
    """
    Neural PUCT search for standard 15x15 Gomoku.

    Selection:
        score(s, a) = -Q(child) + c_puct * P(a) * sqrt(N(parent)) / (1 + N(child))

    Q(child) is negated because child values are stored from the opponent's
    side-to-move perspective.

    The policy prior is masked to local legal candidates. Tactical-head logits
    provide a small additive prior adjustment. Exact one-ply wins and unique
    immediate blocks are enforced by the game-rule tactical analyzer, never
    by trusting learned tactical predictions.

    A position with two or more distinct opponent immediate-winning cells is
    marked as a forced loss, but legal candidate moves are retained so the
    engine can still return a move rather than treating the game as over.
    """

    def __init__(
        self,
        evaluator: Evaluator,
        config: PUCTConfig | None = None,
    ) -> None:
        if not callable(evaluator):
            raise TypeError("evaluator must be callable")

        self.evaluator = evaluator
        self.config = config or PUCTConfig()

    def _read_evaluation(
        self,
        game: GomokuGame,
    ) -> tuple[np.ndarray, float, np.ndarray]:
        outputs = self.evaluator(game)

        if not isinstance(outputs, dict):
            raise TypeError("evaluator must return a dictionary")

        try:
            policy = np.asarray(outputs["policy_logits"], dtype=np.float64)
            value = float(outputs["value"])
            tactical = np.asarray(
                outputs["tactical_logits"],
                dtype=np.float64,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(
                "evaluator must return policy_logits, value, and tactical_logits"
            ) from error

        if policy.shape != (225,):
            raise ValueError(
                f"policy_logits must have shape (225,), got {policy.shape}"
            )

        if tactical.shape != (3, 15, 15):
            raise ValueError(
                "tactical_logits must have shape (3, 15, 15), "
                f"got {tactical.shape}"
            )

        if not np.isfinite(policy).all() or not np.isfinite(tactical).all():
            raise ValueError("evaluator logits must all be finite")

        if not math.isfinite(value) or not -1.0 <= value <= 1.0:
            raise ValueError("evaluator value must be finite and in [-1, 1]")

        return policy, value, tactical

    def _candidate_moves(
        self,
        game: GomokuGame,
        evidence,
    ) -> list[int]:
        if evidence.win_now_moves:
            return list(evidence.win_now_moves)

        # If there is exactly one immediate opponent winning cell, occupying
        # it is the only move that prevents an immediate loss.
        if len(evidence.opponent_winning_moves) == 1:
            return list(evidence.opponent_winning_moves)

        # With multiple opponent winning cells no single move can block all
        # threats. Keep ordinary candidates so the search can choose the
        # least-bad move and report the forced-loss condition.
        actions = game.get_candidates(radius=self.config.candidate_radius)
        return actions if actions else game.legal_moves()

    def _make_priors(
        self,
        actions: list[int],
        policy_logits: np.ndarray,
        tactical_logits: np.ndarray,
    ) -> np.ndarray:
        weights = np.asarray(
            self.config.tactical_prior_weights,
            dtype=np.float64,
        )
        tactical_flat = tactical_logits.reshape(3, 225)

        adjusted_logits = policy_logits[np.asarray(actions, dtype=np.int64)].copy()
        adjusted_logits += weights @ tactical_flat[:, actions]

        adjusted_logits -= np.max(adjusted_logits)
        probabilities = np.exp(adjusted_logits)
        total = probabilities.sum()

        if not math.isfinite(float(total)) or total <= 0:
            return np.full(len(actions), 1.0 / len(actions), dtype=np.float64)

        return probabilities / total

    def _expand(self, game: GomokuGame, node: SearchNode) -> float:
        if game.done:
            node.expanded = True
            node.terminal = True
            # GomokuGame leaves current_player as the player who made the
            # winning move. From the conceptual next-player perspective the
            # terminal value is therefore -1 for a win, and 0 for a draw.
            node.terminal_value = 0.0 if game.is_draw else -1.0
            return node.terminal_value

        evidence = analyze_tactical_evidence(
            game.board,
            game.current_player,
        )
        actions = self._candidate_moves(game, evidence)

        if not actions:
            node.expanded = True
            node.terminal = True
            node.terminal_value = 0.0
            return 0.0

        policy_logits, value, tactical_logits = self._read_evaluation(game)
        priors = self._make_priors(actions, policy_logits, tactical_logits)

        node.children = {
            int(action): SearchNode(prior=float(prior))
            for action, prior in zip(actions, priors)
        }
        node.expanded = True
        node.forced_loss = bool(evidence.forced_loss)

        # Exact rule-derived tactical facts override an untrained or
        # miscalibrated value head for these two terminal-in-one-ply cases.
        if evidence.win_now_moves:
            return 1.0
        if evidence.forced_loss:
            return -1.0

        return value

    def _select_child(self, parent: SearchNode) -> tuple[int, SearchNode]:
        parent_scale = math.sqrt(max(1, parent.visit_count))
        best_action: int | None = None
        best_child: SearchNode | None = None
        best_score = -math.inf

        for action, child in parent.children.items():
            q_value = -child.mean_value
            exploration = (
                self.config.c_puct
                * child.prior
                * parent_scale
                / (1 + child.visit_count)
            )
            score = q_value + exploration

            if score > best_score:
                best_score = score
                best_action = action
                best_child = child

        if best_action is None or best_child is None:
            raise RuntimeError("cannot select a child from an empty node")

        return best_action, best_child

    def _apply_root_noise(
        self,
        root: SearchNode,
        rng: np.random.Generator,
    ) -> None:
        if not root.children or self.config.root_noise_fraction == 0:
            return

        actions = list(root.children)
        noise = rng.dirichlet(
            np.full(len(actions), self.config.dirichlet_alpha, dtype=np.float64)
        )
        fraction = self.config.root_noise_fraction

        for action, noise_value in zip(actions, noise):
            child = root.children[action]
            child.prior = (
                (1.0 - fraction) * child.prior
                + fraction * float(noise_value)
            )

    def _simulate(self, root_game: GomokuGame, root: SearchNode) -> None:
        game = root_game.clone()
        node = root
        path = [root]

        while True:
            if node.terminal:
                value = node.terminal_value
                break

            if not node.expanded:
                value = self._expand(game, node)
                break

            if not node.children:
                value = 0.0
                break

            action, child = self._select_child(node)
            result = game.play(action)
            path.append(child)

            if result.done:
                child.expanded = True
                child.terminal = True
                child.terminal_value = (
                    0.0 if result.winner is None else -1.0
                )
                value = child.terminal_value
                break

            node = child

            if not node.expanded:
                value = self._expand(game, node)
                break

        # Every edge changes the player perspective. A node's Q is stored
        # from that node's side-to-move perspective.
        for visited_node in reversed(path):
            visited_node.visit_count += 1
            visited_node.value_sum += value
            value = -value

    def search(
        self,
        game: GomokuGame,
        simulations: int | None = None,
        add_root_noise: bool = False,
        seed: int | None = None,
    ) -> SearchResult:
        """
        Run PUCT from the supplied game state.

        Root Dirichlet noise is opt-in and should normally be enabled only
        during self-play, not during evaluation or human-facing inference.
        """
        if not isinstance(game, GomokuGame):
            raise TypeError("game must be a GomokuGame instance")

        simulation_count = (
            self.config.simulations if simulations is None else simulations
        )
        if (
            isinstance(simulation_count, bool)
            or not isinstance(simulation_count, int)
            or simulation_count < 1
        ):
            raise ValueError("simulations must be a positive integer")

        root = SearchNode()
        initial_value = self._expand(game, root)

        if game.done or not root.children:
            return SearchResult(
                best_move=None,
                visit_counts={},
                visit_policy=np.zeros(225, dtype=np.float32),
                root_priors={},
                root_value=float(initial_value),
                simulations=0,
                forced_loss=root.forced_loss,
            )

        if add_root_noise:
            self._apply_root_noise(root, np.random.default_rng(seed))

        for _ in range(simulation_count):
            self._simulate(game, root)

        visit_counts = {
            action: child.visit_count
            for action, child in root.children.items()
        }
        root_priors = {
            action: child.prior
            for action, child in root.children.items()
        }

        visit_total = sum(visit_counts.values())
        visit_policy = np.zeros(225, dtype=np.float32)

        if visit_total > 0:
            for action, count in visit_counts.items():
                visit_policy[action] = count / visit_total
        else:
            for action, prior in root_priors.items():
                visit_policy[action] = prior

        best_move = max(
            root.children,
            key=lambda action: (
                root.children[action].visit_count,
                root.children[action].prior,
            ),
        )

        root_value = (
            -1.0
            if root.forced_loss
            else root.mean_value if root.visit_count else initial_value
        )

        return SearchResult(
            best_move=int(best_move),
            visit_counts=visit_counts,
            visit_policy=visit_policy,
            root_priors=root_priors,
            root_value=float(root_value),
            simulations=simulation_count,
            forced_loss=root.forced_loss,
        )

    @staticmethod
    def select_move(
        result: SearchResult,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> int | None:
        """
        Select from root visits.

        temperature=0 selects the most-visited action. Positive temperature
        samples from visit_count ** (1 / temperature), as used in self-play.
        """
        if result.best_move is None:
            return None

        if not math.isfinite(temperature) or temperature < 0:
            raise ValueError("temperature must be finite and non-negative")

        if temperature == 0:
            return result.best_move

        actions = np.asarray(list(result.visit_counts), dtype=np.int64)
        counts = np.asarray(
            [result.visit_counts[int(action)] for action in actions],
            dtype=np.float64,
        )

        if counts.sum() <= 0:
            probabilities = np.asarray(
                [result.root_priors[int(action)] for action in actions],
                dtype=np.float64,
            )
        else:
            probabilities = counts ** (1.0 / temperature)

        total = probabilities.sum()
        if total <= 0 or not math.isfinite(float(total)):
            return result.best_move

        probabilities /= total
        rng = np.random.default_rng(seed)
        return int(rng.choice(actions, p=probabilities))
