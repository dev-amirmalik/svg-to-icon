# SVG → Icon Font

A browser-based app (React + Vite) that converts SVG icons into a web icon font —
**TTF, WOFF, WOFF2**, plus a ready-to-use **CSS** file and an **HTML demo cheatsheet**.
Similar in spirit to IcoMoon / Iconly. Everything runs **client-side** — your SVGs never leave your machine.

## Features

- **Import an existing icon font** (`.ttf`, `.otf`, `.woff`, `.woff2`) to extend or update it —
  glyphs are extracted as editable icons and their original codepoints are preserved, so
  CSS that references the old font keeps working. Add new SVGs alongside them and re-export.
- **Center & trim** — automatically centers each icon by its real artwork bounds (fixes
  icons a designer left in a corner or off-center) with an adjustable **padding** slider.
  Toggle off to keep the original viewBox framing. Tile previews update live.
- **Auto-saves to your browser** (localStorage) — your icons and settings survive an
  accidental reload or closing the tab. "Clear all" wipes the saved set.
- Drag-and-drop (or browse) multiple `.svg` files
- Handles `<path>`, `<rect>` (incl. rounded), `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, groups and `transform` attributes
- Auto-assigns Private-Use-Area codepoints starting at `U+E900` (IcoMoon convention)
- Rename icons inline; names become CSS classes (`.icon-<name>`)
- Configurable font name, CSS class prefix, and units-per-em (1000 / 1024 / 2048)
- Live preview rendered with the freshly generated font
- Download individual files or everything as a `.zip` (`fonts/`, `style.css`, `demo.html`)

## Run it

```bash
npm install      # first time only
npm run dev      # start the dev server, then open the printed URL
```

To build a static version you can host anywhere:

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build
```

> If `node_modules` was partially created elsewhere, delete it first:
> `rm -rf node_modules && npm install`.

## How to use the generated font

1. Click **Generate font**, then **Download all (.zip)**.
2. Copy the `fonts/` folder and `style.css` into your project.
3. Link the stylesheet and use the classes:

```html
<link rel="stylesheet" href="style.css" />
<span class="icon-heart"></span>
```

Open `demo.html` for a visual cheatsheet of every icon and its CSS class.

## Updating an existing font

1. Click **Import existing font** and pick your old `.ttf` / `.otf` / `.woff` / `.woff2`.
2. Its icons load into the grid with their original codepoints kept intact.
3. Add new SVGs, rename, or remove icons as needed.
4. **Generate font** and download — your existing class names / codepoints still match,
   and new icons get the next free codepoint.

> WOFF2 import needs the WASM decoder; if a browser can't run it, convert the font to TTF/WOFF first.

## How it works

1. Each SVG is parsed in the browser (`DOMParser`); all shapes are flattened to a single
   path and any element/group `transform`s are applied (`svgpath`).
2. The path is mapped into font units: translated to the origin, scaled to the em size,
   and **y-flipped** (SVG is y-down, fonts are y-up).
3. Glyphs are assembled into a font with `opentype.js`, which emits the **TTF**.
4. The TTF is converted to **WOFF** (`ttf2woff`) and **WOFF2** (`wawoff2`, WebAssembly).
5. CSS `@font-face` + icon classes and a demo page are generated, then zipped (`jszip`).

## Styling

Styling uses **Tailwind CSS v3** + **SCSS** (Dart Sass), compiled by Vite via PostCSS.

- `src/styles.scss` — Tailwind directives (`@tailwind base/components/utilities`) plus
  the app's component styles written in SCSS (variables, `@mixin`, nesting).
- `tailwind.config.js` — content globs + theme color tokens (`bg`, `panel`, `accent`, …),
  so you can use utilities like `bg-panel` or `text-accent` directly in JSX.
- `postcss.config.js` — runs `tailwindcss` + `autoprefixer`.

You can freely mix Tailwind utility classes in `App.jsx` with the existing SCSS classes.

> A stale `src/styles.css` from an earlier version is no longer imported and can be deleted.

## Tech

React 18, Vite 5, Tailwind CSS 3, Sass (SCSS), opentype.js, svgpath, ttf2woff, wawoff2, jszip.

## Notes / limits

- Icons should use solid fills (icon fonts are monochrome — `fill`/`stroke` colors and
  gradients are ignored; only the geometry is used).
- Very thin **stroke-only** shapes have no fill area and may appear empty; convert strokes
  to outlines/fills in your SVG editor first for best results.
- WOFF2 generation uses WebAssembly; if a browser blocks it, TTF + WOFF are still produced.
