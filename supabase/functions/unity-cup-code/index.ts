// Supabase Edge Function: unity-cup-code
//
// Emails a 6-digit code to someone who wants to vote in the Unity Cup Player of the Tournament poll, vote for
// Man of the Match, or enter the Unity Cup raffle, so we know the address is a real inbox they can read. Sent through Resend,
// the same as send-account-email.
//
// ---------------------------------------------------------------------
// Deploying this (no command line needed):
//   1. Supabase Dashboard -> Edge Functions -> Deploy a new function.
//   2. Name it exactly "unity-cup-code" (js/unity-cup.js calls it by this name).
//   3. Paste this whole file in as its source.
//   4. IMPORTANT: turn OFF "Enforce JWT verification" for this function (Edge Functions -> unity-cup-code
//      -> Details). Voters have no account, so there is no login token to check. Everything the function
//      can do is limited by the database (see below), and it only ever emails the address it was given.
//   5. It uses the same secrets as the other functions (RESEND_API_KEY, RESEND_FROM_EMAIL), nothing new.
//   6. Run db/migrations/114-unity-cup.sql first (and 126-unity-cup-match-control.sql for Man of the Match voting).
//   7. Already deployed before Man of the Match voting existed? Open the function, paste this whole file over the
//      old one and Deploy again. Nothing else changes.
//
// What stops it being abused: the database function unity_request_code decides whether to issue a code
// (voting/raffle/a match must be open, one address can ask only 3 times per 15 minutes, the whole site is capped
// at 600 codes per 10 minutes, throwaway email domains and addresses that have already voted/entered are
// refused). The code itself is stored only as a hash and is never returned to the browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'LACMS <onboarding@resend.dev>';
const REPLY_TO = 'acms@lincolnsu.com';
const SITE = 'https://lincolnacms.uk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const GOLD = '#d4a62b';
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

function renderEmail(code: string, purpose: string) {
  const what = purpose === 'raffle' ? 'enter the Unity Cup raffle'
    : purpose === 'mom' ? 'vote for Man of the Match in the Unity Cup'
    : 'vote in the Unity Cup Player of the Tournament poll';
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0; padding:0; background:#0a0a0c;">' +
    '<div style="display:none; max-height:0; overflow:hidden; opacity:0;">Your Unity Cup code is ' + code + '</div>' +
    '<div style="padding: 32px 16px; font-family:' + SANS + ';">' +
    '<div style="max-width:480px; margin:0 auto; background:#141414; border-radius:14px; overflow:hidden; border:1px solid rgba(212,166,43,0.3);">' +
    '<div style="height:5px; background:linear-gradient(90deg, #d4a62b 0%, #d4a62b 33%, #1e7a46 33%, #1e7a46 66%, #c1272d 66%, #c1272d 100%);"></div>' +
    '<div style="padding:32px 28px; color:#e9e6dd;">' +
    '<p style="margin:0 0 6px; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:' + GOLD + ';">LACMS Unity Cup</p>' +
    '<h1 style="margin:0 0 16px; font-family:' + SERIF + '; font-size:24px; color:#ffffff;">Your code</h1>' +
    '<p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#cfcbbf;">Type this code on the Unity Cup page to ' + what + '. It works for 10 minutes.</p>' +
    '<div style="margin:0 0 22px; padding:18px; text-align:center; border-radius:10px; background:#0a0a0c; border:1px solid rgba(212,166,43,0.4); font-family:' + SERIF + '; font-size:36px; letter-spacing:10px; color:' + GOLD + ';">' + code + '</div>' +
    '<p style="margin:0; font-size:13px; line-height:1.6; color:#8f8b80;">Didn\'t ask for this? You can ignore this email, and nothing will happen.</p>' +
    '</div>' +
    '<div style="padding:16px 28px 24px; border-top:1px solid rgba(255,255,255,0.08); font-size:12px; line-height:1.6; color:#8f8b80;">' +
    'Sent by the Lincoln African Caribbean Medical Society (LACMS), a student society, because someone entered this address on our website. We use it only to check it is real. ' +
    '<a href="' + SITE + '/privacy.html" style="color:' + GOLD + ';">Privacy notice</a>.' +
    '</div></div></div></body></html>'
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'bad_request' }, 405);

  let body: { email?: string; purpose?: string } = {};
  try { body = await req.json(); } catch (_e) { return json({ ok: false, error: 'bad_request' }, 400); }
  const email = String(body.email ?? '').trim();
  const purpose = String(body.purpose ?? '');
  if (!email || email.length > 254 || (purpose !== 'vote' && purpose !== 'raffle' && purpose !== 'mom')) return json({ ok: false, error: 'bad_request' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('unity_request_code', { p_email: email, p_purpose: purpose });
  if (error || !data) return json({ ok: false, error: 'server' }, 500);
  if (!data.ok) return json({ ok: false, error: data.error }, 200);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [email],
      reply_to: REPLY_TO,
      subject: 'Your Unity Cup code: ' + data.code,
      html: renderEmail(String(data.code), purpose)
    })
  });
  if (!res.ok) return json({ ok: false, error: 'send_failed' }, 502);
  return json({ ok: true }, 200);
});
