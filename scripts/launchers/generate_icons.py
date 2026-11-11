#!/usr/bin/env python3
"""Generate the sEEGmap launcher icons: macOS .icns, or Windows .ico.

    generate_icons.py <outdir>          # start.icns / stop.icns / restart.icns
    generate_icons.py <outdir> --ico    # start.ico  / stop.ico  / restart.ico

Pure stdlib: no Pillow, no downloads. Icons are rendered with signed-distance
fields + smoothstep coverage so edges are analytically anti-aliased, then
box-downsampled (integer ratios) to every size the container wants. The .icns
path shells out to Apple's `iconutil`; the .ico path is written directly
(PNG-compressed entries, which Windows has accepted since Vista), so it runs
anywhere.

Three glyphs on a rounded "squircle-ish" tile:
  start   -> green tile, white play triangle
  stop    -> red tile,   white rounded square
  restart -> amber tile, white circular arrow (clockwise, open at the top right)
"""
import math
import os
import sys
import zlib
import struct
import subprocess

RES = 1024  # master render size == largest iconset PNG (512@2x)


# ---------- PNG writer (RGBA, 8-bit) ----------
def png_bytes(w, h, rgba):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def write_png(path, w, h, rgba):
    with open(path, "wb") as f:
        f.write(png_bytes(w, h, rgba))


# ---------- math helpers ----------
def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def mix(a, b, t):
    return a + (b - a) * t


def sd_round_rect(px, py, cx, cy, hx, hy, r):
    """Signed distance to an axis-aligned rounded rect centred at (cx,cy)."""
    qx = abs(px - cx) - hx + r
    qy = abs(py - cy) - hy + r
    ax = qx if qx > 0 else 0.0
    ay = qy if qy > 0 else 0.0
    outside = (ax * ax + ay * ay) ** 0.5
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def sd_convex(px, py, edges):
    """Approx signed distance to a convex polygon given (ax,ay,nx,ny) edges
    with outward unit normals. Positive outside, negative inside."""
    d = -1e9
    for ax, ay, nx, ny in edges:
        d = max(d, (px - ax) * nx + (py - ay) * ny)
    return d


def triangle_edges(p0, p1, p2):
    """Outward-normal edges for a triangle. Winding-agnostic: for each edge the
    outward normal is chosen as the one pointing away from the centroid."""
    pts = [p0, p1, p2]
    gx = (p0[0] + p1[0] + p2[0]) / 3.0
    gy = (p0[1] + p1[1] + p2[1]) / 3.0
    edges = []
    for i in range(3):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % 3]
        ex, ey = bx - ax, by - ay
        nx, ny = ey, -ex
        L = (nx * nx + ny * ny) ** 0.5 or 1.0
        nx, ny = nx / L, ny / L
        mx, my = (ax + bx) / 2.0, (ay + by) / 2.0
        if (mx - gx) * nx + (my - gy) * ny < 0:  # points inward -> flip
            nx, ny = -nx, -ny
        edges.append((ax, ay, nx, ny))
    return edges


# ---------- render one master image ----------
def sd_arc(px, py, cx, cy, radius, a0, sweep, half_w):
    """Signed distance to a round-capped circular arc of angular width `sweep`
    starting at angle `a0` (radians, screen coords: y down, so increasing
    angle runs clockwise). Points inside the sweep measure against the ring;
    the rest measure against the nearer end-cap disc."""
    dx, dy = px - cx, py - cy
    ang = (math.atan2(dy, dx) - a0) % (2 * math.pi)
    if ang <= sweep:
        return abs(math.hypot(dx, dy) - radius) - half_w
    ex0, ey0 = cx + radius * math.cos(a0), cy + radius * math.sin(a0)
    ex1, ey1 = cx + radius * math.cos(a0 + sweep), cy + radius * math.sin(a0 + sweep)
    return min(math.hypot(px - ex0, py - ey0), math.hypot(px - ex1, py - ey1)) - half_w


def render(kind, top, bottom):
    """kind: 'play', 'square' or 'arrow'. top/bottom: gradient RGB tuples."""
    m = RES
    buf = bytearray(m * m * 4)
    aa = 1.2  # edge softness in pixels

    margin = 0.085 * m
    cx = cy = m / 2.0
    hx = hy = (m - 2 * margin) / 2.0
    tile_r = 0.2235 * (2 * hx)  # macOS-ish corner radius

    # symbol geometry
    if kind == "play":
        w = 0.34 * m
        h = 0.205 * m
        sx = cx + 0.03 * m  # optical nudge right
        tri = triangle_edges(
            (sx - w * 0.42, cy - h),
            (sx - w * 0.42, cy + h),
            (sx + w * 0.58, cy),
        )
        sym_round = 0.028 * m  # round the triangle corners
    elif kind == "arrow":
        # Ring open at the top right; the arrowhead sits on the clockwise end
        # and points along the direction of travel.
        ring_r = 0.20 * m
        ring_w = 0.036 * m  # half stroke width
        a0 = math.radians(-25)
        sweep = math.radians(265)
        a1 = a0 + sweep
        ex, ey = cx + ring_r * math.cos(a1), cy + ring_r * math.sin(a1)
        tx, ty = -math.sin(a1), math.cos(a1)  # unit tangent (clockwise)
        nx, ny = math.cos(a1), math.sin(a1)   # unit outward normal
        head_l, head_w = 0.10 * m, 0.075 * m
        # Base sits a little behind the arc end so the round cap is covered.
        bx, by = ex - tx * 0.035 * m, ey - ty * 0.035 * m
        tri = triangle_edges(
            (bx + nx * head_w, by + ny * head_w),
            (bx - nx * head_w, by - ny * head_w),
            (bx + tx * head_l, by + ty * head_l),
        )
        sym_round = 0.012 * m
    else:
        side = 0.30 * m
        sq_h = side / 2.0
        sq_r = 0.055 * m

    for y in range(m):
        t = y / (m - 1)
        gr = mix(top[0], bottom[0], t)
        gg = mix(top[1], bottom[1], t)
        gb = mix(top[2], bottom[2], t)
        row = y * m * 4
        for x in range(m):
            px = x + 0.5
            py = y + 0.5

            d_tile = sd_round_rect(px, py, cx, cy, hx, hy, tile_r)
            tile_cov = clamp(0.5 - d_tile / aa, 0.0, 1.0)

            i = row + x * 4
            if tile_cov <= 0.0:
                # transparent, but keep rgb = gradient so downsample fringe is clean
                buf[i] = int(gr); buf[i + 1] = int(gg); buf[i + 2] = int(gb); buf[i + 3] = 0
                continue

            if kind == "play":
                d_sym = sd_convex(px, py, tri) - sym_round
            elif kind == "arrow":
                d_sym = min(sd_arc(px, py, cx, cy, ring_r, a0, sweep, ring_w),
                            sd_convex(px, py, tri) - sym_round)
            else:
                d_sym = sd_round_rect(px, py, cx, cy, sq_h, sq_h, sq_r)
            sym_cov = clamp(0.5 - d_sym / aa, 0.0, 1.0)

            r = mix(gr, 255.0, sym_cov)
            g = mix(gg, 255.0, sym_cov)
            b = mix(gb, 255.0, sym_cov)
            buf[i] = int(r + 0.5)
            buf[i + 1] = int(g + 0.5)
            buf[i + 2] = int(b + 0.5)
            buf[i + 3] = int(tile_cov * 255 + 0.5)
    return buf


def downsample(master, ts):
    ratio = RES // ts
    if ratio == 1:
        return bytes(master)
    out = bytearray(ts * ts * 4)
    n = ratio * ratio
    for oy in range(ts):
        for ox in range(ts):
            r = g = b = a = 0
            for dy in range(ratio):
                base = ((oy * ratio + dy) * RES + ox * ratio) * 4
                for dx in range(ratio):
                    j = base + dx * 4
                    r += master[j]; g += master[j + 1]
                    b += master[j + 2]; a += master[j + 3]
            o = (oy * ts + ox) * 4
            out[o] = r // n; out[o + 1] = g // n
            out[o + 2] = b // n; out[o + 3] = a // n
    return bytes(out)


ICONSET_MAP = {
    16: ["icon_16x16.png"],
    32: ["icon_16x16@2x.png", "icon_32x32.png"],
    64: ["icon_32x32@2x.png"],
    128: ["icon_128x128.png"],
    256: ["icon_128x128@2x.png", "icon_256x256.png"],
    512: ["icon_256x256@2x.png", "icon_512x512.png"],
    1024: ["icon_512x512@2x.png"],
}


def build_icns(kind, top, bottom, out_icns, workdir):
    print(f"  rendering master for {kind}…", flush=True)
    master = render(kind, top, bottom)
    iconset = os.path.join(workdir, f"{kind}.iconset")
    os.makedirs(iconset, exist_ok=True)
    for size, names in ICONSET_MAP.items():
        img = downsample(master, size)
        for name in names:
            write_png(os.path.join(iconset, name), size, size, img)
        print(f"    size {size} done", flush=True)
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out_icns], check=True)
    print(f"  wrote {out_icns}", flush=True)


# Windows shell sizes: 16/32 for lists and the taskbar, 64/128 for large
# tiles, 256 for the Explorer "extra large" view. All integer ratios of RES.
ICO_SIZES = (16, 32, 64, 128, 256)


def build_ico(kind, top, bottom, out_ico):
    """Write a multi-size .ico with PNG-compressed entries (no iconutil)."""
    print(f"  rendering master for {kind}…", flush=True)
    master = render(kind, top, bottom)
    images = [(size, png_bytes(size, size, downsample(master, size)))
              for size in ICO_SIZES]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries = bytearray()
    for size, data in images:
        dim = 0 if size >= 256 else size  # 0 encodes 256 in the one-byte field
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(out_ico, "wb") as f:
        f.write(header + entries + b"".join(data for _, data in images))
    print(f"  wrote {out_ico}", flush=True)


# (kind, top colour, bottom colour, basename). Apple system green / red /
# orange, top brighter than bottom; the same palette on both platforms.
ICONS = (
    ("play",   (52, 199, 89),  (36, 138, 61), "start"),
    ("square", (255, 69, 58),  (193, 35, 27), "stop"),
    ("arrow",  (255, 159, 10), (204, 118, 0), "restart"),
)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ico = "--ico" in sys.argv[1:]
    outdir = args[0] if args else "."
    os.makedirs(outdir, exist_ok=True)
    for kind, top, bottom, name in ICONS:
        if ico:
            build_ico(kind, top, bottom, os.path.join(outdir, f"{name}.ico"))
        else:
            build_icns(kind, top, bottom, os.path.join(outdir, f"{name}.icns"), outdir)
    print("done.")
