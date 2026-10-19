// Supabase Edge Function: view-as
//
// Lets the PRESIDENT see the website exactly as a particular member,
// professional or guest sees it. It checks that the caller is the president,
// then returns a short-lived access token for the person asked about, so the
// browser's requests are answered the way they would be for that person's own
// login: their own lists, locks and counts, not an approximation.
//
// ---------------------------------------------------------------------
// Deploying this (no command line needed):
//   1. Run db/migrations/092-view-as-exact.sql in Supabase (SQL Editor).
//   2. Supabase Dashboard -> Edge Functions -> Deploy a new function.
//   3. Name it exactly "view-as" (js/view-as.js calls it by this name).
//   4. Paste this whole file in as its source, then Deploy.
//      Nothing to add under Secrets - the service role key is provided to
//      functions automatically.
// ---------------------------------------------------------------------
//
// What it will and won't do:
//   * Only the president's own signed-in session can use it. The caller is
//     identified from their session (never from the request body) and anyone
//     else gets a 403.
//   * It never returns a refresh token, so what it hands back stops working after
//     about an hour; the page asks again while a preview is open.
//   * The browser treats the result as READ ONLY: js/view-as.js refuses every
//     write, upload and email while a preview is on, and never shows private chat
//     messages.
//   * It refuses to act as the president, and as anyone who hasn't finished
//     setting up their account (signing a session in would confirm their email).
//   * It puts the person's "last signed in" time back afterwards and records each
//     use in view_as_log (readable by the president only, migration 092).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PRESIDENT_UID = '22044cd2-6804-4142-96c4-5c475ce9347a';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    // Who is calling: their own session, never a value from the request body.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });
    const { data: callerData } = await callerClient.auth.getUser();
    const caller = callerData?.user;
    if (!caller) return json({ error: 'Not signed in' }, 401);
    if (caller.id !== PRESIDENT_UID) return json({ error: 'Only the president can do this.' }, 403);

    const body = await req.json().catch(() => ({}));
    const targetId = String(body?.user_id ?? '');
    if (!UUID.test(targetId)) return json({ error: 'Choose a person.' }, 400);
    if (targetId === PRESIDENT_UID) return json({ error: 'That is you - just exit the preview.' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: found, error: findErr } = await admin.auth.admin.getUserById(targetId);
    const target = found?.user;
    if (findErr || !target || !target.email) return json({ error: "That person doesn't have a login to view." }, 404);
    if (!target.email_confirmed_at) {
      return json({ error: "They haven't finished setting up their account yet, so there's nothing to see as them." }, 409);
    }

    // Remember when they last signed in, so it can be put back.
    const { data: prevSignIn } = await admin.rpc('view_as_before', { p_target: targetId });

    // A one-time sign-in for them, redeemed straight away on a throwaway client.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: target.email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkErr || !tokenHash) return json({ error: "Couldn't prepare that view - try again." }, 500);

    const redeemer = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signed, error: otpErr } = await redeemer.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    const session = signed?.session;
    if (otpErr || !session) return json({ error: "Couldn't prepare that view - try again." }, 500);

    // Their "last signed in" goes back to what it was; the use is recorded.
    await admin.rpc('view_as_after', { p_president: caller.id, p_target: targetId, p_prev: prevSignIn ?? null });

    // Deliberately no refresh token: the browser has to ask again after an hour.
    return json({
      access_token: session.access_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      user: {
        id: target.id, email: target.email, aud: 'authenticated', role: 'authenticated',
        app_metadata: {}, user_metadata: {}, created_at: target.created_at
      }
    });
  } catch (_err) {
    return json({ error: 'Something went wrong - try again.' }, 500);
  }
});
