// Local (localhost) reads ./data; anywhere else uses the private Supabase bucket behind login.
// The anon key is public by design; storage RLS allows reads only for signed-in users.
window.IV_CONFIG = {
  mode: /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "local" : "supabase",
  supabase: { url: "https://hnlkuqrlwpzbgeubmext.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhubGt1cXJsd3B6YmdldWJtZXh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3MTE5MDEsImV4cCI6MjEwOTI4NzkwMX0.sGIhfSgUpH32m20EOU6o63QcYPD63zV3kglTMjMa2ew", bucket: "itineraries", emailDomain: "users.itinerary.local" }
};
