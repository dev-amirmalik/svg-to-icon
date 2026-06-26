// Lightweight localStorage persistence for the icon set + settings.
const KEY = "svg2font:v1";

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.icons)) return null;
    return data;
  } catch (e) {
    console.warn("Failed to read saved state:", e);
    return null;
  }
}

/** Save state. Returns true on success, false if it couldn't be stored (e.g. quota). */
export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn("Failed to save state:", e);
    return false;
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    console.warn("Failed to clear state:", e);
  }
}

// Keep only the serializable fields (drop derived data + object URLs).
export function serializeIcons(icons) {
  return icons.map((i) => {
    const o = { id: i.id, name: i.name, unicode: i.unicode };
    if (i.svg) {
      o.svg = i.svg;
    } else if (i.glyphPath) {
      o.glyphPath = i.glyphPath;
      o.srcEm = i.srcEm;
      o.rawAdvance = i.rawAdvance;
      o.previewSvg = i.previewSvg;
    }
    return o;
  });
}
