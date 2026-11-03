// Data layer. Each adapter: needsLogin, login(u,p), logout(), listIndex(), fileUrl(item)
const LocalAdapter = {
  needsLogin: false,
  async listIndex() {
    const r = await fetch("data/index.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("Could not load index (" + r.status + ")");
    return r.json();
  },
  async fileUrl(item) { return "data/" + item.file + "?v=" + item.version; },
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
  };
}
window.makeAdapter = (cfg) => cfg.mode === "supabase" ? SupabaseAdapter(cfg.supabase) : LocalAdapter;
