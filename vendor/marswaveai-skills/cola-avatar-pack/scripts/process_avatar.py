#!/usr/bin/env python3
"""
Cola Avatar Pack Processor
Takes static PNGs, removes background if needed, and generates animated GIFs.
"""

import argparse
import os
import re
import sys
from collections import Counter, deque

from PIL import Image, ImageDraw, ImageFont


# Animation configs per emotion
ANIMATIONS = {
    'happy': {
        'type': 'bounce_squash',
        'frames': 8,
        'duration': 100,  # ms per frame
        'amplitude': 14,  # pixels
    },
    'sad': {
        'type': 'shrink_sink',
        'frames': 10,
        'duration': 180,
        'amplitude': 10,
    },
    'angry': {
        'type': 'swell_shake',
        'frames': 6,
        'duration': 70,
        'amplitude': 6,
    },
    'thinking': {
        'type': 'tilt_zoom',
        'frames': 8,
        'duration': 200,
        'amplitude': 3,
    },
}

OUTPUT_SIZE = 256      # High-res for sharing/saving (@2x)
DISPLAY_SIZE = 128     # For chat display
BRAND_NAME = 'ColaOS'


def _try_rembg(img):
    """Try to remove background using rembg CLI. Returns RGBA image or None on failure."""
    import subprocess, tempfile, shutil
    if not shutil.which('rembg'):
        return None
    tmp_in = None
    tmp_out = None
    try:
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f_in:
            tmp_in = f_in.name
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f_out:
            tmp_out = f_out.name
        img.save(tmp_in)
        result = subprocess.run(
            ['rembg', 'i', tmp_in, tmp_out],
            capture_output=True, timeout=60
        )
        if result.returncode == 0:
            out = Image.open(tmp_out).convert('RGBA')
            return out
    except Exception:
        pass
    finally:
        for p in [tmp_in, tmp_out]:
            if not p:
                continue
            try:
                os.unlink(p)
            except Exception:
                pass
    return None


def remove_background(img):
    """Remove background. Tries rembg first (best quality), falls back to flood-fill.

    Strategy:
    1. If rembg is available and input has no meaningful transparency → use rembg
    2. Otherwise: sample 4 corners to detect background color(s), flood-fill from
       border pixels that match. Only connected regions touching the border are
       removed — interior pixels of similar color are preserved.
    """
    img = img.convert('RGBA')

    # Check if already has meaningful transparency
    alpha = img.getchannel('A')
    transparent_count = sum(1 for a in alpha.getdata() if a < 128)
    total = img.size[0] * img.size[1]

    # If image has no transparency, try rembg first
    if transparent_count <= total * 0.05:
        rembg_result = _try_rembg(img)
        if rembg_result is not None:
            img = rembg_result
            # Recompute transparency so branch 1 cleanup can run
            alpha = img.getchannel('A')
            transparent_count = sum(1 for a in alpha.getdata() if a < 128)
            total = img.size[0] * img.size[1]

    if transparent_count > total * 0.05:
        # Image already has meaningful transparency (AI did partial bg removal),
        # but may have opaque remnants (grid lines, checkerboard squares).
        # Flood-fill from alpha=0 pixels into adjacent neutral/light opaque pixels.
        # This extends the AI's background removal to cover missed artifacts.
        w, h = img.size
        pixels = img.load()

        def _is_bg_remnant(r, g, b):
            """Neutral pixel — likely background remnant. Two-tier thresholds:
            - Bright (avg > 180): lenient sat < 40, high-brightness low-sat is almost always bg
            - Mid (avg > 55): sat < 30, original threshold for checkerboard squares
            - Dark (avg 35-55): strict sat < 15, protects dark outlines and dark clothing
            Below avg 35: never treated as background remnant."""
            avg = (r + g + b) / 3
            sat = max(r, g, b) - min(r, g, b)
            if avg > 180:
                return sat < 40
            elif avg > 55:
                return sat < 30
            elif avg > 35:
                return sat < 15
            return False

        # Seed: all transparent pixels adjacent to an opaque neutral pixel
        queue = deque()
        visited = [[False] * h for _ in range(w)]
        for y in range(h):
            for x in range(w):
                if pixels[x, y][3] >= 128:
                    continue
                # Check 4 cardinal neighbors for opaque neutral pixels
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and not visited[nx][ny]:
                        nr, ng, nb, na = pixels[nx, ny]
                        if na >= 128 and _is_bg_remnant(nr, ng, nb):
                            queue.append((nx, ny))

        # Flood-fill through connected neutral/light opaque pixels
        to_clear = []
        while queue:
            x, y = queue.popleft()
            if x < 0 or x >= w or y < 0 or y >= h:
                continue
            if visited[x][y]:
                continue
            visited[x][y] = True

            r, g, b, a = pixels[x, y]
            if a < 128:
                continue
            if not _is_bg_remnant(r, g, b):
                continue

            to_clear.append((x, y))
            queue.append((x + 1, y))
            queue.append((x - 1, y))
            queue.append((x, y + 1))
            queue.append((x, y - 1))

        for x, y in to_clear:
            r, g, b, a = pixels[x, y]
            pixels[x, y] = (r, g, b, 0)

        # Stage A.5: border flood-fill supplement.
        # Catches edge background that rembg missed — seeds from all 4 image
        # borders where opaque pixels match _is_bg_remnant, floods inward.
        # Runs after transparent→opaque fill (above) so newly cleared pixels
        # don't interfere, and before Stage B so island connectivity is accurate.
        border_queue = deque()
        visited_border = [[False] * h for _ in range(w)]
        for x in range(w):
            for y in [0, h - 1]:
                r, g, b, a = pixels[x, y]
                if a >= 128 and _is_bg_remnant(r, g, b):
                    border_queue.append((x, y))
        for y in range(h):
            for x in [0, w - 1]:
                r, g, b, a = pixels[x, y]
                if a >= 128 and _is_bg_remnant(r, g, b):
                    border_queue.append((x, y))

        border_clear = []
        while border_queue:
            x, y = border_queue.popleft()
            if x < 0 or x >= w or y < 0 or y >= h:
                continue
            if visited_border[x][y]:
                continue
            visited_border[x][y] = True
            r, g, b, a = pixels[x, y]
            if a < 128:
                continue
            if not _is_bg_remnant(r, g, b):
                continue
            border_clear.append((x, y))
            border_queue.append((x + 1, y))
            border_queue.append((x - 1, y))
            border_queue.append((x, y + 1))
            border_queue.append((x, y - 1))

        for x, y in border_clear:
            r, g, b, a = pixels[x, y]
            pixels[x, y] = (r, g, b, 0)

        # Stage B: remove small opaque islands disconnected from main character.
        # These are enclosed background remnants (checkerboard, gap fill) that
        # flood-fill can't reach because they're surrounded by character pixels.
        SMALL_ISLAND_MAX_AREA = 64
        NEUTRAL_SAT_THRESHOLD = 30

        visited_cc = [[False] * h for _ in range(w)]
        components = []
        for sy in range(h):
            for sx in range(w):
                if visited_cc[sx][sy] or pixels[sx, sy][3] < 128:
                    continue
                comp = []
                cc_q = deque([(sx, sy)])
                while cc_q:
                    cx, cy = cc_q.popleft()
                    if cx < 0 or cx >= w or cy < 0 or cy >= h:
                        continue
                    if visited_cc[cx][cy] or pixels[cx, cy][3] < 128:
                        continue
                    visited_cc[cx][cy] = True
                    comp.append((cx, cy))
                    cc_q.extend([(cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)])
                components.append(comp)

        if components:
            # Largest component is the character — keep it
            main_size = max(len(c) for c in components)
            for comp in components:
                if len(comp) == main_size:
                    continue
                if len(comp) > SMALL_ISLAND_MAX_AREA:
                    continue
                # Check if island is neutral (likely background, not character detail)
                total_sat = 0
                for cx, cy in comp:
                    r, g, b, _ = pixels[cx, cy]
                    total_sat += max(r, g, b) - min(r, g, b)
                if total_sat / len(comp) < NEUTRAL_SAT_THRESHOLD:
                    for cx, cy in comp:
                        r, g, b, _ = pixels[cx, cy]
                        pixels[cx, cy] = (r, g, b, 0)

        return img

    w, h = img.size
    pixels = img.load()

    # Sample corner regions (4x4 block at each corner) to find background color(s)
    corner_colors = Counter()
    sample = 4
    for cx, cy in [(0, 0), (w - sample, 0), (0, h - sample), (w - sample, h - sample)]:
        for dx in range(sample):
            for dy in range(sample):
                x, y = min(cx + dx, w - 1), min(cy + dy, h - 1)
                corner_colors[pixels[x, y][:3]] += 1

    if not corner_colors:
        return img

    # Background colors: top colors that together cover > 90% of corner samples
    # (high threshold ensures checkerboard backgrounds have both colors collected)
    bg_colors = set()
    total_corner = sum(corner_colors.values())
    cumulative = 0
    for color, count in corner_colors.most_common():
        bg_colors.add(color)
        cumulative += count
        if cumulative > total_corner * 0.9:
            break

    def _color_close(c1, c2, threshold=40):
        return all(abs(a - b) <= threshold for a, b in zip(c1, c2))

    def _is_bg(rgb):
        return any(_color_close(rgb, bg) for bg in bg_colors)

    # Flood-fill from all border pixels that match background
    visited = [[False] * h for _ in range(w)]
    to_clear = []
    queue = deque()

    # Seed: all border pixels matching background
    for x in range(w):
        for y in [0, h - 1]:
            if _is_bg(pixels[x, y][:3]):
                queue.append((x, y))
    for y in range(h):
        for x in [0, w - 1]:
            if _is_bg(pixels[x, y][:3]):
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if x < 0 or x >= w or y < 0 or y >= h:
            continue
        if visited[x][y]:
            continue
        visited[x][y] = True

        rgb = pixels[x, y][:3]
        if not _is_bg(rgb):
            continue

        to_clear.append((x, y))
        queue.append((x + 1, y))
        queue.append((x - 1, y))
        queue.append((x, y + 1))
        queue.append((x, y - 1))

    for x, y in to_clear:
        r, g, b, a = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)

    return img


def _clean_transparent_rgb(img):
    """Zero out RGB values where alpha is 0 to prevent color bleed during resize.

    Many AI image generators embed a checkerboard pattern in the RGB channels
    of transparent pixels. NEAREST-neighbor resize can sample these dirty RGB
    values at content boundaries, causing visible artifacts when composited.
    """
    if img.mode != 'RGBA':
        return img
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            if pixels[x, y][3] == 0:
                pixels[x, y] = (0, 0, 0, 0)
    return img


def fit_to_canvas(img, canvas_size):
    """Resize image to fit within canvas while maintaining aspect ratio, then center it."""
    # Auto-crop to content bounding box first (remove transparent/removed areas)
    if img.mode == 'RGBA':
        bbox = img.split()[3].getbbox()  # bounding box of non-transparent area
        if bbox:
            img = img.crop(bbox)

    # Clean transparent pixel RGB to prevent checkerboard bleed during NEAREST resize
    img = _clean_transparent_rgb(img)

    img_w, img_h = img.size

    # Scale to fit
    scale = min(canvas_size / img_w, canvas_size / img_h) * 0.9
    new_w = int(img_w * scale)
    new_h = int(img_h * scale)

    resized = img.resize((new_w, new_h), Image.NEAREST)  # NEAREST for pixel art

    # Center on canvas
    canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    offset_x = (canvas_size - new_w) // 2
    offset_y = (canvas_size - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y), resized)

    return canvas, offset_x, offset_y, new_w, new_h


def _deform(canvas, sx, sy, anchor_bottom=True):
    """Scale canvas content by (sx, sy) around bottom-center or center anchor.

    Returns a new RGBA canvas of the same size with the deformed sprite.
    """
    cs = canvas.size[0]
    # Find content bounding box
    bbox = canvas.split()[3].getbbox()
    if not bbox:
        return canvas.copy()
    content = canvas.crop(bbox)
    cw, ch = content.size

    new_w = max(1, int(cw * sx))
    new_h = max(1, int(ch * sy))
    stretched = content.resize((new_w, new_h), Image.NEAREST)

    frame = Image.new('RGBA', (cs, cs), (0, 0, 0, 0))
    # Horizontal: keep centered
    px = bbox[0] + (cw - new_w) // 2
    if anchor_bottom:
        # Anchor to original bottom edge — squash grows upward, stretch grows downward
        py = bbox[3] - new_h
    else:
        # Anchor to vertical center
        py = bbox[1] + (ch - new_h) // 2
    frame.paste(stretched, (px, py), stretched)
    return frame


def generate_bounce_squash_frames(img, config):
    """Bounce with squash on landing and stretch at apex.

    Cycle: rise → apex(stretch) → fall → land(squash) → recover
    """
    frames = []
    canvas_size = OUTPUT_SIZE
    base_canvas, ox, oy, w, h = fit_to_canvas(img, canvas_size)
    amp = config['amplitude']

    # 8 frames: [ground, rise, apex-stretch, hang, fall, land-squash, recover, rest]
    keyframes = [
        # (dy, sx, sy)  dy<0 = up
        (0,    1.0,  1.0),    # ground
        (-amp * 0.6, 0.95, 1.06),  # rising — slight vertical stretch
        (-amp,  0.92, 1.10),  # apex — tall and thin
        (-amp * 0.85, 0.94, 1.06),  # hang — still stretched
        (-amp * 0.3, 0.98, 1.02),  # falling
        (0,    1.12, 0.88),  # landing squash — wide and flat
        (0,    1.06, 0.94),  # recovering
        (0,    1.0,  1.0),    # rest
    ]

    for dy, sx, sy in keyframes:
        deformed = _deform(base_canvas, sx, sy, anchor_bottom=True)
        frame = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
        frame.paste(deformed, (0, int(dy)), deformed)
        frames.append(frame)

    return frames


def generate_shrink_sink_frames(img, config):
    """Sad: character shrinks slightly and sinks, then slowly returns.

    Conveys deflation — the character literally gets smaller.
    """
    frames = []
    canvas_size = OUTPUT_SIZE
    base_canvas, ox, oy, w, h = fit_to_canvas(img, canvas_size)
    amp = config['amplitude']

    # 10 frames: deflate down → hold → slowly recover
    keyframes = [
        # (dy, scale)
        (0,           1.0),
        (amp * 0.2,   0.98),
        (amp * 0.5,   0.95),
        (amp * 0.8,   0.92),
        (amp,         0.90),   # deepest point
        (amp,         0.90),   # hold
        (amp * 0.85,  0.91),
        (amp * 0.6,   0.93),
        (amp * 0.3,   0.96),
        (0,           1.0),    # back to normal
    ]

    for dy, scale in keyframes:
        deformed = _deform(base_canvas, scale, scale, anchor_bottom=True)
        frame = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
        frame.paste(deformed, (0, int(dy)), deformed)
        frames.append(frame)

    return frames


def generate_swell_shake_frames(img, config):
    """Angry: swell up then shake violently with decay.

    First frame puffs up (scale > 1), then rapid left-right shake
    with decreasing amplitude. Conveys contained rage bursting out.
    """
    frames = []
    canvas_size = OUTPUT_SIZE
    base_canvas, ox, oy, w, h = fit_to_canvas(img, canvas_size)
    amp = config['amplitude']

    # 6 frames: swell → shake L → shake R → shake L(smaller) → settle → rest
    keyframes = [
        # (dx, sx, sy)
        (0,            1.08, 1.08),   # puff up
        (-amp,         1.06, 1.04),   # shake left (still swollen)
        (amp,          1.04, 1.02),   # shake right
        (-int(amp*0.5), 1.02, 1.01),  # smaller shake left
        (int(amp*0.2), 1.01, 1.0),    # settling right
        (0,            1.0,  1.0),    # rest
    ]

    for dx, sx, sy in keyframes:
        deformed = _deform(base_canvas, sx, sy, anchor_bottom=True)
        frame = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
        frame.paste(deformed, (dx, 0), deformed)
        frames.append(frame)

    return frames


def generate_tilt_zoom_frames(img, config):
    """Thinking: subtle head tilt via asymmetric scale, slight zoom on upper half.

    Since we can't rotate with pixel-clean results, we fake the tilt by
    shifting the sprite slightly and scaling up to suggest leaning in.
    """
    frames = []
    canvas_size = OUTPUT_SIZE
    base_canvas, ox, oy, w, h = fit_to_canvas(img, canvas_size)
    amp = config['amplitude']

    # 8 frames: neutral → lean-in → hold(zoom) → hold → lean-out → rest → rest → rest
    keyframes = [
        # (dx, dy, scale)
        (0,    0,    1.0),     # neutral
        (amp,  -1,   1.02),    # start leaning right + slight zoom
        (amp+1, -2,  1.04),    # full lean — zoomed in, thinking hard
        (amp+1, -2,  1.04),    # hold
        (amp+1, -2,  1.04),    # hold (longer pause = "still thinking")
        (amp,  -1,   1.02),    # returning
        (0,    0,    1.0),     # back
        (0,    0,    1.0),     # rest
    ]

    for dx, dy, scale in keyframes:
        deformed = _deform(base_canvas, scale, scale, anchor_bottom=False)
        frame = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
        frame.paste(deformed, (dx, dy), deformed)
        frames.append(frame)

    return frames


FRAME_GENERATORS = {
    'bounce_squash': generate_bounce_squash_frames,
    'shrink_sink': generate_shrink_sink_frames,
    'swell_shake': generate_swell_shake_frames,
    'tilt_zoom': generate_tilt_zoom_frames,
}


def _find_unused_color(frames):
    """Find an RGB color not present in any frame, for use as transparent proxy."""
    candidates = [(255, 0, 255), (0, 255, 0), (0, 0, 255), (1, 1, 1), (254, 0, 254)]
    used = set()
    for frame in frames:
        rgb = frame.convert('RGB')
        used.update(rgb.getdata())
    for c in candidates:
        if c not in used:
            return c
    # Fallback: brute-force search
    for r in range(256):
        for g in range(256):
            if (r, g, 0) not in used:
                return (r, g, 0)
    return (255, 0, 255)  # should never reach here


def _save_gif(rgba_frames, output_path, duration):
    """Convert RGBA frames to paletted GIF with transparency."""
    bg_color = _find_unused_color(rgba_frames)
    first_canvas = Image.new('RGB', rgba_frames[0].size, bg_color)
    first_canvas.paste(rgba_frames[0], mask=rgba_frames[0].split()[3])
    ref_palette_img = first_canvas.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    ref_palette = ref_palette_img.getpalette()

    # Find transparent index from the shared palette matching bg_color
    trans_index = 0
    for idx in range(0, len(ref_palette), 3):
        if ref_palette[idx] == bg_color[0] and ref_palette[idx + 1] == bg_color[1] and ref_palette[idx + 2] == bg_color[2]:
            trans_index = idx // 3
            break

    gif_frames = []
    for frame in rgba_frames:
        canvas = Image.new('RGB', frame.size, bg_color)
        canvas.paste(frame, mask=frame.split()[3])

        p_frame = canvas.quantize(palette=ref_palette_img, dither=0)

        alpha = frame.split()[3]
        p_data = list(p_frame.getdata())
        a_data = list(alpha.getdata())
        for j in range(len(p_data)):
            if a_data[j] < 128:
                p_data[j] = trans_index

        p_frame.putdata(p_data)
        p_frame.info['transparency'] = trans_index
        gif_frames.append(p_frame)

    gif_frames[0].save(
        output_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=duration,
        loop=0,
        disposal=2,
        transparency=trans_index,
    )


def _resize_frames(frames, size):
    """Resize RGBA frames to a new size using NEAREST for pixel art."""
    resized = []
    for f in frames:
        resized.append(f.resize((size, size), Image.NEAREST))
    return resized


def process_image(input_path, emotion, output_path, name=None):
    """Process a single image: remove bg, generate animated GIF.

    Outputs two files:
      {emotion}.gif      — DISPLAY_SIZE for chat
      {emotion}@2x.gif   — OUTPUT_SIZE for sharing
    """
    img = Image.open(input_path)
    img = remove_background(img)

    config = ANIMATIONS[emotion]
    generator = FRAME_GENERATORS[config['type']]
    frames = generator(img, config)

    # Save display size without watermark (too small to read)
    display_frames = _resize_frames(frames, DISPLAY_SIZE)
    _save_gif(display_frames, output_path, config['duration'])

    # Save @2x with watermark (full resolution)
    if name:
        frames = [add_watermark(f, name) for f in frames]
    base, ext = os.path.splitext(output_path)
    hires_path = f'{base}@2x{ext}'
    _save_gif(frames, hires_path, config['duration'])


def add_watermark(img, name):
    """Add a subtle 'ColaOS · {name}' watermark in the bottom-right corner."""
    w, h = img.size
    is_rgba = img.mode == 'RGBA'

    result = img.copy()
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font = load_font(10)
    text = f'{BRAND_NAME} · {name}'
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Bottom-right corner with padding
    margin = 6
    x = w - text_w - margin
    y = h - text_h - margin

    # Semi-transparent white text
    draw.text((x, y), text, fill=(255, 255, 255, 120), font=font)

    if is_rgba:
        result = Image.alpha_composite(result, overlay)
    else:
        result = result.convert('RGBA')
        result = Image.alpha_composite(result, overlay)

    return result


def save_base_image(input_path, output_path, name=None):
    """Save base image as transparent PNG in two sizes, plus the original.

    Outputs:
      base_image_original.png — original source image (background removed, uncropped)
      base_image.png          — DISPLAY_SIZE for chat (no watermark)
      base_image@2x.png       — OUTPUT_SIZE for sharing (with watermark)
    """
    img = Image.open(input_path)
    img = remove_background(img)

    # Save original-resolution copy (background removed, before fit_to_canvas)
    # Callers control when this function runs; when called, always refresh original.
    base, ext = os.path.splitext(output_path)
    original_path = f'{base}_original{ext}'
    img.save(original_path, 'PNG')

    canvas, _, _, _, _ = fit_to_canvas(img, OUTPUT_SIZE)

    # Save @2x with watermark
    hires_path = f'{base}@2x{ext}'
    hires = add_watermark(canvas, name) if name else canvas
    hires.save(hires_path, 'PNG')

    # Save display size without watermark
    display = canvas.resize((DISPLAY_SIZE, DISPLAY_SIZE), Image.NEAREST)
    display.save(output_path, 'PNG')


# === Meme sticker generators ===

def _save_meme(result, output_path):
    """Save a meme sticker in both @2x and display sizes."""
    base, ext = os.path.splitext(output_path)
    result.save(f'{base}@2x{ext}', 'PNG')
    result.resize((DISPLAY_SIZE, DISPLAY_SIZE), Image.NEAREST).save(output_path, 'PNG')


def generate_meme_confused(input_path, output_path):
    """Confused meme: AI-generated confused pose + single "?" symbol.

    The character should already be in a confused pose (head tilted,
    scratching head, body leaning). We add a single "?" to reinforce.
    """
    img = Image.open(input_path)
    img = remove_background(img)
    canvas, _, _, _, _ = fit_to_canvas(img, OUTPUT_SIZE)

    result = canvas.copy()
    overlay = Image.new('RGBA', (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Find character position to place "?" relative to head
    content_bbox = canvas.split()[3].getbbox()
    if content_bbox:
        # Place "?" to the right of head, upper area
        qx = min(content_bbox[2] + 5, OUTPUT_SIZE - 50)
        qy = content_bbox[1]
    else:
        qx = OUTPUT_SIZE - 60
        qy = 20

    font = load_pixel_font(70)
    # Shadow
    draw.text((qx + 2, qy + 2), "?", fill=(0, 0, 0, 60), font=font)
    # Purple "?" (like the reference)
    draw.text((qx, qy), "?", fill=(160, 100, 200, 230), font=font)

    result = Image.alpha_composite(result, overlay)
    _save_meme(result, output_path)


def generate_meme_annoyed(input_path, output_path):
    """Annoyed meme: AI-generated annoyed pose + scribble cloud.

    The character should already be in an annoyed pose (half-closed eyes,
    pursed lips, arms crossed, hunched). We add a scribble cloud near
    the head to convey frustration/mental chaos.
    """
    img = Image.open(input_path)
    img = remove_background(img)
    canvas, _, _, _, _ = fit_to_canvas(img, OUTPUT_SIZE)

    result = canvas.copy()
    overlay = Image.new('RGBA', (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Find head area for scribble placement — tight to the head
    content_bbox = canvas.split()[3].getbbox()
    if content_bbox:
        # Scribble right at head, overlapping slightly
        scrib_cx = content_bbox[2] - 5
        scrib_cy = content_bbox[1] + 10
    else:
        scrib_cx = OUTPUT_SIZE - 50
        scrib_cy = 40

    # Draw scribble: dense tangled loops, round like hand-drawn doodle.
    scrib_color = (40, 40, 40, 230)
    import random
    rng = random.Random(42)
    r_cloud = 30

    # Dense overlapping circular loops with varied sizes
    # Smaller loops in center (tight tangle), bigger loops at edges (loose ends)
    for _ in range(28):
        ox = rng.randint(-r_cloud + 3, r_cloud - 3)
        oy = rng.randint(-r_cloud + 3, r_cloud - 3)
        dist = (ox * ox + oy * oy) ** 0.5
        # Closer to center = smaller tighter loops
        if dist < r_cloud * 0.5:
            rx = rng.randint(6, 14)
            ry = rng.randint(6, 12)
        else:
            rx = rng.randint(12, 22)
            ry = rng.randint(10, 20)
        start = rng.randint(0, 360)
        extent = rng.randint(220, 350)
        bbox = [scrib_cx + ox - rx, scrib_cy + oy - ry,
                scrib_cx + ox + rx, scrib_cy + oy + ry]
        draw.arc(bbox, start, start + extent, fill=scrib_color, width=2)

    result = Image.alpha_composite(result, overlay)
    _save_meme(result, output_path)


def generate_meme_cracked(input_path, output_path, locale='zh'):
    """Cracked meme: AI-generated distressed pose + lightning crack on face + text.

    The character should be in a weary/collapsed expression. We draw a
    single lightning-bolt crack down the face (NOT splitting the image)
    and add "裂开"/"cracked" text above. References the classic Chinese meme format.

    Adaptive behaviors:
    - Crack color: light gray on dark characters, dark gray on light characters.
    - Text position: shifts to side if character decorations (ears/horns/hats)
      overlap with the default center-top text area.
    """
    img = Image.open(input_path)
    img = remove_background(img)
    canvas, _, _, _, _ = fit_to_canvas(img, OUTPUT_SIZE)

    result = canvas.copy()
    overlay = Image.new('RGBA', (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    content_bbox = canvas.split()[3].getbbox()
    if content_bbox:
        face_cx = (content_bbox[0] + content_bbox[2]) // 2
        face_top = content_bbox[1]
        face_bottom = content_bbox[1] + (content_bbox[3] - content_bbox[1]) * 2 // 3
    else:
        face_cx = OUTPUT_SIZE // 2
        face_top = 30
        face_bottom = OUTPUT_SIZE * 2 // 3

    # --- Adaptive crack color: sample character brightness along crack path ---
    pixels = canvas.load()

    # Refine face_cx: use centroid of opaque pixels in upper 1/3 of character
    # (head region) instead of full bbox center, so the crack centers on the
    # head even when the distressed pose has asymmetric limbs.
    if content_bbox:
        head_bottom = content_bbox[1] + (content_bbox[3] - content_bbox[1]) // 3
        cx_sum, cx_count = 0, 0
        for y_s in range(content_bbox[1], head_bottom):
            for x_s in range(content_bbox[0], content_bbox[2]):
                if pixels[x_s, y_s][3] > 128:
                    cx_sum += x_s
                    cx_count += 1
        if cx_count > 0:
            face_cx = cx_sum // cx_count

    brightness_samples = []
    for y_s in range(face_top, face_bottom, 4):
        for x_s in range(max(0, face_cx - 15), min(OUTPUT_SIZE, face_cx + 15)):
            r, g, b, a = pixels[x_s, y_s]
            if a > 128:
                brightness_samples.append(0.299 * r + 0.587 * g + 0.114 * b)

    avg_brightness = sum(brightness_samples) / len(brightness_samples) if brightness_samples else 128

    if avg_brightness < 120:
        crack_color = (200, 195, 190, 230)
        text_color = (60, 55, 50, 240)
        text_shadow = (255, 255, 255, 80)
    else:
        crack_color = (90, 85, 80, 230)
        text_color = (50, 40, 35, 240)
        text_shadow = (0, 0, 0, 80)

    # --- Adaptive text position: avoid overlapping character decorations ---
    font = load_font(30)
    text = "裂开" if locale == 'zh' else "cracked"
    text_bbox = draw.textbbox((0, 0), text, font=font)
    tw = text_bbox[2] - text_bbox[0]
    th = text_bbox[3] - text_bbox[1]

    top_margin = 4
    text_center_x = face_cx - tw // 2

    has_overlap = False
    if content_bbox and content_bbox[1] < top_margin + th + 8:
        for ty_c in range(top_margin, min(top_margin + th, OUTPUT_SIZE)):
            for tx_c in range(max(0, text_center_x), min(OUTPUT_SIZE, text_center_x + tw)):
                _, _, _, a = pixels[tx_c, ty_c]
                if a > 64:
                    has_overlap = True
                    break
            if has_overlap:
                break

    if has_overlap:
        left_space = content_bbox[0]
        right_space = OUTPUT_SIZE - content_bbox[2]
        if right_space >= tw + 8:
            tx = content_bbox[2] + 4
            ty = face_top
        elif left_space >= tw + 8:
            tx = content_bbox[0] - tw - 4
            ty = face_top
        else:
            tx = text_center_x
            ty = top_margin
    else:
        tx = text_center_x
        ty = top_margin

    tx = max(4, min(OUTPUT_SIZE - tw - 4, tx))
    ty = max(2, ty)

    draw.text((tx + 1, ty + 1), text, fill=text_shadow, font=font)
    draw.text((tx, ty), text, fill=text_color, font=font)

    # --- Lightning bolt crack: starts below text, tapers thick→thin ---
    crack_top = ty + th + 4
    crack_h = face_bottom - crack_top
    if crack_h < 20:
        crack_top = face_top + 10
        crack_h = face_bottom - crack_top

    x, y = face_cx, crack_top
    points = [(x, y)]
    bolt_segments = [
        (12, crack_h // 5),
        (-20, crack_h // 5),
        (18, crack_h // 5),
        (-16, crack_h // 5),
        (6, crack_h // 5),
    ]
    for dx, dy in bolt_segments:
        x += dx
        y += dy
        points.append((x, min(y, face_bottom)))

    widths = [12, 9, 7, 5, 4]
    for i in range(len(points) - 1):
        w = widths[i] if i < len(widths) else 3
        draw.line([points[i], points[i + 1]], fill=crack_color, width=w)

    result = Image.alpha_composite(result, overlay)
    _save_meme(result, output_path)


CARD_BG = (255, 255, 255)

# Five-element color mapping — brightened to reduce gray/muted card appearance
WUXING_COLORS = {
    'wood': {'primary': (60, 120, 50), 'light': (90, 160, 110)},
    'fire': {'primary': (210, 45, 65), 'light': (225, 95, 90)},
    'metal': {'primary': (175, 150, 90), 'light': (195, 180, 140)},
    'water': {'primary': (40, 80, 130), 'light': (110, 150, 190)},
    'earth': {'primary': (180, 135, 20), 'light': (215, 175, 70)},
}

# Rarity → number of filled diamonds (out of 5)
RARITY_FILLED = {
    'common': 2,
    'rare': 3,
    'legendary': 5,
}

PIXEL_FONT_CANDIDATES = [
    '/System/Library/Fonts/Menlo.ttc',
    '/System/Library/Fonts/Courier.ttc',
    '/System/Library/Fonts/Monaco.ttf',
]

FONT_CANDIDATES = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/Library/Fonts/Arial Unicode.ttf',
]


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def load_pixel_font(size):
    for path in PIXEL_FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return load_font(size)


def draw_rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    """Draw a rounded rectangle using pieslice for clean corners."""
    x0, y0, x1, y1 = xy
    r = radius
    d = r * 2

    if fill:
        # Fill: center + top/bottom strips + 4 corner pies
        draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
        draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
        draw.pieslice([x0, y0, x0 + d, y0 + d], 180, 270, fill=fill)
        draw.pieslice([x1 - d, y0, x1, y0 + d], 270, 360, fill=fill)
        draw.pieslice([x0, y1 - d, x0 + d, y1], 90, 180, fill=fill)
        draw.pieslice([x1 - d, y1 - d, x1, y1], 0, 90, fill=fill)

    if outline:
        # Outline: 4 arcs + 4 lines
        draw.arc([x0, y0, x0 + d, y0 + d], 180, 270, fill=outline, width=width)
        draw.arc([x1 - d, y0, x1, y0 + d], 270, 360, fill=outline, width=width)
        draw.arc([x0, y1 - d, x0 + d, y1], 90, 180, fill=outline, width=width)
        draw.arc([x1 - d, y1 - d, x1, y1], 0, 90, fill=outline, width=width)
        draw.line([x0 + r, y0, x1 - r, y0], fill=outline, width=width)
        draw.line([x0 + r, y1, x1 - r, y1], fill=outline, width=width)
        draw.line([x0, y0 + r, x0, y1 - r], fill=outline, width=width)
        draw.line([x1, y0 + r, x1, y1 - r], fill=outline, width=width)


def draw_diamond(draw, cx, cy, size, fill=None, outline=None):
    """Draw a pixel diamond (rotated square) centered at (cx, cy).

    size: half-width of the diamond (total width = size*2 + 1).
    fill: RGBA tuple for filled diamond, None for outline only.
    outline: RGBA tuple for the outline color.
    """
    points = [(cx, cy - size), (cx + size, cy), (cx, cy + size), (cx - size, cy)]
    if fill:
        draw.polygon(points, fill=fill, outline=outline or fill)
    elif outline:
        draw.polygon(points, fill=None, outline=outline)


def draw_rarity_diamonds(draw, cx, y, rarity, color, scale):
    """Draw 5 diamonds centered at (cx, y). Filled count determined by rarity.

    color: RGBA tuple for the wuxing light color.
    """
    filled_count = RARITY_FILLED.get(rarity, 1)
    diamond_size = 4 * scale    # half-width: 4*2=8px @2x → 9x9 visible diamond
    spacing = 14 * scale        # center-to-center distance
    total_count = 5
    total_w = (total_count - 1) * spacing
    start_x = cx - total_w // 2

    # Filled color = full opacity, outline color = 30% opacity premixed with white bg
    filled_color = color + (255,)
    # Premultiply outline alpha onto white background to avoid transparency holes
    # when ImageDraw replaces opaque card pixels with semi-transparent ones.
    alpha_frac = 77 / 255
    outline_rgb = tuple(int(c * alpha_frac + 255 * (1 - alpha_frac)) for c in color)
    outline_color = outline_rgb + (255,)

    for i in range(total_count):
        dx = start_x + i * spacing
        if i < filled_count:
            draw_diamond(draw, dx, y, diamond_size, fill=filled_color)
        else:
            draw_diamond(draw, dx, y, diamond_size, outline=outline_color)


def generate_profile_card(avatar_path, name, line1, line2, output_path, wuxing='wood', rarity='common'):
    """Generate a vertical profile card with pixel font, wuxing colors, and rounded border.
    Renders at 2x resolution for Retina clarity.
    Rarity shown as filled/outline diamonds at the top of the card."""
    # Prefer original-resolution source if available (avoids upscale artifacts on regen)
    base, ext = os.path.splitext(avatar_path)
    original_path = f'{base}_original{ext}'
    if os.path.exists(original_path):
        avatar = Image.open(original_path).convert('RGBA')
    else:
        avatar = Image.open(avatar_path).convert('RGBA')
        avatar = remove_background(avatar)

    scale = 2
    card_w = 320 * scale
    card_h = 420 * scale
    avatar_size = 180 * scale
    padding = 24 * scale
    border_radius = 16 * scale
    border_width = 2 * scale

    # Colors determined solely by wuxing — rarity does not affect colors
    wx = WUXING_COLORS.get(wuxing, WUXING_COLORS['wood'])
    name_color = wx['primary']
    border_color = wx['light']
    card_bg = CARD_BG

    # Create card — minimal padding for border rendering
    edge = border_width
    canvas_w = card_w + edge * 2
    canvas_h = card_h + edge * 2
    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    card_x = edge
    card_y = edge

    # Card border — uniform 40% opacity
    border_color_alpha = border_color + (102,)
    # Draw border as a separate layer for alpha support
    border_layer = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border_layer)
    draw_rounded_rect(border_draw,
        [card_x, card_y, card_x + card_w, card_y + card_h],
        border_radius, fill=None, outline=border_color_alpha, width=border_width)
    # Card fill
    draw_rounded_rect(draw,
        [card_x + border_width, card_y + border_width,
         card_x + card_w - border_width, card_y + card_h - border_width],
        border_radius - border_width, fill=card_bg + (255,))
    canvas = Image.alpha_composite(canvas, border_layer)
    draw = ImageDraw.Draw(canvas)

    # Rarity diamonds — centered below top border
    diamond_y = card_y + padding
    diamond_cx = card_x + card_w // 2
    draw_rarity_diamonds(draw, diamond_cx, diamond_y, rarity, border_color, scale)

    # Resize and place avatar (centered, below diamonds)
    avatar_fit, _, _, _, _ = fit_to_canvas(avatar, avatar_size)
    avatar_x = card_x + (card_w - avatar_size) // 2
    avatar_y = card_y + padding + 16 * scale

    canvas.paste(avatar_fit, (avatar_x, avatar_y), avatar_fit)

    # Draw text below avatar
    draw = ImageDraw.Draw(canvas)  # re-create after paste

    # === TEXT RENDERING ===

    # Name: wuxing primary color, sized to not overpower the avatar
    font_name = load_font(32 * scale)
    name_bbox = draw.textbbox((0, 0), name, font=font_name)
    name_w = name_bbox[2] - name_bbox[0]
    name_x = card_x + (card_w - name_w) // 2
    name_y = avatar_y + avatar_size + 24 * scale + 10 * scale
    draw.text((name_x, name_y), name, fill=name_color, font=font_name)

    # Text area max width (card width minus padding on both sides)
    text_max_w = card_w - padding * 4

    def draw_centered_text_wrapped(draw, text, y, font, color, max_w):
        """Draw centered text, wrapping if it exceeds max width."""
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        line_h = bbox[3] - bbox[1] + 4 * scale

        if text_w <= max_w:
            # Fits in one line
            tx = card_x + (card_w - text_w) // 2
            draw.text((tx, y), text, fill=color, font=font)
            return y + line_h

        # Wrap: find split point
        mid = len(text) // 2
        # Look for comma or space near middle
        best = mid
        for offset in range(min(8, mid)):
            for pos in [mid + offset, mid - offset]:
                if 0 <= pos < len(text) and text[pos] in '，,、 ':
                    best = pos + 1
                    break
            else:
                continue
            break

        part1 = text[:best].rstrip('，, ')
        part2 = text[best:].lstrip('，, ')

        for part in [part1, part2]:
            pb = draw.textbbox((0, 0), part, font=font)
            pw = pb[2] - pb[0]
            px = card_x + (card_w - pw) // 2
            draw.text((px, y), part, fill=color, font=font)
            y += line_h
        return y

    # Line 1 & 2: unified neutral gray, same font size for readability
    desc_color = (110, 110, 115)
    desc_font = load_font(16 * scale)
    line1_end_y = draw_centered_text_wrapped(draw, line1, name_y + 64 * scale, desc_font, desc_color, text_max_w)

    if line2 and line2.strip():
        line1_end_y = draw_centered_text_wrapped(draw, line2, line1_end_y + 6 * scale, desc_font, desc_color, text_max_w)

    # ColaOS branding — centered between last tagline and card bottom
    brand_font = load_pixel_font(9 * scale)
    brand_text = BRAND_NAME
    brand_bbox = draw.textbbox((0, 0), brand_text, font=brand_font)
    brand_w = brand_bbox[2] - brand_bbox[0]
    brand_h = brand_bbox[3] - brand_bbox[1]
    brand_x = card_x + (card_w - brand_w) // 2
    brand_y = line1_end_y + (card_y + card_h - line1_end_y - brand_h) // 2
    draw.text((brand_x, brand_y), brand_text, fill=border_color, font=brand_font)

    # Save as PNG
    canvas.save(output_path, 'PNG')


def check_background(img_path):
    """Check if an image's background is acceptable for the avatar pipeline.

    Decision tree:
    1. Transparency > 30% → clean, pass
    2. Four corners white (avg > 240) → white_remnant, pass (remove_background can handle)
    2b. Four corners consistent but not white → unknown, fail
    3. Checkerboard in border 20px → checkerboard, fail
    4. Border RGB stddev > 40 → gradient, fail
    5. Default → unknown, fail (no positive clean signal)

    Returns (exit_code, result_dict). exit_code 0 = acceptable, 1 = not.

    Note on confidence: the confidence field uses different metrics per branch
    (transparency ratio, corner brightness, flip rate, stddev, etc.) and is
    intended for logging/debugging only. Do not use it as a threshold for
    automated decisions — the exit code is the decision signal.
    """
    import json
    import math

    img = Image.open(img_path).convert('RGBA')
    w, h = img.size
    pixels = img.load()
    total = w * h

    # 1. Transparency check
    transparent_count = sum(1 for y in range(h) for x in range(w) if pixels[x, y][3] < 128)
    transparency_ratio = transparent_count / total
    if transparency_ratio > 0.30:
        return 0, {
            'background_type': 'clean',
            'confidence': min(1.0, transparency_ratio),
            'reason': f'{transparency_ratio:.0%} of pixels already transparent',
        }

    # 2. Four corners sampling (4x4 block each)
    sample = 4
    corner_avgs = []
    for cx, cy in [(0, 0), (w - sample, 0), (0, h - sample), (w - sample, h - sample)]:
        block_vals = []
        for dx in range(sample):
            for dy in range(sample):
                x, y = min(cx + dx, w - 1), min(cy + dy, h - 1)
                r, g, b, a = pixels[x, y]
                if a >= 128:
                    block_vals.append((r + g + b) / 3)
        if block_vals:
            corner_avgs.append(sum(block_vals) / len(block_vals))

    if corner_avgs and all(avg > 240 for avg in corner_avgs):
        return 0, {
            'background_type': 'white_remnant',
            'confidence': min(corner_avgs) / 255,
            'reason': 'four corners are white/near-white, remove_background will handle',
        }

    # 2b. Corners consistent but not white → opaque non-white background
    if corner_avgs and len(corner_avgs) >= 4:
        corner_mean = sum(corner_avgs) / len(corner_avgs)
        corner_spread = max(corner_avgs) - min(corner_avgs)
        if corner_spread < 30:
            return 1, {
                'background_type': 'unknown',
                'confidence': 1.0 - (corner_spread / 60),
                'reason': f'four corners are consistent (spread={corner_spread:.0f}) '
                          f'but not white (avg={corner_mean:.0f})',
            }

    # 3. Checkerboard detection in border 20px band
    border_band = min(20, w // 4, h // 4)
    block_size = 8
    bright_dark_flips = 0
    total_blocks = 0
    for y in range(0, border_band, block_size):
        prev_bright = None
        for x in range(0, w, block_size):
            block_sum = 0
            block_count = 0
            for by in range(min(block_size, h - y)):
                for bx in range(min(block_size, w - x)):
                    r, g, b, a = pixels[x + bx, y + by]
                    if a >= 128:
                        block_sum += (r + g + b) / 3
                        block_count += 1
            if block_count > 0:
                block_avg = block_sum / block_count
                is_bright = block_avg > 128
                total_blocks += 1
                if prev_bright is not None and is_bright != prev_bright:
                    bright_dark_flips += 1
                prev_bright = is_bright

    if total_blocks > 4 and bright_dark_flips / total_blocks > 0.6:
        return 1, {
            'background_type': 'checkerboard',
            'confidence': bright_dark_flips / total_blocks,
            'reason': f'alternating bright/dark blocks detected in border ({bright_dark_flips}/{total_blocks} flips)',
        }

    # 4. Border RGB stddev check (4px edge band)
    edge_band = 4
    edge_vals = []
    for x in range(w):
        for y in range(edge_band):
            r, g, b, a = pixels[x, y]
            if a >= 128:
                edge_vals.append((r + g + b) / 3)
        for y in range(max(0, h - edge_band), h):
            r, g, b, a = pixels[x, y]
            if a >= 128:
                edge_vals.append((r + g + b) / 3)
    for y in range(h):
        for x in range(edge_band):
            r, g, b, a = pixels[x, y]
            if a >= 128:
                edge_vals.append((r + g + b) / 3)
        for x in range(max(0, w - edge_band), w):
            r, g, b, a = pixels[x, y]
            if a >= 128:
                edge_vals.append((r + g + b) / 3)

    if edge_vals:
        mean = sum(edge_vals) / len(edge_vals)
        variance = sum((v - mean) ** 2 for v in edge_vals) / len(edge_vals)
        stddev = math.sqrt(variance)
        if stddev > 40:
            return 1, {
                'background_type': 'gradient',
                'confidence': min(1.0, stddev / 80),
                'reason': f'border RGB stddev={stddev:.1f} exceeds threshold 40',
            }

    # 5. Default: fail — no positive evidence of clean background.
    # Only transparency (step 1) and white corners (step 2) are positive signals.
    # Reaching here means the image has an opaque, non-white, non-checkerboard,
    # non-gradient background we can't confidently classify. Fail safe.
    non_white_border = sum(1 for v in edge_vals if v < 240) if edge_vals else 0
    total_edge = max(len(edge_vals), 1)
    return 1, {
        'background_type': 'unknown',
        'confidence': non_white_border / total_edge,
        'reason': 'no positive clean signal (not transparent, not white corners)',
    }


def main():
    parser = argparse.ArgumentParser(description='Cola Avatar Pack Processor')
    parser.add_argument('--check-bg', metavar='IMAGE',
                        help='Check background quality of an image and exit (JSON output)')
    parser.add_argument('--base', help='Path to base/happy image')
    parser.add_argument('--sad', help='Path to sad image')
    parser.add_argument('--angry', help='Path to angry image')
    parser.add_argument('--thinking', help='Path to thinking image')
    parser.add_argument('--name', help='Cola name')
    parser.add_argument('--line1', help='Profile tagline for card')
    parser.add_argument('--line2', help='Secondary tagline for card')
    parser.add_argument('--output', help='Output directory')
    parser.add_argument('--wuxing', default='wood',
                        help='Five-element type: wood/fire/earth/metal/water')
    parser.add_argument('--rarity', default='common',
                        help='Rarity tier: common/rare/legendary')
    parser.add_argument('--profile-only', action='store_true',
                        help='Only generate profile card (Phase 1)')
    parser.add_argument('--direct', action='store_true',
                        help='Output directly to --output dir (no subdirectory)')
    parser.add_argument('--meme-confused', help='Path to confused pose image for meme')
    parser.add_argument('--meme-annoyed', help='Path to annoyed pose image for meme')
    parser.add_argument('--meme-cracked', help='Path to distressed pose image for cracked meme')
    parser.add_argument('--regen-happy', action='store_true',
                        help='Regenerate happy.gif during expression-only regen')
    parser.add_argument('--locale', default='zh',
                        help='Locale for meme text: zh or en')
    args = parser.parse_args()

    # --check-bg mode: standalone background check, then exit
    if args.check_bg:
        import json
        bg_path = os.path.expanduser(args.check_bg)
        if not os.path.exists(bg_path):
            print(f'Error: file not found: {bg_path}', file=sys.stderr)
            sys.exit(2)
        exit_code, result = check_background(bg_path)
        print(json.dumps(result))
        sys.exit(exit_code)

    # Normal mode: validate required args
    if not args.base:
        parser.error('--base is required (unless using --check-bg)')
    if not args.name:
        parser.error('--name is required (unless using --check-bg)')
    if not args.output:
        parser.error('--output is required (unless using --check-bg)')

    # Expand ~ in file paths
    args.base = os.path.expanduser(args.base)
    if args.sad:
        args.sad = os.path.expanduser(args.sad)
    if args.angry:
        args.angry = os.path.expanduser(args.angry)
    if args.thinking:
        args.thinking = os.path.expanduser(args.thinking)
    for attr in ('meme_confused', 'meme_annoyed', 'meme_cracked'):
        val = getattr(args, attr.replace('-', '_'), None)
        if val:
            setattr(args, attr.replace('-', '_'), os.path.expanduser(val))

    # Validate --name: letters, digits, CJK, literal spaces, hyphens, underscores, dots; max 64 chars
    if not re.match(r'^[\w \-.\u4e00-\u9fff\u3400-\u4dbf]{1,64}$', args.name):
        print(f'Error: invalid name "{args.name}" — '
              'only letters, digits, CJK, spaces, hyphens, underscores, dots allowed (max 64 chars)',
              file=sys.stderr)
        sys.exit(1)

    if args.direct:
        output_dir = os.path.expanduser(args.output)
    else:
        output_dir = os.path.join(os.path.expanduser(args.output), f'cola_avatar_pack_{args.name}')
    os.makedirs(output_dir, exist_ok=True)

    # Save base image as PNG — skip if only regenerating expressions (original already exists)
    base_output = os.path.join(output_dir, 'base_image.png')
    original_exists = os.path.exists(os.path.join(output_dir, 'base_image_original.png'))
    is_expression_only = original_exists and not args.line1 and not args.profile_only
    if is_expression_only:
        print(f'Skipping base image (original already exists)')
    else:
        print(f'Saving base image → {base_output}')
        save_base_image(args.base, base_output, name=args.name)

    # Generate profile card if at least line1 provided
    if args.line1:
        card_output = os.path.join(output_dir, 'profile_card.png')
        print(f'Generating profile card → {card_output}')
        generate_profile_card(
            base_output, args.name, args.line1, args.line2 or '', card_output,
            wuxing=args.wuxing, rarity=args.rarity
        )

    if args.profile_only:
        print(f'\nProfile card done! Output: {output_dir}')
        return

    # Process expression images — skip any not provided
    images = {
        'sad': args.sad,
        'angry': args.angry,
        'thinking': args.thinking,
    }
    # Full generation always includes happy.
    # Expression-only regen includes happy only when explicitly requested.
    if not is_expression_only or args.regen_happy:
        images['happy'] = args.base

    available = {}
    for emotion, path in images.items():
        if path and os.path.exists(path):
            available[emotion] = path
        elif path:
            print(f'Warning: {emotion} image not found: {path}, skipping', file=sys.stderr)

    # Meme requests are independent from expression generation
    has_meme_input = any([args.meme_confused, args.meme_annoyed, args.meme_cracked])

    if not available and not has_meme_input:
        print('Error: no expression or meme images found', file=sys.stderr)
        sys.exit(1)

    # Generate GIFs only when expression inputs exist
    for emotion, input_path in available.items():
        output_path = os.path.join(output_dir, f'{emotion}.gif')
        print(f'Generating {emotion}.gif → {output_path}')
        process_image(input_path, emotion, output_path, name=args.name)

    # Generate meme stickers
    if args.meme_confused:
        meme_path = os.path.join(output_dir, 'meme_confused.png')
        print(f'Generating meme_confused → {meme_path}')
        generate_meme_confused(args.meme_confused, meme_path)

    if args.meme_annoyed:
        meme_path = os.path.join(output_dir, 'meme_annoyed.png')
        print(f'Generating meme_annoyed → {meme_path}')
        generate_meme_annoyed(args.meme_annoyed, meme_path)

    if args.meme_cracked:
        meme_path = os.path.join(output_dir, 'meme_cracked.png')
        print(f'Generating meme_cracked → {meme_path}')
        generate_meme_cracked(args.meme_cracked, meme_path, locale=args.locale)

    print(f'\nDone! Output directory: {output_dir}')
    print(f'Files:')
    for f in sorted(os.listdir(output_dir)):
        size = os.path.getsize(os.path.join(output_dir, f))
        print(f'  {f} ({size // 1024}KB)')


if __name__ == '__main__':
    main()
