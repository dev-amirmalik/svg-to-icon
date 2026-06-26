// Convert an SVG document into a single normalized glyph path expressed in
// font units (y-up coordinate system), ready for opentype.js.
import svgpath from "svgpath";
import * as opentype from "opentype.js";

const SHAPE_TAGS = ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"];

function num(el, attr, fallback = 0) {
  const v = parseFloat(el.getAttribute(attr));
  return Number.isFinite(v) ? v : fallback;
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
function collectPaths(node, parentTransform, out) {
  for (const child of Array.from(node.children || [])) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "clippath" || tag === "mask" || tag === "symbol") continue;
    const ownTransform = child.getAttribute("transform") || "";
    const transform = [parentTransform, ownTransform].filter(Boolean).join(" ");
    if (tag === "g" || tag === "svg") {
      collectPaths(child, transform, out);
      continue;
    }
    if (SHAPE_TAGS.includes(tag)) {
      const d = shapeToD(child);
      if (!d) continue;
      const display = child.getAttribute("display");
      if (display === "none") continue;
      let p = svgpath(d);
      if (transform) p = p.transform(transform);
      out.push(p.toString());
    }
  }
}

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
  collectPaths(svg, "", paths);
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
