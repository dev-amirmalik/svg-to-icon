import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import svgpath from "svgpath";
import { svgToGlyphPath, centerGlyphPath } from "./lib/svgToGlyph.js";
import { buildFont, compressWoff2, packageZip } from "./lib/buildFont.js";
import { importFontFile } from "./lib/importFont.js";
import {
  loadState,
  saveState,
  clearState,
  serializeIcons,
} from "./lib/storage.js";
import { Analytics } from "@vercel/analytics/react";

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
  const max = list.reduce(
    (m, i) => Math.max(m, i.unicode || 0),
    START_CODEPOINT - 1,
  );
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
      s === 1
        ? icon.glyphPath
        : svgpath(icon.glyphPath).scale(s).round(2).toString();
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
      : [],
  );
  const [fontName, setFontName] = useState(
    PERSISTED?.settings?.fontName || "myicon",
  );
  const [classPrefix, setClassPrefix] = useState(
    PERSISTED?.settings?.classPrefix || "icon-",
  );
  const [unitsPerEm, setUnitsPerEm] = useState(initialEm);
  const [fit, setFit] = useState(initialFit);
  const [padding, setPadding] = useState(initialPadding);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [importDragging, setImportDragging] = useState(false);
  const [tab, setTab] = useState("svg"); // "svg" | "font"
  const [modal, setModal] = useState(null); // null | "howto" | "preview"
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return localStorage.getItem("theme") || "light";
  });
  const fileInput = useRef(null);
  const fontInput = useRef(null);

  // Close the lightbox on Escape.
  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => e.key === "Escape" && setModal(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  // Apply the theme to <html> and remember the choice across reloads.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore storage errors */
    }
  }, [theme]);

  const addFiles = useCallback(
    async (fileList) => {
      setError("");
      const files = Array.from(fileList).filter(
        (f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml",
      );
      if (!files.length) {
        setError("No SVG files found. Please drop .svg files.");
        return;
      }
      const parsed = [];
      for (const file of files) {
        try {
          const text = await file.text();
          const item = {
            id: nextId++,
            name: sanitizeName(file.name),
            svg: text,
          };
          const { d, advanceWidth } = deriveGlyph(
            item,
            unitsPerEm,
            fit,
            padding,
          );
          parsed.push({ ...item, d, advanceWidth, empty: !d });
        } catch (e) {
          parsed.push({
            id: nextId++,
            name: sanitizeName(file.name),
            error: e.message,
          });
        }
      }
      setResult(null);
      setIcons((prev) => {
        const taken = new Set(prev.map((i) => i.name));
        let code = nextFreeCode(prev);
        const added = parsed
          .filter((p) => !p.error)
          .map((p) => ({
            ...p,
            name: uniqueName(p.name, taken),
            unicode: code++,
          }));
        return [...prev, ...added];
      });
      const failed = parsed.filter((p) => p.error);
      if (failed.length)
        setError(`${failed.length} file(s) could not be parsed.`);
    },
    [unitsPerEm, fit, padding],
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
            const { d, advanceWidth } = deriveGlyph(
              g,
              unitsPerEm,
              fit,
              padding,
            );
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
    [unitsPerEm, fit, padding],
  );

  const isSvg = (f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml";
  const isFont = (f) =>
    /\.(ttf|otf|woff2?|eot)$/i.test(f.name) || /^font\//.test(f.type);

  // SVG tab: accept only SVGs; nudge to the Import-font tab if a font is dropped.
  const onDropSvg = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      const svgs = files.filter(isSvg);
      if (svgs.length) addFiles(svgs);
      else if (files.some(isFont))
        setError('That looks like a font — switch to the "Import font" tab.');
      else setError("No SVG files found. Please drop .svg files.");
    },
    [addFiles],
  );

  // Font tab: accept only font files; nudge to the SVG tab if an SVG is dropped.
  const onDropFont = useCallback(
    (e) => {
      e.preventDefault();
      setImportDragging(false);
      const files = Array.from(e.dataTransfer.files);
      const fonts = files.filter(isFont);
      if (fonts.length) fonts.forEach((f) => importFont(f));
      else if (files.some(isSvg))
        setError('That’s an SVG — switch to the "Add SVG icons" tab.');
      else setError("Drop a font file (.ttf / .otf / .woff / .woff2).");
    },
    [importFont],
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
      }),
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
        "Heads up: couldn't auto-save — the icon set may be too large for this browser's storage.",
      );
    }
  }, [icons, fontName, classPrefix, unitsPerEm, fit, padding]);

  const generate = async () => {
    setError("");
    if (!fontName.trim()) {
      setError("Font name is required.");
      return;
    }
    if (!icons.length) {
      setError("Add some SVG icons first.");
      return;
    }
    const dups = [...dupNames];
    if (dups.length) {
      setError(
        `Duplicate icon name${dups.length > 1 ? "s" : ""}: ${dups.join(", ")}. Rename the highlighted icon${
          dups.length > 1 ? "s" : ""
        }.`,
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
            new Blob([res.woff || res.ttf], { type: "font/woff" }),
          );
          const face = new FontFace(family, `url(${previewUrl})`);
          await face.load();
          document.fonts.add(face);
          setResult((r) => (r === res ? { ...r, previewFamily: family } : r));
        } catch (e) {
          console.warn("Preview font load failed:", e);
        }
      })();

      // WOFF2 — optional; runs in the background. On failure we record the
      // reason so the download button can explain why it's unavailable.
      (async () => {
        const { woff2, error: woff2Error } = await compressWoff2(res.ttf);
        setResult((r) =>
          r === res ? { ...r, woff2, woff2Error } : r,
        );
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

  const validCount = useMemo(
    () => icons.filter((i) => !i.empty).length,
    [icons],
  );

  // Names used by more than one icon (live duplicate detection while editing).
  const dupNames = useMemo(() => {
    const counts = {};
    for (const i of icons) counts[i.name] = (counts[i.name] || 0) + 1;
    return new Set(Object.keys(counts).filter((n) => counts[n] > 1));
  }, [icons]);

  return (
    <div className="app">
      <Analytics />
      <header className="topbar">
        <div className="brand">
          <span className="logo">✦</span>
          <div>
            <h1>SVG → Icon Font</h1>
            <p>
              Turn SVG icons into a web font — TTF, WOFF, WOFF2, CSS &amp; demo.
              Runs entirely in your browser.
            </p>
          </div>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          aria-label="Toggle color theme"
        >
          <span className="tt-icon">{theme === "dark" ? "☀" : "☾"}</span>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>

      <main className="layout">
        <section className="left">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "svg"}
              className={`tab ${tab === "svg" ? "active" : ""}`}
              onClick={() => setTab("svg")}
            >
              Add SVG icons
            </button>
            <button
              role="tab"
              aria-selected={tab === "font"}
              className={`tab ${tab === "font" ? "active" : ""}`}
              onClick={() => setTab("font")}
            >
              Import existing font
            </button>
          </div>

          {tab === "svg" ? (
            <div
              className={`dropzone ${dragging ? "drag" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDropSvg}
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
                <span>or click to browse — .svg icons only</span>
              </div>
            </div>
          ) : (
            <div
              className={`dropzone ${importDragging ? "drag" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setImportDragging(true);
              }}
              onDragLeave={() => setImportDragging(false)}
              onDrop={onDropFont}
              onClick={() => fontInput.current?.click()}
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
              <div className="dz-inner">
                <div className="dz-icon">⤓</div>
                <strong>Drop a font file here</strong>
                <span>
                  or click to browse — .ttf / .otf / .woff / .woff2. Loads an
                  existing icon font so you can add or edit icons, keeping its
                  codepoints.
                </span>
              </div>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {icons.length > 0 && (
            <div className="toolbar">
              <span>
                {icons.length} icon{icons.length !== 1 ? "s" : ""}
                {validCount !== icons.length
                  ? ` (${icons.length - validCount} empty)`
                  : ""}
                <span
                  className="saved-hint"
                  title="Saved in this browser — survives reloads"
                >
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
                <button
                  className="tile-remove"
                  title="Remove"
                  onClick={() => removeIcon(ic.id)}
                >
                  ×
                </button>
                <div className="tile-preview">
                  {ic.d ? (
                    <svg
                      viewBox={`0 0 ${unitsPerEm} ${unitsPerEm}`}
                      aria-label={ic.name}
                    >
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
                  title={
                    dupNames.has(ic.name)
                      ? "Duplicate name — must be unique"
                      : ic.name
                  }
                  onChange={(e) =>
                    renameIcon(
                      ic.id,
                      e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
                    )
                  }
                  onBlur={(e) => renameIcon(ic.id, sanitizeName(e.target.value))}
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
            <input
              value={fontName}
              className={!fontName.trim() ? "invalid" : ""}
              onChange={(e) => setFontName(e.target.value)}
            />
            {!fontName.trim() && (
              <span className="field-error">Font name is required.</span>
            )}
          </label>
          <label>
            CSS class prefix
            <input
              value={classPrefix}
              onChange={(e) => setClassPrefix(e.target.value)}
            />
          </label>
          <label>
            Units per em
            <select
              value={unitsPerEm}
              onChange={(e) => setUnitsPerEm(Number(e.target.value))}
            >
              <option value={1000}>1000</option>
              <option value={1024}>1024</option>
              <option value={2048}>2048</option>
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={fit}
              onChange={(e) => setFit(e.target.checked)}
            />
            Center &amp; trim icons
            <span className="check-hint">
              Centers each icon by its actual artwork (fixes off-center / corner
              icons).
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
            disabled={
              busy || !icons.length || dupNames.size > 0 || !fontName.trim()
            }
            title={
              !fontName.trim()
                ? "Enter a font name first"
                : dupNames.size > 0
                  ? "Resolve duplicate icon names first"
                  : ""
            }
            onClick={generate}
          >
            {busy
              ? "Generating…"
              : !fontName.trim()
                ? "Enter a font name"
                : dupNames.size > 0
                  ? "Fix duplicate names"
                  : "Generate font"}
          </button>

          {result && (
            <div className="downloads">
              <h3>Download</h3>
              <button
                className="dl"
                onClick={() =>
                  downloadBlob(result.ttf, `${fontName}.ttf`, "font/ttf")
                }
              >
                {fontName}.ttf
              </button>
              <button
                className="dl"
                disabled={!result.woff}
                onClick={() =>
                  downloadBlob(result.woff, `${fontName}.woff`, "font/woff")
                }
              >
                {fontName}.woff
              </button>
              <button
                className="dl"
                disabled={!result.woff2}
                onClick={() =>
                  downloadBlob(result.woff2, `${fontName}.woff2`, "font/woff2")
                }
                title={
                  result.woff2
                    ? ""
                    : result.woff2Error
                      ? `WOFF2 unavailable: ${result.woff2Error}`
                      : "Generating WOFF2…"
                }
              >
                {fontName}.woff2
                {result.woff2
                  ? ""
                  : result.woff2Error
                    ? " (n/a)"
                    : " …"}
              </button>
              <button
                className="dl"
                onClick={() =>
                  downloadBlob(result.css, "style.css", "text/css")
                }
              >
                style.css
              </button>
              <button
                className="dl"
                onClick={() =>
                  downloadBlob(result.demo, "demo.html", "text/html")
                }
              >
                demo.html
              </button>
              <button
                className="dl"
                disabled={!result.usage}
                onClick={() =>
                  downloadBlob(result.usage, "README.md", "text/markdown")
                }
              >
                README.md
              </button>
              <button className="primary block" onClick={downloadZip}>
                ⬇ Download all (.zip)
              </button>

              <div className="view-actions">
                <button className="ghost" onClick={() => setModal("howto")}>
                  ⓘ How to use
                </button>
                <button className="ghost" onClick={() => setModal("preview")}>
                  ◱ Font preview ({icons.length})
                </button>
              </div>
            </div>
          )}
        </aside>
      </main>

      {result && modal && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setModal(null)}
        >
          <div className="lb-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lb-head">
              <h3>{modal === "howto" ? "How to use" : "Font preview"}</h3>
              <button
                className="lb-close"
                aria-label="Close"
                onClick={() => setModal(null)}
              >
                ×
              </button>
            </div>

            <div className="lb-body">
              {modal === "howto" ? (
                <div className="howto">
                  <p>Works in any site — no framework or build tools needed.</p>
                  <ol>
                    <li>
                      Copy the <code>fonts/</code> folder and{" "}
                      <code>style.css</code> into your project, side by side.
                    </li>
                    <li>
                      Link the stylesheet in your page&apos;s{" "}
                      <code>&lt;head&gt;</code>:
                      <pre>{`<link rel="stylesheet" href="style.css" />`}</pre>
                    </li>
                    <li>
                      Add an icon with its class:
                      <pre>{`<span class="${classPrefix}${icons[0]?.name || "name"}"></span>`}</pre>
                    </li>
                    <li>
                      Size / color it like text:
                      <pre>{`.${classPrefix}${icons[0]?.name || "name"} { font-size: 24px; color: #e63946; }`}</pre>
                    </li>
                  </ol>
                  <p className="howto-note">
                    Using React/Vue/Vite/webpack? Put <code>style.css</code> +{" "}
                    <code>fonts/</code> in your <code>public/</code> folder (or
                    import the CSS), and use <code>className</code> in JSX. Full
                    steps and the class list are in <code>README.md</code> /{" "}
                    <code>demo.html</code>.
                  </p>
                </div>
              ) : (
                <div className="font-preview">
                  <div className="fp-grid">
                    {icons.map((ic) => (
                      <div
                        className="fp-cell"
                        key={ic.id}
                        title={`${classPrefix}${ic.name}`}
                      >
                        <span style={{ fontFamily: result.previewFamily }}>
                          {String.fromCodePoint(ic.unicode)}
                        </span>
                        <small>{ic.name}</small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
