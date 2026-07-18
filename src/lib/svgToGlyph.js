// Convert an SVG document into a single normalized glyph path expressed in
// font units (y-up coordinate system), ready for opentype.js.
import svgpath from "svgpath";
import * as opentype from "opentype.js";
import polygonClipping from "polygon-clipping";

const SHAPE_TAGS = ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"];

function num(el, attr, fallback = 0) {
  const v = parseFloat(el.getAttribute(attr));
  return Number.isFinite(v) ? v : fallback;
}

// ---- Stroke outlining ---------------------------------------------------
// Many icon SVGs draw with `stroke` and no `fill` (e.g. line icons). A glyph
// only renders filled area, so a bare centerline collapses to nothing and the
// icon looks "broken / lines missing". We convert such strokes into filled
// outlines here. The outline is built from overlapping contours (a quad per
// segment + a disc at each vertex) all wound the same way; the non-zero fill
// rule then unions them, which is exactly how TrueType glyphs are filled.

function parseStyleAttr(el) {
  const out = {};
  const s = el.getAttribute && el.getAttribute("style");
  if (!s) return out;
  for (const decl of s.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    out[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim();
  }
  return out;
}

// Resolve the paint/stroke properties for an element, letting inline `style`
// win over presentation attributes, layered over inherited values.
function resolveStyle(el, inherited) {
  const style = parseStyleAttr(el);
  const own = (prop, attr) => {
    if (style[prop] != null && style[prop] !== "") return style[prop];
    const a = el.getAttribute && el.getAttribute(attr);
    return a != null && a !== "" ? a : undefined;
  };
  const merged = { ...inherited };
  const map = [
    ["fill", "fill"],
    ["stroke", "stroke"],
    ["strokeWidth", "stroke-width", "stroke-width"],
    ["linecap", "stroke-linecap"],
    ["linejoin", "stroke-linejoin"],
  ];
  for (const [key, prop, attr] of map) {
    const v = own(prop, attr || prop);
    if (v !== undefined) merged[key] = v;
  }
  return merged;
}

const isNone = (v) => v == null || v === "none" || v === "transparent";

function sampleCubic(p0, p1, p2, p3, n = 24) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x:
        u * u * u * p0.x +
        3 * u * u * t * p1.x +
        3 * u * t * t * p2.x +
        t * t * t * p3.x,
      y:
        u * u * u * p0.y +
        3 * u * u * t * p1.y +
        3 * u * t * t * p2.y +
        t * t * t * p3.y,
    });
  }
  return pts;
}

function sampleQuad(p0, p1, p2, n = 20) {
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return pts;
}

// Flatten a path "d" into subpaths of points: [{ pts: [{x,y}...], closed }].
function flattenPath(d) {
  const subs = [];
  let cur = null;
  const push = (x, y) => {
    if (!cur) return;
    const last = cur.pts[cur.pts.length - 1];
    if (last && Math.abs(last.x - x) < 1e-6 && Math.abs(last.y - y) < 1e-6)
      return;
    cur.pts.push({ x, y });
  };
  svgpath(d)
    .abs()
    .unarc()
    .unshort()
    .iterate((seg, _i, x, y) => {
      const c = seg[0];
      if (c === "M") {
        cur = { pts: [{ x: seg[1], y: seg[2] }], closed: false };
        subs.push(cur);
      } else if (c === "L") {
        push(seg[1], seg[2]);
      } else if (c === "H") {
        push(seg[1], y);
      } else if (c === "V") {
        push(x, seg[1]);
      } else if (c === "C") {
        for (const p of sampleCubic(
          { x, y },
          { x: seg[1], y: seg[2] },
          { x: seg[3], y: seg[4] },
          { x: seg[5], y: seg[6] },
        ))
          push(p.x, p.y);
      } else if (c === "Q") {
        for (const p of sampleQuad(
          { x, y },
          { x: seg[1], y: seg[2] },
          { x: seg[3], y: seg[4] },
        ))
          push(p.x, p.y);
      } else if (c === "Z" || c === "z") {
        if (cur) cur.closed = true;
      }
    });
  return subs.filter((s) => s.pts.length > 0);
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Force a consistent winding so raw contours still fill under non-zero rule
// (used only for the union() fallback path).
function normalize(ring) {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

// A closed disc ring (round join / cap), as [x,y] pairs.
function discRing(c, r, n = 16) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]);
  }
  pts.push(pts[0]);
  return pts;
}

// A closed rectangle ring covering a stroke segment, as [x,y] pairs.
function segQuadRing(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const nx = (-dy / len) * r;
  const ny = (dx / len) * r;
  const p = [
    [a.x + nx, a.y + ny],
    [b.x + nx, b.y + ny],
    [b.x - nx, b.y - ny],
    [a.x - nx, a.y - ny],
  ];
  p.push(p[0]);
  return p;
}

function ringToD(ring) {
  const f = (v) => Math.round(v * 1000) / 1000;
  let d = `M${f(ring[0][0])} ${f(ring[0][1])}`;
  for (let i = 1; i < ring.length; i++) d += `L${f(ring[i][0])} ${f(ring[i][1])}`;
  return d + "Z";
}

// Convert a stroked path "d" into a filled outline "d" with round caps/joins.
// The stroke is built from many overlapping pieces (a quad per segment + a disc
// per vertex), then unioned into clean, non-overlapping contours. This makes the
// generated glyph match the on-screen preview exactly and keeps it compact —
// raw overlapping contours rasterize with a different weight inside a font.
function outlineStroke(d, width) {
  const r = width / 2;
  if (!(r > 0)) return "";
  const polys = [];
  for (const sub of flattenPath(d)) {
    const seq = sub.closed ? [...sub.pts, sub.pts[0]] : sub.pts;
    for (let i = 0; i + 1 < seq.length; i++) {
      const q = segQuadRing(seq[i], seq[i + 1], r);
      if (q) polys.push([q]);
    }
    for (const v of sub.pts) polys.push([discRing(v, r)]); // round joins + caps
  }
  if (!polys.length) return "";
  try {
    const merged = polygonClipping.union(polys[0], ...polys.slice(1));
    let out = "";
    for (const poly of merged) for (const ring of poly) out += ringToD(ring);
    return out;
  } catch {
    // Fallback: emit the raw overlapping contours (still fills under non-zero).
    return polys.map((p) => ringToD(normalize(p[0]))).join(" ");
  }
}

// Turn a primitive shape element into an SVG path "d" string.
function shapeToD(el) {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "path":
      return el.getAttribute("d") || "";
    case "rect": {
      const x = num(el, "x");
      const y = num(el, "y");
      const w = num(el, "width");
      const h = num(el, "height");
      if (w <= 0 || h <= 0) return "";
      let rx = el.hasAttribute("rx") ? num(el, "rx") : NaN;
      let ry = el.hasAttribute("ry") ? num(el, "ry") : NaN;
      if (!Number.isFinite(rx) && Number.isFinite(ry)) rx = ry;
      if (!Number.isFinite(ry) && Number.isFinite(rx)) ry = rx;
      rx = Number.isFinite(rx) ? Math.min(rx, w / 2) : 0;
      ry = Number.isFinite(ry) ? Math.min(ry, h / 2) : 0;
      if (rx <= 0 || ry <= 0) {
        return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
      }
      return (
        `M${x + rx} ${y} ` +
        `H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} ` +
        `V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} ` +
        `H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} ` +
        `V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
      );
    }
    case "circle": {
      const cx = num(el, "cx");
      const cy = num(el, "cy");
      const r = num(el, "r");
      if (r <= 0) return "";
      return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
    }
    case "ellipse": {
      const cx = num(el, "cx");
      const cy = num(el, "cy");
      const rx = num(el, "rx");
      const ry = num(el, "ry");
      if (rx <= 0 || ry <= 0) return "";
      return `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
    }
    case "line": {
      return `M${num(el, "x1")} ${num(el, "y1")} L${num(el, "x2")} ${num(el, "y2")}`;
    }
    case "polyline":
    case "polygon": {
      const pts = (el.getAttribute("points") || "").trim();
      if (!pts) return "";
      const coords = pts.split(/[\s,]+/).map(Number);
      if (coords.length < 4) return "";
      let d = `M${coords[0]} ${coords[1]}`;
      for (let i = 2; i + 1 < coords.length; i += 2) d += ` L${coords[i]} ${coords[i + 1]}`;
      if (tag === "polygon") d += " Z";
      return d;
    }
    default:
      return "";
  }
}

// Recursively collect path "d" strings with parent transforms applied.
// `inherited` carries fill/stroke styling down the tree so stroke-only icons
// get their strokes outlined into fillable area.
function collectPaths(node, parentTransform, inherited, out) {
  for (const child of Array.from(node.children || [])) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "clippath" || tag === "mask" || tag === "symbol") continue;
    const ownTransform = child.getAttribute("transform") || "";
    const transform = [parentTransform, ownTransform].filter(Boolean).join(" ");
    const style = resolveStyle(child, inherited);
    if (tag === "g" || tag === "svg") {
      collectPaths(child, transform, style, out);
      continue;
    }
    if (SHAPE_TAGS.includes(tag)) {
      const d = shapeToD(child);
      if (!d) continue;
      const display = child.getAttribute("display");
      if (display === "none") continue;

      // A shape can contribute a fill, a stroke outline, or both.
      const pieces = [];
      if (!isNone(style.fill)) pieces.push(d);
      const sw = parseFloat(style.strokeWidth);
      if (!isNone(style.stroke) && Number.isFinite(sw) && sw > 0) {
        const outlined = outlineStroke(d, sw);
        if (outlined) pieces.push(outlined);
      }
      // Fallback: element with neither fill nor stroke resolved — treat as
      // filled so we never silently drop artwork.
      if (!pieces.length) pieces.push(d);

      for (const piece of pieces) {
        let p = svgpath(piece);
        if (transform) p = p.transform(transform);
        out.push(p.toString());
      }
    }
  }
}

// SVG defaults: fill is black, stroke is none.
const ROOT_STYLE = {
  fill: "black",
  stroke: "none",
  strokeWidth: "1",
  linecap: "butt",
  linejoin: "miter",
};

function parseViewBox(svg) {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
    }
  }
  const width = parseFloat(svg.getAttribute("width"));
  const height = parseFloat(svg.getAttribute("height"));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { minX: 0, minY: 0, width, height };
  }
  return { minX: 0, minY: 0, width: 1024, height: 1024 };
}

/**
 * Parse an SVG string and return { d, advanceWidth } in font units.
 * @param {string} svgText raw SVG markup
 * @param {number} unitsPerEm target em size (e.g. 1000)
 */
export function svgToGlyphPath(svgText, unitsPerEm = 1000) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const parseErr = doc.querySelector("parsererror");
  const svg = doc.querySelector("svg");
  if (parseErr || !svg) throw new Error("Invalid SVG file");

  const vb = parseViewBox(svg);
  const paths = [];
  // Seed inheritance with the root <svg>'s own fill/stroke (icons often set
  // fill="none" there) so children inherit it correctly.
  const rootStyle = resolveStyle(svg, ROOT_STYLE);
  collectPaths(svg, "", rootStyle, paths);
  const combined = paths.join(" ");
  if (!combined.trim()) {
    // Empty / unsupported icon: return an empty glyph so the build still works.
    return { d: "", advanceWidth: Math.round(unitsPerEm) };
  }

  const scale = unitsPerEm / vb.height;
  // Map SVG (y-down) into font units (y-up): translate to origin, scale + flip y,
  // then push up by one em so the top of the icon sits at y = unitsPerEm.
  const transformed = svgpath(combined)
    .translate(-vb.minX, -vb.minY)
    .scale(scale, -scale)
    .translate(0, unitsPerEm)
    .abs()
    .unarc()
    .unshort()
    .round(2)
    .toString();

  const advanceWidth = Math.round(vb.width * scale);
  return { d: transformed, advanceWidth: advanceWidth || Math.round(unitsPerEm) };
}

/**
 * Re-center a font-unit glyph path inside the em box based on its actual artwork
 * bounding box (ignoring the original viewBox framing), with uniform padding.
 * Returns a square glyph (advanceWidth = unitsPerEm) so icons sit centered in their cell.
 *
 * @param {string} d        font-unit path (y-up)
 * @param {number} unitsPerEm
 * @param {number} padding  fraction of the em to leave as margin on each side (0–0.45)
 */
export function centerGlyphPath(d, unitsPerEm = 1000, padding = 0.08) {
  if (!d || !d.trim()) return { d: "", advanceWidth: Math.round(unitsPerEm) };
  const bb = dToOpenTypePath(d).getBoundingBox();
  const w = bb.x2 - bb.x1;
  const h = bb.y2 - bb.y1;
  if (!(w > 0) || !(h > 0)) return { d, advanceWidth: Math.round(unitsPerEm) };

  const pad = Math.min(Math.max(padding, 0), 0.45);
  const box = unitsPerEm * (1 - 2 * pad);
  const scale = box / Math.max(w, h);
  const cx = (bb.x1 + bb.x2) / 2;
  const cy = (bb.y1 + bb.y2) / 2;

  const centered = svgpath(d)
    .translate(-cx, -cy) // move artwork center to origin
    .scale(scale) // fit into the padded box
    .translate(unitsPerEm / 2, unitsPerEm / 2) // recenter in the em
    .round(2)
    .toString();

  return { d: centered, advanceWidth: Math.round(unitsPerEm) };
}

/** Convert a font-unit "d" string into an opentype.js Path. */
export function dToOpenTypePath(d) {
  const path = new opentype.Path();
  if (!d) return path;
  svgpath(d)
    .abs()
    .unarc()
    .unshort()
    .iterate((seg, _i, x, y) => {
      const cmd = seg[0];
      switch (cmd) {
        case "M":
          path.moveTo(seg[1], seg[2]);
          break;
        case "L":
          path.lineTo(seg[1], seg[2]);
          break;
        case "H":
          path.lineTo(seg[1], y);
          break;
        case "V":
          path.lineTo(x, seg[1]);
          break;
        case "C":
          path.curveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
          break;
        case "Q":
          path.quadTo(seg[1], seg[2], seg[3], seg[4]);
          break;
        case "Z":
        case "z":
          path.close();
          break;
        default:
          break;
      }
    });
  return path;
}
