"""Write the ScamCheck logo SVGs. Edit the constants, then run this file."""

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT_PATH = "/usr/share/fonts/truetype/macos/Inter-Medium.ttf"

INK = "#1C1714"
PAPER = "#F3EFE6"
CLAY = "#946443"
NIGHT = "#161311"
IVORY = "#F4EFE6"
CLAY_ON_DARK = "#C6A27A"

# Short stroke, then long stroke. The corner is the lowest point.
SHORT = (7, 22, 15, 28)
LONG = (15, 28, 33, 11)
STROKE = 4.25


def mark_paths(ink, clay):
    """Both arms end on the same point. Ink is drawn second, so its round cap is the corner."""
    sx, sy, vx, vy = SHORT
    _, _, ex, ey = LONG
    sw = STROKE
    clay_path = f'<path d="M{vx} {vy} L{ex} {ey}" stroke="{clay}" stroke-width="{sw}" stroke-linecap="round"/>'
    ink_path = f'<path d="M{sx} {sy} L{vx} {vy}" stroke="{ink}" stroke-width="{sw}" stroke-linecap="round"/>'
    return clay_path, ink_path


def mono_path(color):
    sx, sy, vx, vy = SHORT
    _, _, ex, ey = LONG
    return f'<path d="M{sx} {sy} L{vx} {vy} L{ex} {ey}" stroke="{color}" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round"/>'


def word_paths(text, size, tracking, fill):
    font = TTFont(FONT_PATH)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    scale = size / upem
    x = 0
    paths = []
    for ch in text:
        glyph = glyph_set[cmap[ord(ch)]]
        pen = SVGPathPen(glyph_set)
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        commands = pen.getCommands()
        if commands:
            paths.append(f'<path d="{commands}" fill="{fill}"/>')
        x += glyph.width * scale + tracking
    return x - tracking, "\n".join(paths)


def svg(body, w, h, label):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" fill="none" role="img" aria-label="{label}">\n'
        f"{body}\n</svg>\n"
    )


def write(name, text):
    path = f"/workspace/design/logo/{name}"
    with open(path, "w") as f:
        f.write(text)
    print(name)


def main():
    clay, ink = mark_paths(INK, CLAY)
    clay_d, ivory = mark_paths(IVORY, CLAY_ON_DARK)
    mark = f"{clay}\n{ink}"
    mark_dark = f"{clay_d}\n{ivory}"

    write("mark.svg", svg(mono_path(INK), 40, 40, "ScamCheck"))
    write("mark-two-color.svg", svg(mark, 40, 40, "ScamCheck"))

    width, paths = word_paths("ScamCheck", 40, -1.15, INK)
    word = f'<g transform="translate(0 31)">\n{paths}\n</g>'
    write("wordmark.svg", svg(word, round(width + 1, 2), 36, "ScamCheck"))

    # Lockup. Cap center of a 34px Inter Medium sits 12.36px above the baseline.
    size = 34
    cap_center = (1490 / 2048) * size / 2
    baseline = 58
    text_width, text = word_paths("ScamCheck", size, -1.05, INK)
    text_dark_w, text_dark = word_paths("ScamCheck", size, -1.05, IVORY)
    mark_y = baseline - cap_center - 19.5
    lockup_w = round(92 + text_width + 28, 2)
    lockup_h = 88
    g = f'<g transform="translate(26 {mark_y:.2f})">\n{mark}\n</g>\n<g transform="translate(84 {baseline})">\n{text}\n</g>'
    g_dark = f'<g transform="translate(26 {mark_y:.2f})">\n{mark_dark}\n</g>\n<g transform="translate(84 {baseline})">\n{text_dark}\n</g>'
    mono = f'<g transform="translate(26 {mark_y:.2f})">\n{mono_path(INK)}\n</g>\n<g transform="translate(84 {baseline})">\n{text}\n</g>'
    write("lockup.svg", svg(g, lockup_w, lockup_h, "ScamCheck"))
    write("lockup-mono.svg", svg(mono, lockup_w, lockup_h, "ScamCheck"))
    write(
        "lockup-on-light.svg",
        svg(f'<rect width="{lockup_w}" height="{lockup_h}" fill="{PAPER}"/>\n{g}', lockup_w, lockup_h, "ScamCheck"),
    )
    write(
        "lockup-on-dark.svg",
        svg(f'<rect width="{lockup_w}" height="{lockup_h}" fill="{NIGHT}"/>\n{g_dark}', lockup_w, lockup_h, "ScamCheck"),
    )

    def icon(bg, strokes):
        return svg(
            f'<rect width="80" height="80" rx="18" fill="{bg}"/>\n'
            f'<g transform="translate(40 41) scale(1.52) translate(-20 -19.5)">\n{strokes}\n</g>',
            80,
            80,
            "ScamCheck",
        )

    write("app-icon-light.svg", icon(PAPER, mark))
    write("app-icon-dark.svg", icon(NIGHT, mark_dark))
    print("text width", round(text_width, 1), "mark y", round(mark_y, 2))


if __name__ == "__main__":
    main()
