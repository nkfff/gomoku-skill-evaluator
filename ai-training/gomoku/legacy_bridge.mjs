import { createInterface } from "node:readline";
import { chooseAI } from "../../v4.0/src/engine.js";

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

for await (const line of input) {
  if (!line.trim()) continue;

  try {
    const request = JSON.parse(line);
    const result = chooseAI(
      request.board,
      request.level ?? "hard",
      {
        player: request.player,
        width: request.width,
        timeMs: request.time_ms,
        maxDepth: request.max_depth,
      },
    );

    process.stdout.write(JSON.stringify({
      index: result.index,
      reason: result.reason,
      nodes: result.nodes,
      depth: result.depth,
      elapsedMs: result.elapsedMs ?? 0,
    }) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }) + "\n");
  }
}
