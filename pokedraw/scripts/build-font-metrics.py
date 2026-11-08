"""Regenerate fixed glyph coordinates after changing font PNGs (requires Pillow)."""
from pathlib import Path
import hashlib
import json
from PIL import Image

root = Path(__file__).resolve().parents[1]
folder = root / 'public/fonts'
glyphs = (folder / 'scratch_glyphs.txt').read_text().rstrip('\r\n')
atlases = {}
for path in sorted(folder.glob('scratch_*.png')):
    image = Image.open(path).convert('RGBA')
    pixels = image.load()
    cells = []
    x = 0
    while x < image.width:
        while x < image.width and pixels[x, 0] == pixels[0, 0]:
            x += 1
        start = x
        while x < image.width and pixels[x, 0] != pixels[0, 0]:
            x += 1
        if x > start:
            cells.append([start, x - start])
    assert len(cells) == len(glyphs), (path, len(cells), len(glyphs))
    atlases[path.stem] = {'width': image.width, 'height': image.height,
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'cells': cells}
(root / 'public/font-metrics.js').write_text(
    '// Generated from original PNG bytes; never discover glyphs through browser pixel readback.\n'
    + 'export const FONT_METRICS=' + json.dumps({'glyphs': glyphs, 'atlases': atlases}, separators=(',', ':')) + ';\n')
