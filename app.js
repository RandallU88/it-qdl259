import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";
import { findLinks, telHref, mapHref } from "./links.js";
pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";
const $ = (id) => document.getElementById(id);
const api = window.makeAdapter(window.IV_CONFIG);
const TZ = "America/New_York";
let index = null, sig = "", current = null, pdfDoc = null, zoom = 1, fitScale = 1, renderTok = 0;

// ?today=YYYY-MM-DD override for testing
function todayISO() {
  const o = new URLSearchParams(location.search).get("today");
  if (o) return o;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const pd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (s, o) => pd(s).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
function label(it) {
  if (it.kind === "daily") return { t: fmt(it.start, { weekday: "long" }), s: fmt(it.start, { month: "long", day: "numeric", year: "numeric" }) };
  if (it.kind === "week") return { t: "Week of " + fmt(it.start, { month: "short", day: "numeric" }), s: fmt(it.start, { month: "short", day: "numeric" }) + " to " + fmt(it.end, { month: "short", day: "numeric", year: "numeric" }) };
  return { t: "Sheet " + fmt(it.start, { month: "short", day: "numeric" }), s: fmt(it.start, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) };
}
function row(it, cls, tag, tagNow) {
  const b = document.createElement("button");
  b.className = "item " + cls; b.dataset.id = it.id;
  const l = label(it);
  b.innerHTML = `<div class="main"><div class="t"></div><div class="s"></div></div><span class="tag"></span><span class="chev">&#x203a;</span>`;
  b.querySelector(".t").textContent = l.t; b.querySelector(".s").textContent = l.s;
  const tg = b.querySelector(".tag"); tg.textContent = tag; if (tagNow) tg.classList.add("now");
  b.onclick = () => openItem(it);
  return b;
}
// Week grouping (Mon-Sun, dates are local America/New_York ISO strings)
const isoOf = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const x = pd(s); x.setUTCDate(x.getUTCDate() + n); return isoOf(x); };
const mondayOf = (s) => addDays(s, -((pd(s).getUTCDay() + 6) % 7));
const md = (s) => { const [, m, d] = s.split("-").map(Number); return m + "/" + d; };
const openWeeks = new Map(); // user taps, keyed by week Monday; cleared when the current week changes
let openFor = "", renderedDay = "";
function weekPlan(items, t) {
  const tw = mondayOf(t), groups = new Map();
  for (const it of items) { const k = mondayOf(it.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const keys = [...groups.keys()].sort();
  const focus = groups.has(tw) ? tw : (keys.find((k) => k > tw) || keys.filter((k) => k < tw).pop());
  return { tw, groups, keys, focus };
}
function weekRange(k, list) {
  const sun = addDays(k, 6);
  let last = addDays(k, 4);
  for (const it of list) for (const d of [it.start, it.end]) if (d && d > last) last = d > sun ? sun : d;
  return md(k) + " \u2013 " + md(last);
}
function setWeekOpen(sec, open) {
  sec.classList.toggle("open", open);
  sec.querySelector(".wkhead").setAttribute("aria-expanded", String(open));
  sec.querySelector(".wkbody").hidden = !open;
}
function renderList() {
  const box = $("items"); box.innerHTML = "";
  const t = todayISO(); renderedDay = t;
  const items = (index?.items || []).slice().sort((a, b) => (a.kind === "week" ? 0 : 1) - (b.kind === "week" ? 0 : 1) || a.start.localeCompare(b.start) || (a.kind === "daily" ? -1 : 1));
  $("updated").textContent = index?.generated ? "Updated " + new Date(index.generated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  if (!items.length) { box.innerHTML = '<p class="empty">No itineraries yet.</p>'; return; }
  const { tw, groups, keys, focus } = weekPlan(items, t);
  if (openFor !== tw) { openWeeks.clear(); openFor = tw; }
  const isCur = (i) => i.kind === "week" && i.start <= t && t <= i.end;
  const mkRow = (i) => i.kind === "daily" && i.start === t ? row(i, "today", "Today", true)
    : isCur(i) ? row(i, "curweek", "This week", true)
    : row(i, "", i.kind === "daily" ? "Daily" : i.kind === "week" ? "Week" : "Sheet");
  const group = (k) => {
    const list = groups.get(k), sec = document.createElement("section");
    sec.className = "wk" + (k === tw ? " cur" : k > tw ? " future" : " past"); sec.dataset.week = k;
    const h = document.createElement("button"); h.type = "button"; h.className = "wkhead"; h.setAttribute("aria-controls", "wk-" + k);
    h.innerHTML = '<span class="wkcaret" aria-hidden="true">&#x203a;</span><span class="wkt"></span><span class="wkn"></span>';
    h.querySelector(".wkt").textContent = "Week of " + weekRange(k, list);
    h.querySelector(".wkn").textContent = "(" + list.length + ")";
    if (k === tw) { const tg = el("span", "tag now", "This week"); h.append(tg); }
    const body = document.createElement("div"); body.className = "wkbody"; body.id = "wk-" + k;
    list.forEach((i) => body.append(mkRow(i)));
    h.onclick = () => { const o = !sec.classList.contains("open"); openWeeks.set(k, o); setWeekOpen(sec, o); };
    sec.append(h, body);
    setWeekOpen(sec, openWeeks.has(k) ? openWeeks.get(k) : k === focus);
    return sec;
  };
  const sec = (name, ks) => { if (!ks.length) return; box.append(el("h2", "", name)); ks.forEach((k) => box.append(group(k))); };
  sec(focus === tw ? "This week" : focus > tw ? "Next up" : "Most recent", [focus]);
  sec("Upcoming", keys.filter((k) => k > tw && k !== focus));
  sec("Earlier", keys.filter((k) => k < tw && k !== focus).reverse());
}
async function refresh() {
  try {
    const idx = await api.listIndex();
    const s = JSON.stringify(idx.items.map((i) => i.id + i.version));
    index = idx; if (s !== sig || todayISO() !== renderedDay) { sig = s; renderList(); } else $("updated").textContent = "Updated " + new Date(idx.generated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) { console.warn(e); if (!index) $("items").innerHTML = '<p class="err">Could not load itineraries. Pull to retry.</p>'; }
}
// viewer
async function openItem(it, push = true) {
  current = it; const l = label(it);
  $("vname").textContent = l.t; $("vsub").textContent = l.s;
  $("list").hidden = true; $("viewer").hidden = false;
  if (push) history.pushState({ id: it.id }, "", "#" + encodeURIComponent(it.id));
  pdfDoc?.destroy(); pdfDoc = null; renderTok++;
  $("pagewrap").innerHTML = ""; $("stops").replaceChildren(); $("pages").scrollTo(0, 0);
  if (it.stops?.days?.length) return showStops(it);
  await showPdf(it);
}
function setMode(list) {
  $("stops").hidden = !list; $("pages").hidden = list;
  ["zout", "zfit", "zin"].forEach((id) => ($(id).hidden = list));
  $("vpdf").hidden = !list; $("vlist").hidden = list || !current?.stops?.days?.length;
}
async function showPdf(it) {
  setMode(false);
  const url = await api.fileUrl(it); if (current !== it) return;
  pdfDoc = await pdfjsLib.getDocument({ url }).promise;
  const p1 = await pdfDoc.getPage(1);
  fitScale = Math.min($("pages").clientWidth - 16, 1000) / p1.getViewport({ scale: 1 }).width;
  zoom = 1; await renderPages();
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const phoneText = (p) => p.replace(/\s*(?:x|ext\.?)\s*(\d+)$/i, " ext $1");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function parseStopDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  let y = Number(m[3]); if (y < 100) y += 2000;
  return y + "-" + String(Number(m[1])).padStart(2, "0") + "-" + String(Number(m[2])).padStart(2, "0");
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function stopDayISO(d, it) {
  const parsed = parseStopDate(d?.date);
  if (parsed) return parsed;
  if (it?.kind === "daily" && it.start) return it.start;
  if (it?.start && d?.day) {
    const want = WEEKDAYS.indexOf(d.day);
    if (want >= 0) {
      const end = it.end || addDaysISO(it.start, 6);
      for (let cur = it.start, i = 0; cur <= end && i < 14; i++, cur = addDaysISO(cur, 1)) {
        const [y, m, dd] = cur.split("-").map(Number);
        if (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() === want) return cur;
      }
    }
  }
  return it?.start || "";
}
const checkKey = (date, company) => JSON.stringify([date, company]);
function flashCheckErr(card, msg) {
  let err = card.querySelector(".check-err");
  if (!err) { err = el("p", "check-err"); card.append(err); }
  err.textContent = msg;
  clearTimeout(err._t);
  err._t = setTimeout(() => err.remove(), 3500);
}
function addChecks(card, date, company, checks) {
  const row = el("div", "checks");
  const key = checkKey(date, company);
  const state = checks[key] || (checks[key] = { seen: false, quoted: false, ordered: false });
  for (const field of ["seen", "quoted", "ordered"]) {
    const lab = el("label", "chk");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!state[field];
    const pretty = field[0].toUpperCase() + field.slice(1);
    input.setAttribute("aria-label", pretty);
    lab.append(input, document.createTextNode(pretty));
    input.addEventListener("change", async () => {
      const val = input.checked;
      try {
        await api.setCheck(date, company, field, val);
        state[field] = val;
      } catch (e) {
        input.checked = !val;
        console.warn(e);
        flashCheckErr(card, "Could not save. Try again.");
      }
    });
    row.append(lab);
  }
  card.append(row);
}
async function showStops(it) {
  setMode(true);
  const box = $("stops"); box.replaceChildren(); box.scrollTo(0, 0);
  let checks = {};
  try { checks = await api.loadChecks() || {}; } catch (e) { console.warn(e); }
  if (current !== it) return;
  const t = todayISO(), [ty, tm, td] = t.split("-").map(Number), tShort = `${tm}/${td}/${String(ty).slice(2)}`;
  const multi = it.stops.days.length > 1; let todayHead = null, n = 0;
  for (const d of it.stops.days) {
    const dateISO = stopDayISO(d, it);
    if (multi || d.day) {
      const h = el("h2", "dayh", [d.day, d.date].filter(Boolean).join(" ") + "  \u00b7  " + d.stops.length + (d.stops.length === 1 ? " stop" : " stops"));
      if (dateISO === t || d.date === tShort) { h.classList.add("now"); todayHead = h; }
      box.append(h);
    }
    for (const s of d.stops) {
      const c = el("article", "stop"); n++;
      c.dataset.date = dateISO;
      c.dataset.company = s.company;
      const top = el("div", "stop-top");
      top.append(el("span", "num", String(n)), el("div", "co", s.company));
      c.append(top);
      const meta = el("div", "meta");
      if (s.status) meta.append(el("span", "st st-" + s.status.toLowerCase().replace(/[^a-z]/g, ""), s.status));
      if (s.time) meta.append(el("span", "time" + (/\d/.test(s.time) ? " fixed" : ""), s.time === "Any" ? "Any time" : s.time === "CC" ? "Cold call" : s.time));
      c.append(meta);
      if (s.contact) c.append(el("div", "contact", s.contact));
      if (s.address) { const a = el("a", "act addr"); a.href = mapHref(s.address); a.target = "_blank"; a.rel = "noopener"; a.append(el("span", "ic", "\u{1F4CD}"), el("span", "", s.address)); c.append(a); }
      if (s.phone) { const a = el("a", "act tel"); a.href = telHref(s.phone); a.append(el("span", "ic", "\u{1F4DE}"), el("span", "", phoneText(s.phone))); c.append(a); }
      addChecks(c, dateISO, s.company, checks);
      box.append(c);
    }
  }
  if (todayHead && multi) requestAnimationFrame(() => todayHead.scrollIntoView({ block: "start" }));
}
$("vpdf").onclick = () => current && showPdf(current);
$("vlist").onclick = () => current && (pdfDoc?.destroy(), pdfDoc = null, renderTok++, showStops(current));
async function renderPages() {
  const tok = ++renderTok, wrap = $("pagewrap"), dpr = Math.min(window.devicePixelRatio || 1, 3);
  wrap.style.transform = "";
  const scale = fitScale * zoom, frag = [];
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const page = await pdfDoc.getPage(n); if (tok !== renderTok) return;
    const vp = page.getViewport({ scale }), c = document.createElement("canvas");
    const cw = Math.round(vp.width), ch = Math.round(vp.height);
    const px = Math.max(1, Math.min(dpr, 4096 / cw, Math.sqrt(16e6 / (cw * ch)))); // iOS canvas limits
    c.width = Math.round(cw * px); c.height = Math.round(ch * px);
    c.style.width = cw + "px"; c.style.height = ch + "px";
    const ctx = c.getContext("2d", { alpha: false });
    await page.render({ canvasContext: ctx, viewport: vp, transform: [c.width / vp.width, 0, 0, c.height / vp.height, 0, 0] }).promise;
    if (tok !== renderTok) return;
    const pg = document.createElement("div"); pg.className = "pg"; pg.style.width = c.style.width; pg.style.height = c.style.height;
    const ov = document.createElement("div"); ov.className = "links";
    try {
      page._links ||= findLinks((await page.getTextContent()).items);
      for (const l of page._links) {
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle(l.rect), a = document.createElement("a");
        a.href = l.href; a.className = "lk " + l.type; a.title = (l.type === "phone" ? "Call " : "Open in Maps: ") + l.text;
        a.setAttribute("aria-label", a.title); if (l.type === "addr") { a.target = "_blank"; a.rel = "noopener"; }
        Object.assign(a.style, { left: Math.min(x1, x2) + "px", top: Math.min(y1, y2) + "px", width: Math.abs(x2 - x1) + "px", height: Math.abs(y2 - y1) + "px" });
        ov.append(a);
      }
    } catch (e) { console.warn("link detection failed", e); }
    if (tok !== renderTok) return; pg.append(c, ov); frag.push(pg);
  }
  wrap.replaceChildren(...frag); wrap.dataset.zoom = zoom.toFixed(2);
}
async function setZoom(z, cx, cy) {
  const pages = $("pages"); z = Math.max(0.5, Math.min(6, z));
  const r = pages.getBoundingClientRect(); cx ??= r.width / 2; cy ??= r.height / 2;
  const fx = (pages.scrollLeft + cx) / zoom, fy = (pages.scrollTop + cy) / zoom;
  zoom = z; await renderPages();
  pages.scrollLeft = fx * zoom - cx; pages.scrollTop = fy * zoom - cy;
}
// pinch: live CSS scale, re-render on release
(() => {
  const pages = $("pages"), wrap = $("pagewrap"); let d0 = 0, mid = null, s = 1;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  pages.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { d0 = dist(e.touches); const r = pages.getBoundingClientRect(); mid = [(e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top]; s = 1; } }, { passive: true });
  pages.addEventListener("touchmove", (e) => { if (e.touches.length === 2 && d0) { e.preventDefault(); s = dist(e.touches) / d0; wrap.style.transformOrigin = `${pages.scrollLeft + mid[0]}px ${pages.scrollTop + mid[1]}px`; wrap.style.transform = `scale(${s})`; } }, { passive: false });
  pages.addEventListener("touchend", (e) => { if (d0 && e.touches.length < 2) { d0 = 0; wrap.style.transformOrigin = "0 0"; if (Math.abs(s - 1) > 0.02) setZoom(zoom * s, mid[0], mid[1]); else wrap.style.transform = ""; } });
  // Safari desktop trackpad pinch and ctrl+wheel
  ["gesturestart", "gesturechange"].forEach((ev) => pages.addEventListener(ev, (e) => e.preventDefault()));
  pages.addEventListener("gestureend", (e) => { e.preventDefault(); setZoom(zoom * e.scale); });
  pages.addEventListener("wheel", (e) => { if (e.ctrlKey) { e.preventDefault(); clearTimeout(pages._w); pages._z = (pages._z || zoom) * Math.exp(-e.deltaY / 200); pages._w = setTimeout(() => { setZoom(pages._z); pages._z = 0; }, 120); } }, { passive: false });
  // swipe from left edge to go back
  let sx = null;
  pages.addEventListener("touchstart", (e) => { sx = e.touches.length === 1 && e.touches[0].clientX < 24 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  pages.addEventListener("touchend", (e) => { if (sx) { const t = e.changedTouches[0]; if (t.clientX - sx[0] > 80 && Math.abs(t.clientY - sx[1]) < 60) history.back(); sx = null; } });
})();

// Visited-locations map (private storage; only after login)
const MAP_INJECT = `<style id="iv-map-fit">html,body{width:100%!important;height:100%!important;margin:0!important;padding:0!important;overflow:hidden!important}
.leaflet-container{width:100%!important;height:100%!important;touch-action:pan-x pan-y;}
[id^="map_"]{width:100%!important;height:100%!important;}</style>`;
let mapBlobUrl = null;
function revokeMapBlob() {
  if (mapBlobUrl) { URL.revokeObjectURL(mapBlobUrl); mapBlobUrl = null; }
}
function showMapUi(which) {
  $("mapStatus").hidden = which !== "status";
  $("mapFrame").hidden = which !== "frame";
  $("mapImg").hidden = which !== "img";
}
async function openMap(push = true) {
  $("list").hidden = true; $("viewer").hidden = true; $("mapview").hidden = false;
  if (push) history.pushState({ map: true }, "", "#map");
  showMapUi("status"); $("mapStatus").textContent = "Loading map…";
  revokeMapBlob();
  $("mapFrame").removeAttribute("src"); $("mapFrame").srcdoc = "";
  $("mapImg").removeAttribute("src");
  try {
    let html = await api.mapHtml();
    if (!html || html.length < 100) throw new Error("empty map");
    // Folium may be served as text/plain; inject mobile full-height CSS before </head>
    if (html.includes("</head>")) html = html.replace("</head>", MAP_INJECT + "</head>");
    else html = MAP_INJECT + html;
    // Prefer srcdoc so text/plain storage still renders as HTML; allow-scripts for Leaflet
    $("mapFrame").srcdoc = html;
    showMapUi("frame");
    // Give Leaflet a moment; if iframe errors, fall back below via timeout check is hard, rely on catch for fetch
  } catch (e) {
    console.warn("map html failed", e);
    try {
      const url = await api.mapPngUrl();
      $("mapImg").src = url;
      showMapUi("img");
      $("mapStatus").textContent = "";
    } catch (e2) {
      console.warn("map png failed", e2);
      showMapUi("status");
      $("mapStatus").textContent = "Could not load map. Pull to retry from the list.";
    }
  }
}
function closeMap() {
  $("mapview").hidden = true; $("list").hidden = false;
  revokeMapBlob();
  $("mapFrame").srcdoc = ""; $("mapFrame").removeAttribute("src");
  $("mapImg").removeAttribute("src");
  showMapUi("status");
}
function leaveMap() {
  closeMap();
  if (location.hash.slice(1) === "map" || history.state?.map) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}
function closeViewer() { $("viewer").hidden = true; $("list").hidden = false; current = null; pdfDoc?.destroy(); pdfDoc = null; renderTok++; }
$("back").onclick = () => (history.state?.id ? history.back() : (history.replaceState(null, "", location.pathname + location.search), closeViewer()));
$("mapBack").onclick = $("mapClose").onclick = () => leaveMap();
$("mapBtn").onclick = () => openMap(true);
window.addEventListener("popstate", () => {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === "map") return openMap(false);
  if (!$("mapview").hidden) {
    closeMap();
    if (!hash) return;
  }
  const it = hash && index?.items.find((i) => i.id === hash);
  if (it) openItem(it, false);
  else if (!$("viewer").hidden) closeViewer();
});
$("zin").onclick = () => setZoom(zoom * 1.25);
$("zout").onclick = () => setZoom(zoom / 1.25);
$("zfit").onclick = () => setZoom(1);
$("refresh").onclick = refresh;
$("share").onclick = async () => {
  if (!current) return; const url = await api.fileUrl(current);
  try {
    const blob = await (await fetch(url)).blob(), file = new File([blob], current.name, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], title: current.name });
  } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = url; a.download = current.name; a.click();
};
let _rz; window.addEventListener("orientationchange", () => window.dispatchEvent(new Event("resize")));
window.addEventListener("resize", () => { if (pdfDoc && !$("pages").hidden) pdfDoc.getPage(1).then((p) => { fitScale = Math.min($("pages").clientWidth - 16, 1000) / p.getViewport({ scale: 1 }).width; renderPages(); }); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); renderList(); } });
window.addEventListener("focus", refresh);
setInterval(refresh, 60000);
async function start() {
  if (api.needsLogin && !(await api.session())) {
    $("list").hidden = true; $("login").hidden = false;
    $("loginForm").onsubmit = async (e) => { e.preventDefault(); $("loginErr").textContent = "";
      try { await api.login($("lu").value.trim(), $("lp").value); $("login").hidden = true; $("list").hidden = false; await boot(); }
      catch { $("loginErr").textContent = "Sign in failed. Check username and password."; } };
    return;
  }
  await boot();
}
async function boot() {
  $("mapBtn").hidden = false;
  await refresh();
  const id = decodeURIComponent(location.hash.slice(1));
  if (id === "map") {
    history.replaceState(null, "", location.pathname + location.search);
    history.pushState({ map: true }, "", "#map");
    return openMap(false);
  }
  const it = id && index?.items.find((i) => i.id === id);
  if (it) { history.replaceState(null, "", location.pathname + location.search); history.pushState({ id }, "", "#" + encodeURIComponent(id)); openItem(it, false); }
}
window.__iv = { get index() { return index; }, weekPlan, mondayOf, get zoom() { return zoom; }, stopDayISO, parseStopDate, checkKey };
start();
if (api.needsLogin) { const lo = $("logout"); lo.hidden = false; lo.onclick = async () => { await api.logout(); location.replace(location.pathname); }; }
(() => { const s = $("stops"); let sx = null;
  s.addEventListener("touchstart", (e) => { sx = e.touches.length === 1 && e.touches[0].clientX < 24 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  s.addEventListener("touchend", (e) => { if (sx) { const t = e.changedTouches[0]; if (t.clientX - sx[0] > 80 && Math.abs(t.clientY - sx[1]) < 60) history.back(); sx = null; } }); })();
