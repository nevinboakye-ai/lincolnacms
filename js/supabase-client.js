// LACMS Members Hub — Supabase connection
//
// Fill in the two values below from your Supabase project:
// Dashboard → Project Settings → API → "Project URL" and "anon public" key.
// The anon key is safe to expose in client-side code — it can only do what
// the Row Level Security policies in db/schema.sql allow (see that file).
//
// Until these are filled in, the login and member hub pages will show a
// "not configured yet" message instead of trying to connect.

var SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
var SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';

// `var` (not `const`) deliberately, so these attach to `window` and stay
// readable from js/members.js, which is loaded as a separate plain <script>
// tag rather than a module.
var supabaseIsConfigured =
  SUPABASE_URL.indexOf('YOUR_SUPABASE') !== 0 &&
  SUPABASE_ANON_KEY.indexOf('YOUR_SUPABASE') !== 0;

var supabaseClient = supabaseIsConfigured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
