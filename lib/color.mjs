// WCAG 2.x colour math. Every function is self-contained so it can be stringified into the page.

export function parseColor(s) {
  if (!s) return null;
  s = String(s).trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  // color(srgb r g b / a) is what Chromium reports for some computed colours.
  m = s.match(/^color\(srgb\s+([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat);
    return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
  }
  return null;
}

// Paint `top` (with alpha) over an opaque `bottom`.
export function blend(top, bottom) {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1);
}

export function luminance(c) {
  const ch = c.slice(0, 3).map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// WCAG "large text": >= 24px, or >= 18.66px and bold.
export function isLargeText(px, weight) {
  return px >= 24 || (px >= 18.66 && Number(weight) >= 700);
}

export const COLOR_SRC = [parseColor, blend, luminance, contrast, isLargeText].map((f) => f.toString()).join('\n');
