// Import an existing icon font and extract its glyphs as editable icons.
// Supports TTF, OTF, WOFF directly (opentype.js) and WOFF2 (decompressed via wawoff2).
import * as opentype from "opentype.js";

function magicOf(bytes) {
  if (bytes.length < 4) return "";
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

// Return a clean ArrayBuffer slice for a Uint8Array (handles byteOffset).
function toArrayBuffer(u8) {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
    ? u8.buffer
    : u8.slice().buffer;
}

/**
 * Parse a font file (ArrayBuffer) and return an array of imported icon records:
 * { name, unicode, srcEm, glyphPath (font-unit y-up "d"), rawAdvance, previewSvg }
 */
export async function importFontFile(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const magic = magicOf(bytes);

  let buffer = arrayBuffer;
  if (magic === "wOF2") {
    // WOFF2 → decompress to SFNT (TTF) first.
    let decompress;
    try {
      const mod = await import("wawoff2");
      decompress = mod.decompress || (mod.default && mod.default.decompress);
    } catch {
      /* handled below */
    }
    if (!decompress) {
      throw new Error(
        "WOFF2 fonts can't be read in this browser. Please convert it to TTF or WOFF first."
      );
    }
    const out = await decompress(bytes);
    const ttf = out instanceof Uint8Array ? out : new Uint8Array(out);
    buffer = toArrayBuffer(ttf);
  }

  let font;
  try {
    font = opentype.parse(buffer);
  } catch (e) {
    throw new Error("Could not read this font file: " + e.message);
  }

  const em = font.unitsPerEm || 1000;
  const icons = [];
  const total = font.glyphs.length;

  for (let i = 0; i < total; i++) {
    const g = font.glyphs.get(i);
    if (!g || g.name === ".notdef") continue;

    const unicode = g.unicode; // first assigned codepoint, if any
    if (unicode == null) continue; // skip unmapped glyphs

    const d = g.path && g.path.toPathData ? g.path.toPathData(2) : "";
    if (!d || !d.trim()) continue; // skip blank glyphs (e.g. space)

    const rawAdvance = g.advanceWidth || em;
    // Preview in normal (y-down) SVG space.
    const preview = g.getPath(0, em, em).toSVG(2);
    const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(
      Math.round(rawAdvance),
      1
    )} ${em}">${preview}</svg>`;

    icons.push({
      name: g.name || `glyph-${unicode.toString(16)}`,
      unicode,
      srcEm: em,
      glyphPath: d,
      rawAdvance,
      previewSvg,
    });
  }

  if (!icons.length) {
    throw new Error("No usable glyphs with Unicode mappings were found in this font.");
  }
  return icons;
}
