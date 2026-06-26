// Assemble icons into an icon font and all its companion assets.
import * as opentype from "opentype.js";
import ttf2woff from "ttf2woff";
import JSZip from "jszip";
import { dToOpenTypePath } from "./svgToGlyph.js";

function toUint8(out) {
  if (out instanceof Uint8Array) return out;
  if (out && out.buffer instanceof ArrayBuffer) return new Uint8Array(out.buffer);
  return new Uint8Array(out);
}

function unicodeHex(cp) {
  return cp.toString(16).toLowerCase();
}

/**
 * Build the font core: TTF (required) + WOFF (best-effort) + CSS + demo.
 * This never awaits anything that could hang, so the UI can show results immediately.
 * WOFF2 is generated separately via compressWoff2() because its WASM encoder can stall.
 *
 * @param {Array<{name,unicode,d,advanceWidth}>} icons
 * @param {{fontName:string, unitsPerEm:number, classPrefix:string}} options
 */
export function buildFont(icons, options) {
  const fontName = options.fontName || "icomoon";
  const unitsPerEm = options.unitsPerEm || 1000;
  const classPrefix = options.classPrefix || "icon-";
  const ascender = unitsPerEm;
  const descender = 0;

  const notdef = new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: unitsPerEm,
    path: new opentype.Path(),
  });

  const glyphs = [notdef];
  for (const icon of icons) {
    glyphs.push(
      new opentype.Glyph({
        name: icon.name,
        unicode: icon.unicode,
        advanceWidth: icon.advanceWidth || unitsPerEm,
        path: dToOpenTypePath(icon.d),
      })
    );
  }

  const font = new opentype.Font({
    familyName: fontName,
    styleName: "Regular",
    unitsPerEm,
    ascender,
    descender,
    glyphs,
  });

  const ttf = new Uint8Array(font.toArrayBuffer());

  let woff = null;
  try {
    woff = toUint8(ttf2woff(ttf));
  } catch (e) {
    console.warn("WOFF conversion failed:", e);
  }

  const css = generateCss({ fontName, classPrefix, icons });
  const demo = generateDemoHtml({ fontName, classPrefix, icons });

  return { ttf, woff, woff2: null, css, demo, fontName, classPrefix };
}

/**
 * Convert a TTF (Uint8Array) to WOFF2 using the wawoff2 WASM encoder.
 * Best-effort: resolves to null if the encoder is unavailable or times out.
 */
export async function compressWoff2(ttf, timeoutMs = 15000) {
  try {
    const load = (async () => {
      const mod = await import("wawoff2");
      const compress = mod.compress || (mod.default && mod.default.compress);
      if (!compress) throw new Error("wawoff2.compress not found");
      return toUint8(await compress(ttf));
    })();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WOFF2 timed out")), timeoutMs)
    );
    return await Promise.race([load, timeout]);
  } catch (e) {
    console.warn("WOFF2 conversion unavailable:", e);
    return null;
  }
}

export function generateCss({ fontName, classPrefix, icons }) {
  // Always list all three formats; browsers pick the first they support and
  // skip any file that isn't present.
  const srcs = [
    `url("fonts/${fontName}.woff2") format("woff2")`,
    `url("fonts/${fontName}.woff") format("woff")`,
    `url("fonts/${fontName}.ttf") format("truetype")`,
  ];

  const rules = icons
    .map((i) => `.${classPrefix}${i.name}:before {\n  content: "\\${unicodeHex(i.unicode)}";\n}`)
    .join("\n");

  return `@font-face {
  font-family: "${fontName}";
  src: ${srcs.join(",\n       ")};
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

[class^="${classPrefix}"],
[class*=" ${classPrefix}"] {
  font-family: "${fontName}" !important;
  speak: never;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

${rules}
`;
}

export function generateDemoHtml({ fontName, classPrefix, icons }) {
  const cells = icons
    .map(
      (i) => `      <div class="cell">
        <span class="${classPrefix}${i.name}"></span>
        <div class="meta"><code>${classPrefix}${i.name}</code><span>\\${unicodeHex(
        i.unicode
      )}</span></div>
      </div>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${fontName} — icon cheatsheet</title>
  <link rel="stylesheet" href="style.css" />
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 32px; background:#0f1115; color:#e6e8ee; }
    h1 { font-weight: 650; font-size: 20px; }
    p.sub { color:#9aa3b2; margin-top:4px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap:14px; margin-top:24px; }
    .cell { background:#181b22; border:1px solid #262b36; border-radius:12px; padding:18px 12px; text-align:center; transition:.15s; }
    .cell:hover { border-color:#4c6ef5; transform:translateY(-2px); }
    .cell span[class^="${classPrefix}"], .cell span[class*=" ${classPrefix}"] { font-size:34px; color:#e6e8ee; display:block; }
    .meta { margin-top:12px; display:flex; flex-direction:column; gap:2px; }
    .meta code { font-size:11px; color:#aeb6c6; word-break:break-all; }
    .meta span { font-size:11px; color:#5b6473; }
  </style>
</head>
<body>
  <h1>${fontName}</h1>
  <p class="sub">${icons.length} icons. Use a class like <code>${classPrefix}${icons[0]?.name || "name"}</code> on an element.</p>
  <div class="grid">
${cells}
  </div>
</body>
</html>
`;
}

/** Package everything into a downloadable zip Blob. */
export async function packageZip(result) {
  const { ttf, woff, woff2, css, demo, fontName } = result;
  const zip = new JSZip();
  const fonts = zip.folder("fonts");
  fonts.file(`${fontName}.ttf`, ttf);
  if (woff) fonts.file(`${fontName}.woff`, woff);
  if (woff2) fonts.file(`${fontName}.woff2`, woff2);
  zip.file("style.css", css);
  zip.file("demo.html", demo);
  return zip.generateAsync({ type: "blob" });
}
