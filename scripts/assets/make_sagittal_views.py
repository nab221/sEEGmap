#!/usr/bin/env python3
"""Cut the four lateral / medial outlines for the Electrode view out of the Planner figure.

    python3 scripts/assets/make_sagittal_views.py

Reads public/brain-template-v2.png and the quadrant boxes in public/brain-regions-v2.json,
and writes public/view-{left,right}-{lateral,medial}.png. Pure stdlib: no Pillow.

The template has red guide lines baked in. They are repainted from the pixels on either
side of the line (left/right for a vertical line, above/below for a horizontal one), so
black outline strokes the lines cross are rejoined rather than broken -- a gap would let
the Electrode view's brain mask leak.

Prints, per image: file, size, and the non-white bounding box of the outline (used for
each view's mm-per-pixel in src/lib/axialViews.ts).
"""
import json
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLIC = os.path.join(ROOT, "public")

# Half-width of the anti-aliased fringe either side of a detected guide line, in px.
FRINGE = 5
# White margin added round each crop, so the outline never touches the image edge.
PAD = 24
# Anything at least this light on every channel is paper and becomes pure white.
PAPER_MIN = 238
# Darkest a guide line's grey edge gets; anything darker is outline and is kept.
STROKE_MAX = 110

VIEWS = [
    ("leftLateral", "view-left-lateral.png"),
    ("leftMedial", "view-left-medial.png"),
    ("rightLateral", "view-right-lateral.png"),
    ("rightMedial", "view-right-medial.png"),
]


def read_png(path):
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos = 8
    idat = b""
    width = height = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, depth, color, _c, _f, interlace = struct.unpack(">IIBBBBB", body)
            assert depth == 8 and color in (2, 6) and interlace == 0, "need 8-bit RGB(A), non-interlaced"
            bpp = 4 if color == 6 else 3
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = width * bpp
    out = bytearray(height * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(height):
        ftype = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        if ftype == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 0xFF
        elif ftype == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif ftype == 3:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif ftype == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        out[y * stride : (y + 1) * stride] = line
        prev = line
    # Flatten to RGB on white.
    rgb = bytearray(width * height * 3)
    for k in range(width * height):
        if bpp == 4:
            r, g, b, a = out[4 * k : 4 * k + 4]
            rgb[3 * k] = (r * a + 255 * (255 - a)) // 255
            rgb[3 * k + 1] = (g * a + 255 * (255 - a)) // 255
            rgb[3 * k + 2] = (b * a + 255 * (255 - a)) // 255
        else:
            rgb[3 * k : 3 * k + 3] = out[3 * k : 3 * k + 3]
    return width, height, rgb


def write_png(path, width, height, rgb):
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        raw += rgb[y * stride : (y + 1) * stride]

    def chunk(t, body):
        return struct.pack(">I", len(body)) + t + body + struct.pack(">I", zlib.crc32(t + body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def cell_box(quads, key, width, height):
    """The quadrant's whole cell: out to halfway across the gap to its neighbours (or to
    the image edge). The bbox alone clips the tips of some outlines."""
    x0, y0, x1, y1 = quads[key]["bbox"]
    side, view = ("left" if key.startswith("left") else "right"), ("Lateral" if key.endswith("Lateral") else "Medial")
    other_side = quads[("right" if side == "left" else "left") + view]["bbox"]
    other_view = quads[side + ("Medial" if view == "Lateral" else "Lateral")]["bbox"]
    if side == "left":
        x0, x1 = 0, (x1 + other_side[0]) // 2
    else:
        x0, x1 = (other_side[2] + x0) // 2, width
    if view == "Lateral":
        y0, y1 = 0, (y1 + other_view[1]) // 2
    else:
        y0, y1 = (other_view[3] + y0) // 2, height
    return x0, y0, x1, y1


def crop(width, rgb, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    out = bytearray(w * h * 3)
    for y in range(h):
        src = ((y0 + y) * width + x0) * 3
        out[y * w * 3 : (y + 1) * w * 3] = rgb[src : src + w * 3]
    return w, h, out


def whiten_paper(rgb):
    """The template's paper is slightly off-white; make it pure white so the outline sits
    on the export's white page without a faint box round it."""
    for k in range(0, len(rgb), 3):
        if rgb[k] >= PAPER_MIN and rgb[k + 1] >= PAPER_MIN and rgb[k + 2] >= PAPER_MIN:
            rgb[k] = rgb[k + 1] = rgb[k + 2] = 255


def pad(w, h, rgb):
    pw, ph = w + 2 * PAD, h + 2 * PAD
    out = bytearray(b"\xff" * (pw * ph * 3))
    for y in range(h):
        dst = ((y + PAD) * pw + PAD) * 3
        out[dst : dst + w * 3] = rgb[y * w * 3 : (y + 1) * w * 3]
    return pw, ph, out


def is_red(rgb, k):
    r, g, b = rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]
    return r > 150 and r - max(g, b) > 80


def guide_bands(w, h, rgb, vertical):
    """Columns (vertical) or rows holding a guide line, widened by FRINGE to take in its
    anti-aliased edge. A line counts when over a fifth of its pixels are guide-red."""
    n_lines, n_along = (w, h) if vertical else (h, w)
    hit = []
    for i in range(n_lines):
        count = 0
        for j in range(n_along):
            k = j * w + i if vertical else i * w + j
            count += is_red(rgb, k)
        hit.append(count > n_along // 5)
    band = [False] * n_lines
    for i, on in enumerate(hit):
        if on:
            for d in range(-FRINGE, FRINGE + 1):
                if 0 <= i + d < n_lines:
                    band[i + d] = True
    return band


def tinted(rgb, k):
    """Any red cast at all: the guide line's core and its pinkish edge."""
    r, g, b = rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]
    return r - max(g, b) > 20


def repaint(w, h, rgb, src, band, vertical):
    """Repaint red-tinted pixels inside a band from the nearest untinted pixels on either
    side across the line, blended by distance, so strokes crossing the line join up.
    Untinted pixels (the outline itself, white paper) are left alone."""
    n_lines = w if vertical else h
    n_along = h if vertical else w

    def key(line, j):
        return j * w + line if vertical else line * w + j

    for line in range(n_lines):
        if not band[line]:
            continue
        for j in range(n_along):
            k = key(line, j)
            if not tinted(src, k):
                continue
            a = line - 1
            while a >= 0 and band[a] and tinted(src, key(a, j)):
                a -= 1
            b = line + 1
            while b < n_lines and band[b] and tinted(src, key(b, j)):
                b += 1
            pa = src[3 * key(a, j) : 3 * key(a, j) + 3] if a >= 0 else None
            pb = src[3 * key(b, j) : 3 * key(b, j) + 3] if b < n_lines else None
            pa = pa or pb or b"\xff\xff\xff"
            pb = pb or pa
            t = (line - a) / (b - a)
            for c in range(3):
                rgb[3 * k + c] = round(pa[c] * (1 - t) + pb[c] * t)


def coloured(px):
    return max(px) - min(px) > 30


def clear_fringe(w, h, rgb, band, vertical):
    """Clear the grey dotted edge a guide line leaves behind. Every band pixel lighter than
    a stroke (> STROKE_MAX) is replaced by the lighter of the pixels just outside the band,
    so paper turns white and shading continues. Darker pixels are outline and are kept."""
    n_lines = w if vertical else h
    n_along = h if vertical else w
    src = bytes(rgb)

    def key(line, j):
        return j * w + line if vertical else line * w + j

    line = 0
    while line < n_lines:
        if not band[line]:
            line += 1
            continue
        a = line - 1
        b = line
        while b < n_lines and band[b]:
            b += 1
        for j in range(n_along):
            pa = src[3 * key(a, j) : 3 * key(a, j) + 3] if a >= 0 else None
            pb = src[3 * key(b, j) : 3 * key(b, j) + 3] if b < n_lines else None
            pa = pa or pb or b"\xff\xff\xff"
            pb = pb or pa
            for m in range(line, b):
                k = key(m, j)
                if coloured(pa) or coloured(pb):
                    # Shading: copy the nearer side, which keeps its texture continuous.
                    near = pa if (m - a) <= (b - m) else pb
                    rgb[3 * k : 3 * k + 3] = near
                    continue
                if min(src[3 * k : 3 * k + 3]) <= STROKE_MAX:
                    continue
                # Paper: the lighter side, so a stroke just outside the band can't smear in.
                for c in range(3):
                    rgb[3 * k + c] = max(pa[c], pb[c])
        line = b


def remove_red(w, h, rgb):
    vbands = guide_bands(w, h, rgb, True)
    hbands = guide_bands(w, h, rgb, False)
    once = bytearray(rgb)
    repaint(w, h, once, bytes(rgb), vbands, True)
    out = bytearray(once)
    repaint(w, h, out, bytes(once), hbands, False)
    clear_fringe(w, h, out, vbands, True)
    clear_fringe(w, h, out, hbands, False)
    return out


def outline_bbox(w, h, rgb, white_min=230):
    xs0, ys0, xs1, ys1 = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            k = 3 * (y * w + x)
            if rgb[k] < white_min or rgb[k + 1] < white_min or rgb[k + 2] < white_min:
                xs0, ys0, xs1, ys1 = min(xs0, x), min(ys0, y), max(xs1, x), max(ys1, y)
    return xs0, xs1, ys0, ys1


def main():
    width, height, rgb = read_png(os.path.join(PUBLIC, "brain-template-v2.png"))
    with open(os.path.join(PUBLIC, "brain-regions-v2.json")) as f:
        quads = json.load(f)["quadrants"]
    print("file, width, height, outline_x0, outline_x1, outline_y0, outline_y1")
    for key, name in VIEWS:
        w, h, part = crop(width, rgb, cell_box(quads, key, width, height))
        part = remove_red(w, h, part)
        w, h, part = pad(w, h, part)
        whiten_paper(part)
        write_png(os.path.join(PUBLIC, name), w, h, part)
        print(name, w, h, *outline_bbox(w, h, part, white_min=128), sep=", ")


if __name__ == "__main__":
    main()
