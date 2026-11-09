// Data layer. Each adapter: needsLogin, login(u,p), logout(), listIndex(), fileUrl(item), loadChecks(), setCheck(), mapHtml(), mapPngUrl()
const CHECK_FIELDS = ["seen", "quoted", "ordered"];
const CHECKS_LS = "iv-stop-checks";
const MAP_HTML_KEY = "maps/visited_locations.html";
const MAP_PNG_KEY = "maps/visited_locations.png";
const checkKey = (date, company) => JSON.stringify([date, company]);
const emptyCheck = () => ({ seen: false, quoted: false, ordered: false });
function readLocalChecks() {
  try { return JSON.parse(localStorage.getItem(CHECKS_LS) || "{}"); }
  catch { return {}; }
}
function writeLocalChecks(all) { localStorage.setItem(CHECKS_LS, JSON.stringify(all)); }
function rowsToMap(rows) {
  const map = {};
  for (const r of rows || []) map[checkKey(r.stop_date, r.company)] = { seen: !!r.seen, quoted: !!r.quoted, ordered: !!r.ordered };
  return map;
}
const LocalAdapter = {
  needsLogin: false,
  async listIndex() {
    const r = await fetch("data/index.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("Could not load index (" + r.status + ")");
    return r.json();
  },
  async fileUrl(item) { return "data/" + item.file + "?v=" + item.version; },
  async loadChecks() { return readLocalChecks(); },
  async setCheck(date, company, field, value) {
    if (!CHECK_FIELDS.includes(field)) throw new Error("invalid field");
    const all = readLocalChecks();
    const k = checkKey(date, company);
    const row = { ...emptyCheck(), ...(all[k] || {}), [field]: !!value };
    all[k] = row;
    writeLocalChecks(all);
    return row;
  },
  async mapHtml() {
    const r = await fetch("data/maps/visited_locations.html?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("map html " + r.status);
    return r.text();
  },
  async mapPngUrl() {
    return "data/maps/visited_locations.png?t=" + Date.now();
  },
};
// Supabase mode: expects supabase-js vendored at vendor/supabase.js, a private bucket containing
// index.json + files/*, and RLS on storage.objects allowing only authenticated users to read.
function SupabaseAdapter(cfg) {
  let sb = null;
  const client = () => (sb ||= window.supabase.createClient(cfg.url, cfg.anonKey));
  return {
    needsLogin: true,
    async session() { const { data } = await client().auth.getSession(); return data.session; },
    async login(user, pass) {
      const email = user.includes("@") ? user : user.toLowerCase() + "@" + cfg.emailDomain;
      const { error } = await client().auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    },
    async logout() { await client().auth.signOut(); },
    async listIndex() {
      const { data, error } = await client().from("itinerary_index").select("data").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data ? data.data : { generated: null, items: [] };
    },
    async fileUrl(item) {
      const { data, error } = await client().storage.from(cfg.bucket).createSignedUrl(item.file, 300);
      if (error) throw error;
      return data.signedUrl;
    },
    async loadChecks() {
      const { data, error } = await client().from("stop_checks").select("stop_date,company,seen,quoted,ordered");
      if (error) throw error;
      return rowsToMap(data);
    },
    async setCheck(date, company, field, value) {
      if (!CHECK_FIELDS.includes(field)) throw new Error("invalid field");
      const sb = client();
      const { data: sess } = await sb.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) throw new Error("not signed in");
      const patch = { [field]: !!value, updated_at: new Date().toISOString() };
      const pick = (r) => ({ seen: !!r.seen, quoted: !!r.quoted, ordered: !!r.ordered });
      const upd = await sb.from("stop_checks").update(patch)
        .eq("user_id", uid).eq("stop_date", date).eq("company", company)
        .select("seen,quoted,ordered");
      if (upd.error) throw upd.error;
      if (upd.data && upd.data.length) return pick(upd.data[0]);
      const row = { ...emptyCheck(), [field]: !!value };
      const ins = await sb.from("stop_checks").insert({
        user_id: uid, stop_date: date, company, ...row, updated_at: patch.updated_at,
      }).select("seen,quoted,ordered");
      if (ins.error) {
        if (ins.error.code === "23505") {
          const retry = await sb.from("stop_checks").update(patch)
            .eq("user_id", uid).eq("stop_date", date).eq("company", company)
            .select("seen,quoted,ordered");
          if (retry.error) throw retry.error;
          if (!retry.data || !retry.data.length) throw new Error("could not save check");
          return pick(retry.data[0]);
        }
        throw ins.error;
      }
      if (!ins.data || !ins.data.length) throw new Error("could not save check");
      return pick(ins.data[0]);
    },
    async mapHtml() {
      const { data, error } = await client().storage.from(cfg.bucket).download(MAP_HTML_KEY);
      if (error) throw error;
      return await data.text();
    },
    async mapPngUrl() {
      const { data, error } = await client().storage.from(cfg.bucket).createSignedUrl(MAP_PNG_KEY, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  };
}
window.makeAdapter = (cfg) => cfg.mode === "supabase" ? SupabaseAdapter(cfg.supabase) : LocalAdapter;
