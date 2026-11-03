import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";
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
function renderList() {
  const box = $("items"); box.innerHTML = "";
  const items = (index?.items || []).slice().sort((a, b) => b.start.localeCompare(a.start) || (a.kind === "daily" ? -1 : 1));
  if (!items.length) { box.innerHTML = '<p class="empty">No itineraries yet.</p>'; return; }
  const t = todayISO();
  const today = items.find((i) => i.kind === "daily" && i.start === t);
  const isCur = (i) => i.kind === "week" && i.start <= t && t <= i.end;
  const sec = (name, list, f) => { if (!list.length) return; const h = document.createElement("h2"); h.textContent = name; box.append(h); list.forEach((i) => box.append(f(i))); };
  if (today) sec("Today", [today], (i) => row(i, "today", "Today", true));
  sec("Daily", items.filter((i) => i.kind === "daily" && i !== today), (i) => row(i, "", "Daily"));
  sec("Week", items.filter((i) => i.kind !== "daily"), (i) => isCur(i) ? row(i, "curweek", "This week", true) : row(i, "", i.kind === "week" ? "Week" : "Sheet"));
  $("updated").textContent = index.generated ? "Updated " + new Date(index.generated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}
async function refresh() {
  try {
    const idx = await api.listIndex();
    const s = JSON.stringify(idx.items.map((i) => i.id + i.version));
    index = idx; if (s !== sig) { sig = s; renderList(); } else $("updated").textContent = "Updated " + new Date(idx.generated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch (e) { console.warn(e); if (!index) $("items").innerHTML = '<p class="err">Could not load itineraries. Pull to retry.</p>'; }
}
// viewer
async function openItem(it, push = true) {
  current = it; const l = label(it);
  $("vname").textContent = l.t; $("vsub").textContent = l.s;
  $("list").hidden = true; $("viewer").hidden = false;
  if (push) history.pushState({ id: it.id }, "", "#" + encodeURIComponent(it.id));
  $("pagewrap").innerHTML = ""; $("pages").scrollTo(0, 0);
  const url = await api.fileUrl(it);
  pdfDoc = await pdfjsLib.getDocument({ url }).promise;
  const p1 = await pdfDoc.getPage(1);
  fitScale = Math.min($("pages").clientWidth - 16, 1000) / p1.getViewport({ scale: 1 }).width;
  zoom = 1; await renderPages();
}
async function renderPages() {
  const tok = ++renderTok, wrap = $("pagewrap"), dpr = Math.min(window.devicePixelRatio || 1, 3);
  wrap.style.transform = "";
  const scale = fitScale * zoom, frag = [];
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const page = await pdfDoc.getPage(n); if (tok !== renderTok) return;
    const vp = page.getViewport({ scale }), c = document.createElement("canvas");
    const px = Math.min(dpr, 4096 / vp.width); // cap canvas size for iOS memory
    c.width = Math.floor(vp.width * px); c.height = Math.floor(vp.height * px);
    c.style.width = Math.floor(vp.width) + "px"; c.style.height = Math.floor(vp.height) + "px";
    await page.render({ canvasContext: c.getContext("2d"), viewport: page.getViewport({ scale: scale * px }) }).promise;
    if (tok !== renderTok) return; frag.push(c);
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
function closeViewer() { $("viewer").hidden = true; $("list").hidden = false; current = null; pdfDoc?.destroy(); pdfDoc = null; renderTok++; }
$("back").onclick = () => (history.state?.id ? history.back() : (history.replaceState(null, "", location.pathname + location.search), closeViewer()));
window.addEventListener("popstate", () => { const id = decodeURIComponent(location.hash.slice(1)); const it = index?.items.find((i) => i.id === id); it ? openItem(it, false) : closeViewer(); });
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
window.addEventListener("resize", () => { if (pdfDoc) pdfDoc.getPage(1).then((p) => { fitScale = Math.min($("pages").clientWidth - 16, 1000) / p.getViewport({ scale: 1 }).width; renderPages(); }); });
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
  await refresh();
  const id = decodeURIComponent(location.hash.slice(1)); const it = id && index?.items.find((i) => i.id === id);
  if (it) { history.replaceState(null, "", location.pathname + location.search); history.pushState({ id }, "", "#" + encodeURIComponent(id)); openItem(it, false); }
}
window.__iv = { get index() { return index; }, get zoom() { return zoom; } };
start();
if (api.needsLogin) { const lo = $("logout"); lo.hidden = false; lo.onclick = async () => { await api.logout(); location.replace(location.pathname); }; }
