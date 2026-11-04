"""Generate PWA and native app icons from the canonical SVG design."""
from pathlib import Path
try:
    import cairosvg
except ImportError as exc:
    raise SystemExit("Install icon generator: python3 -m pip install -r offline/requirements.txt") from exc

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "icons" / "cat-gomoku.svg"
DEST = ROOT / "dist" / "icons"
ASSETS = ROOT / "assets"
DEST.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

for size in (192, 512, 1024):
    cairosvg.svg2png(url=str(SOURCE), write_to=str(DEST / f"icon-{size}.png"), output_width=size, output_height=size)
(ASSETS / "icon.png").write_bytes((DEST / "icon-1024.png").read_bytes())
print("Generated 192/512 PWA icons and 1024 native icon")
