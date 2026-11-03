// Finds phone numbers and street addresses in pdf.js text content and returns tappable link boxes.
const SUF = "(?:\\b(?:x|ext\\.?|extension)\\s*\\d{1,6})?";
export const PHONE_RE = new RegExp("(?<![\\d-])(?:\\+?1[\\s.-]?)?(?:\\(\\d{3}\\)\\s?|\\d{3}[\\s.-])\\d{3}[\\s.-]\\d{4}(?![\\d-])(?:\\s*" + SUF.slice(3, -2) + ")?", "gi");
// number [+ letter/unit] street words, city, [ST] [ZIP]   (cells are separated by \u0001 so matches never cross columns)
export const ADDR_RE = /(?<![\w-])\d{1,6}(?:-?[A-Z])?\s+(?:[A-Za-z0-9.'#&\/-]+ ){0,7}[A-Za-z0-9.'#&\/-]+,\s*(?:[A-Za-z.' ]+?,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?|[A-Za-z.' ]+?\s+\d{5}(?:-\d{4})?)(?![\w])/g;
export const telHref = (s) => { const m = s.match(/^(.*?)(?:\s*(?:x|ext\.?|extension)\s*(\d+))?$/i); let d = m[1].replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return "tel:+1" + d + (m[2] ? ",," + m[2] : ""); };
export const mapHref = (s) => "https://maps.apple.com/?q=" + encodeURIComponent(s.replace(/\s+/g, " ").trim());
export function findLinks(items) {
  const its = items.filter((i) => i.str && i.str.trim() && i.transform);
  const lines = [];
  for (const it of its.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    const y = it.transform[5], h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    let L = lines.find((l) => Math.abs(l.y - y) < h * 0.4);
    if (!L) lines.push((L = { y, h, items: [] }));
    L.items.push(it);
  }
  const out = [];
  for (const L of lines) {
    L.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = "", map = [], prev = null;
    for (const it of L.items) {
      if (prev) {
        const gap = it.transform[4] - (prev.transform[4] + prev.width);
        if (gap > L.h * 1.2) { text += "\u0001"; map.push(null); }
        else if (gap > L.h * 0.12 && !/\s$/.test(prev.str) && !/^\s/.test(it.str)) { text += " "; map.push(null); }
      }
      for (let k = 0; k < it.str.length; k++) { text += it.str[k]; map.push([it, k]); }
      prev = it;
    }
    const add = (m, type) => {
      const s = m[0].trim(), a = m.index, b = m.index + m[0].trimEnd().length;
      const boxes = new Map();
      for (let k = a; k < b; k++) { const e = map[k]; if (!e) continue; const [it, ci] = e; const bx = boxes.get(it) || [ci, ci]; bx[1] = ci; boxes.set(it, bx); }
      const rects = [...boxes].map(([it, [c0, c1]]) => { const cw = it.width / it.str.length, h = Math.hypot(it.transform[2], it.transform[3]) || it.height;
        return [it.transform[4] + c0 * cw, it.transform[5] - h * 0.25, it.transform[4] + (c1 + 1) * cw, it.transform[5] + h * 0.95]; });
      const r = rects.reduce((p, q) => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])]);
      out.push({ type, text: s, href: type === "phone" ? telHref(s) : mapHref(s), rect: r });
    };
    for (const m of text.matchAll(PHONE_RE)) add(m, "phone");
    for (const m of text.matchAll(ADDR_RE)) add(m, "addr");
  }
  return out;
}
