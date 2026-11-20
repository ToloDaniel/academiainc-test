// AcademiaInc settings. The public key is safe to keep here: it is meant to be public.
// Never put the secret or service_role key in any file of the website.
window.ACADEMIA = {
  env: "test",                                   // "test" or "live"
  supabaseUrl: "https://flzirejwgajljrfebnda.supabase.co",
  anonKey: "PASTE_PUBLIC_KEY_HERE",              // the publishable (or anon) key from Project Settings, API
  baseDomain: ""                                 // live only, e.g. "academiainc.com" (schools get school.academiainc.com)
};
