import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import svgpath from "svgpath";
import { svgToGlyphPath, centerGlyphPath } from "./lib/svgToGlyph.js";
import { buildFont, compressWoff2, packageZip } from "./lib/buildFont.js";
import { importFontFile } from "./lib/importFont.js";
import { loadState, saveState, clearState, serializeIcons } from "./lib/storage.js";

const START_CODEPOINT = 0xe900; // private-use area, IcoMoon convention

function sanitizeName(filename) {
  return (
    filename
      .replace(/\.(svg|ttf|otf|woff2?|eot)$/i, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "icon"
  );
}

// Lowest free codepoint above everything already used (and above the PUA start).
function nextFreeCode(list) {
  const max = list.reduce((m, i) => Math.max(m, i.unicode || 0), START_CODEPOINT - 1);
  return max + 1;
}

// Ensure a name is unique within the set by suffixing -1, -2, ...
function uniqueName(base, taken) {
  let name = base;
  let n = 1;
  while (taken.has(name)) name = `${base}-${n++}`;
  taken.add(name);
  return name;
}

// Derive the font-unit path + advance width for an icon at the current em size.
// Works for both SVG-sourced icons (re-normalized) and imported-glyph icons (rescaled).
// When `fit` is on, the artwork is trimmed to its bounds and centered with `padding`.
function deriveGlyph(icon, em, fit = false, padding = 0.08) {
  let base;
  if (icon.svg) base = svgToGlyphPath(icon.svg, em);
  else if (icon.glyphPath) {
    const s = em / (icon.srcEm || em);
    const d =
      s === 1 ? icon.glyphPath : svgpath(icon.glyphPath).scale(s).round(2).toString();
    base = { d, advanceWidth: Math.round((icon.rawAdvance || em) * s) };
  } else {
    base = { d: icon.d || "", advanceWidth: icon.advanceWidth || em };
  }
  if (fit && base.d) return centerGlyphPath(base.d, em, padding);
  return base;
}

function downloadBlob(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let nextId = 1;

// Rebuild full icon objects (derived geometry) from saved records.
function hydrateIcons(saved, em, fit, padding) {
  return saved.map((s) => {
    let d = "";
    let advanceWidth = em;
    try {
      ({ d, advanceWidth } = deriveGlyph(s, em, fit, padding));
    } catch {
      /* keep empty */
    }
    return { ...s, d, advanceWidth, empty: !d };
  });
}

// Load persisted state once at startup (browser only).
const PERSISTED = typeof window !== "undefined" ? loadState() : null;
if (PERSISTED?.icons?.length) {
  nextId = PERSISTED.icons.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1;
}

export default function App() {
  const initialEm = PERSISTED?.settings?.unitsPerEm || 1000;
  const initialFit = PERSISTED?.settings?.fit ?? true;
  const initialPadding = PERSISTED?.settings?.padding ?? 0.08;
  const [icons, setIcons] = useState(() =>
    PERSISTED?.icons?.length
      ? hydrateIcons(PERSISTED.icons, initialEm, initialFit, initialPadding)
      : []
  );
  const [fontName, setFontName] = useState(PERSISTED?.settings?.fontName || "myicon");
  const [classPrefix, setClassPrefix] = useState(PERSISTED?.settings?.classPrefix || "icon-");
  const [unitsPerEm, setUnitsPerEm] = useState(initialEm);
  const [fit, setFit] = useState(initialFit);
  const [padding, setPadding] = useState(initialPadding);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [importDragging, setImportDragging] = useState(false);
  const fileInput = useRef(null);
  const fontInput = useRef(null);

  const addFiles = useCallback(
    async (fileList) => {
      setError("");
      const files = Array.from(fileList).filter((f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml");
      if (!files.length) {
        setError("No SVG files found. Please drop .svg files.");
        return;
      }
      const parsed = [];
      for (const file of files) {
        try {
          const text = await file.text();
          const item = { id: nextId++, name: sanitizeName(file.name), svg: text };
          const { d, advanceWidth } = deriveGlyph(item, unitsPerEm, fit, padding);
          parsed.push({ ...item, d, advanceWidth, empty: !d });
        } catch (e) {
          parsed.push({ id: nextId++, name: sanitizeName(file.name), error: e.message });
        }
      }
      setResult(null);
      setIcons((prev) => {
        const taken = new Set(prev.map((i) => i.name));
        let code = nextFreeCode(prev);
        const added = parsed
          .filter((p) => !p.error)
          .map((p) => ({ ...p, name: uniqueName(p.name, taken), unicode: code++ }));
        return [...prev, ...added];
      });
      const failed = parsed.filter((p) => p.error);
      if (failed.length) setError(`${failed.length} file(s) could not be parsed.`);
    },
    [unitsPerEm, fit, padding]
  );

  const importFont = useCallback(
    async (file) => {
      setError("");
      try {
        const buf = await file.arrayBuffer();
        const glyphs = await importFontFile(buf);
        setResult(null);
        setIcons((prev) => {
          const taken = new Set(prev.map((i) => i.name));
          const usedCodes = new Set(prev.map((i) => i.unicode));
          let fallback = nextFreeCode(prev);
          const added = glyphs.map((g) => {
            const { d, advanceWidth } = deriveGlyph(g, unitsPerEm, fit, padding);
            // Preserve the original codepoint; if it collides, assign a free one.
            let unicode = g.unicode;
            if (usedCodes.has(unicode)) {
              while (usedCodes.has(fallback)) fallback++;
              unicode = fallback;
            }
            usedCodes.add(unicode);
            return {
              id: nextId++,
              name: uniqueName(sanitizeName(g.name), taken),
              unicode,
              srcEm: g.srcEm,
              glyphPath: g.glyphPath,
              rawAdvance: g.rawAdvance,
              d,
              advanceWidth,
              empty: !d,
            };
          });
          return [...prev, ...added];
        });
      } catch (e) {
        console.error(e);
        setError(e.message || "Could not import this font.");
      }
    },
    [unitsPerEm, fit, padding]
  );

  // Route dropped/selected files: SVGs become icons, font files get imported.
  const routeFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList);
      const svgs = files.filter((f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml");
      const fonts = files.filter(
        (f) => /\.(ttf|otf|woff2?|eot)$/i.test(f.name) || /^font\//.test(f.type)
      );
      if (svgs.length) addFiles(svgs);
      fonts.forEach((f) => importFont(f));
      if (!svgs.length && !fonts.length) {
        setError("Drop SVG icons or a font file (.ttf / .otf / .woff / .woff2).");
      }
    },
    [addFiles, importFont]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      routeFiles(e.dataTransfer.files);
    },
    [routeFiles]
  );

  const removeIcon = (id) =>
    setIcons((prev) => prev.filter((i) => i.id !== id));

  const renameIcon = (id, name) =>
    setIcons((prev) => prev.map((i) => (i.id === id ? { ...i, name } : i)));

  const clearAll = () => {
    setIcons([]);
    setResult(null);
    setError("");
    clearState();
  };

  // Re-derive glyph geometry when em size / centering / padding change.
  useEffect(() => {
    setIcons((prev) =>
      prev.map((ic) => {
        try {
          const { d, advanceWidth } = deriveGlyph(ic, unitsPerEm, fit, padding);
          return { ...ic, d, advanceWidth, empty: !d };
        } catch {
          return ic;
        }
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsPerEm, fit, padding]);

  // Auto-save icons + settings to localStorage so a reload doesn't lose work.
  useEffect(() => {
    const ok = saveState({
      version: 1,
      settings: { fontName, classPrefix, unitsPerEm, fit, padding },
      icons: serializeIcons(icons),
    });
    if (!ok && icons.length) {
      setError(
        "Heads up: couldn't auto-save — the icon set may be too large for this browser's storage."
      );
    }
  }, [icons, fontName, classPrefix, unitsPerEm, fit, padding]);

  const generate = async () => {
    setError("");
    if (!icons.length) {
      setError("Add some SVG icons first.");
      return;
    }
    const dups = [...dupNames];
    if (dups.length) {
      setError(
        `Duplicate icon name${dups.length > 1 ? "s" : ""}: ${dups.join(", ")}. Rename the highlighted icon${
          dups.length > 1 ? "s" : ""
        }.`
      );
      return;
    }
    const codes = icons.map((i) => i.unicode);
    if (new Set(codes).size !== codes.length) {
      setError("Two icons share the same codepoint. Remove or re-import one.");
      return;
    }
    setBusy(true);
    try {
      // Core (TTF + WOFF + CSS + demo) is fast and never hangs — show it immediately.
      const res = buildFont(icons, { fontName, classPrefix, unitsPerEm });
      setResult(res);
      setBusy(false);

      // Live preview font — best-effort, runs in the background.
      const family = `preview-${fontName}-${Date.now()}`;
      (async () => {
        try {
          const previewUrl = URL.createObjectURL(
            new Blob([res.woff || res.ttf], { type: "font/woff" })
          );
          const face = new FontFace(family, `url(${previewUrl})`);
          await face.load();
          document.fonts.add(face);
          setResult((r) => (r === res ? { ...r, previewFamily: family } : r));
        } catch (e) {
          console.warn("Preview font load failed:", e);
        }
      })();

      // WOFF2 — optional, may be unavailable; runs in the background with a timeout.
      (async () => {
        const woff2 = await compressWoff2(res.ttf);
        if (woff2) setResult((r) => (r === res ? { ...r, woff2 } : r));
      })();
    } catch (e) {
      console.error(e);
      setError("Font generation failed: " + e.message);
      setBusy(false);
    }
  };

  const downloadZip = async () => {
    if (!result) return;
    const blob = await packageZip(result);
    downloadBlob(blob, `${fontName}.zip`, "application/zip");
  };

  const validCount = useMemo(() => icons.filter((i) => !i.empty).length, [icons]);

  // Names used by more than one icon (live duplicate detection while editing).
  const dupNames = useMemo(() => {
    const counts = {};
    for (const i of icons) counts[i.name] = (counts[i.name] || 0) + 1;
    return new Set(Object.keys(counts).filter((n) => counts[n] > 1));
  }, [icons]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">✦</span>
          <div>
            <h1>SVG → Icon Font</h1>
            <p>Turn SVG icons into a web font — TTF, WOFF, WOFF2, CSS &amp; demo. Runs entirely in your browser.</p>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="left">
          <div
            className={`dropzone ${dragging ? "drag" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".svg,image/svg+xml"
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <div className="dz-inner">
              <div className="dz-icon">⬆</div>
              <strong>Drop SVG files here</strong>
              <span>or click to browse — you can also drop a font file to import</span>
            </div>
          </div>

          <div
            className={`import-row ${importDragging ? "drag" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setImportDragging(true);
            }}
            onDragLeave={() => setImportDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setImportDragging(false);
              routeFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fontInput}
              type="file"
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
              hidden
              onChange={(e) => {
                if (e.target.files[0]) importFont(e.target.files[0]);
                e.target.value = "";
              }}
            />
            <button className="ghost wide" onClick={() => fontInput.current?.click()}>
              ⤓ Import existing font (.ttf / .otf / .woff / .woff2)
            </button>
            <span className="import-hint">
              Click, or drop a font file here — loads an old icon font so you can add or edit
              icons, keeping its codepoints.
            </span>
          </div>

          {error && <div className="error">{error}</div>}

          {icons.length > 0 && (
            <div className="toolbar">
              <span>
                {icons.length} icon{icons.length !== 1 ? "s" : ""}
                {validCount !== icons.length ? ` (${icons.length - validCount} empty)` : ""}
                <span className="saved-hint" title="Saved in this browser — survives reloads">
                  · auto-saved
                </span>
              </span>
              <button className="ghost" onClick={clearAll}>
                Clear all
              </button>
            </div>
          )}

          <div className="grid">
            {icons.map((ic) => (
              <div
                className={`tile ${ic.empty ? "tile-empty" : ""} ${
                  dupNames.has(ic.name) ? "tile-dup" : ""
                }`}
                key={ic.id}
              >
                <button className="tile-remove" title="Remove" onClick={() => removeIcon(ic.id)}>
                  ×
                </button>
                <div className="tile-preview">
                  {ic.d ? (
                    <svg viewBox={`0 0 ${unitsPerEm} ${unitsPerEm}`} aria-label={ic.name}>
                      <g transform={`translate(0 ${unitsPerEm}) scale(1 -1)`}>
                        <path d={ic.d} fill="currentColor" />
                      </g>
                    </svg>
                  ) : (
                    <span className="tile-blank">∅</span>
                  )}
                </div>
                <input
                  className="tile-name"
                  value={ic.name}
                  spellCheck={false}
                  title={dupNames.has(ic.name) ? "Duplicate name — must be unique" : ic.name}
                  onChange={(e) => renameIcon(ic.id, sanitizeName(e.target.value))}
                />
                {dupNames.has(ic.name) ? (
                  <span className="tile-dup-label">duplicate</span>
                ) : (
                  <code className="tile-code">{ic.unicode.toString(16)}</code>
                )}
              </div>
            ))}
          </div>
        </section>

        <aside className="right">
          <h2>Font settings</h2>
          <label>
            Font name
            <input value={fontName} onChange={(e) => setFontName(e.target.value.trim() || "myicon")} />
          </label>
          <label>
            CSS class prefix
            <input value={classPrefix} onChange={(e) => setClassPrefix(e.target.value)} />
          </label>
          <label>
            Units per em
            <select value={unitsPerEm} onChange={(e) => setUnitsPerEm(Number(e.target.value))}>
              <option value={1000}>1000</option>
              <option value={1024}>1024</option>
              <option value={2048}>2048</option>
            </select>
          </label>

          <label className="check">
            <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />
            Center &amp; trim icons
            <span className="check-hint">
              Centers each icon by its actual artwork (fixes off-center / corner icons).
            </span>
          </label>

          <label className={fit ? "" : "disabled"}>
            Padding: {Math.round(padding * 100)}%
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={Math.round(padding * 100)}
              disabled={!fit}
              onChange={(e) => setPadding(Number(e.target.value) / 100)}
            />
          </label>

          <button
            className="primary"
            disabled={busy || !icons.length || dupNames.size > 0}
            title={dupNames.size > 0 ? "Resolve duplicate icon names first" : ""}
            onClick={generate}
          >
            {busy ? "Generating…" : dupNames.size > 0 ? "Fix duplicate names" : "Generate font"}
          </button>

          {result && (
            <div className="downloads">
              <h3>Download</h3>
              <button className="dl" onClick={() => downloadBlob(result.ttf, `${fontName}.ttf`, "font/ttf")}>
                {fontName}.ttf
              </button>
              <button
                className="dl"
                disabled={!result.woff}
                onClick={() => downloadBlob(result.woff, `${fontName}.woff`, "font/woff")}
              >
                {fontName}.woff
              </button>
              <button
                className="dl"
                disabled={!result.woff2}
                onClick={() => downloadBlob(result.woff2, `${fontName}.woff2`, "font/woff2")}
                title={result.woff2 ? "" : "WOFF2 unavailable in this browser"}
              >
                {fontName}.woff2{!result.woff2 ? " (n/a)" : ""}
              </button>
              <button className="dl" onClick={() => downloadBlob(result.css, "style.css", "text/css")}>
                style.css
              </button>
              <button className="dl" onClick={() => downloadBlob(result.demo, "demo.html", "text/html")}>
                demo.html
              </button>
              <button className="primary block" onClick={downloadZip}>
                ⬇ Download all (.zip)
              </button>
            </div>
          )}

          {result && (
            <div className="font-preview">
              <h3>Font preview</h3>
              <div className="fp-grid">
                {icons.map((ic) => (
                  <div className="fp-cell" key={ic.id} title={`${classPrefix}${ic.name}`}>
                    <span style={{ fontFamily: result.previewFamily }}>
                      {String.fromCodePoint(ic.unicode)}
                    </span>
                    <small>{ic.name}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
