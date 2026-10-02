// Supabase Edge Function: send-account-email
//
// Sends the two automatic emails behind the Account Requests dashboard
// section - "your account is live" on approval, and a payment reminder
// when the president marks someone as still needing to pay - via Resend
// (https://resend.com). This is the one place on the whole site that
// sends an email with nobody clicking "send" themselves; everywhere
// else, "contact this person" is a mailto: link someone on the
// committee has to click, since there's no other email infrastructure
// here at all.
//
// ---------------------------------------------------------------------
// Deploying this (no command line needed):
//   1. Supabase Dashboard -> Edge Functions -> Deploy a new function.
//   2. Name it exactly "send-account-email" (js/members.js calls it by
//      this name).
//   3. Paste this whole file in as its source, then Deploy.
//   4. Edge Functions -> Manage secrets (or Project Settings -> Edge
//      Functions), add:
//        RESEND_API_KEY    - from resend.com (free tier covers a
//                            student society's volume many times over)
//        RESEND_FROM_EMAIL - optional. Leave unset at first and it
//                            falls back to Resend's own test sender
//                            (onboarding@resend.dev), which works
//                            immediately with no setup but looks
//                            exactly like what it is - a test address.
//                            Once you verify a domain you control (e.g.
//                            lincolnacms.uk) with Resend, set this to
//                            something like "LACMS <hello@lincolnacms.uk>"
//                            for a real "from LACMS" address.
// ---------------------------------------------------------------------
//
// Authorization: this function only ever acts on behalf of whoever
// calls it, using their own session token - supabase.functions.invoke()
// in the browser attaches that automatically. It checks is_president()
// under that same identity before sending anything, the same boundary
// every other privileged action on this site already uses (see
// migration 025) - it never trusts a client-supplied "I'm the
// president" flag, since that would just be a value anyone could send.
//
// CORS: a browser calling this (which is the only way it's ever called
// - supabase.functions.invoke() from js/members.js) sends a preflight
// OPTIONS request first, and refuses to even make the real POST if that
// preflight doesn't come back with the right Access-Control-* headers.
// Supabase doesn't add these automatically, so every response below -
// including the OPTIONS short-circuit - carries them explicitly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'LACMS <onboarding@resend.dev>';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// full_name ultimately traces back to the public request form (even for
// an email triggered from the dashboard, it's still whatever text the
// original requester typed in) - escaped before going into an HTML
// email for the same reason every database field gets escaped before
// going into the site's own HTML elsewhere.
function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------
// Branded HTML shell - every real email client strips <link>/external
// stylesheets and many strip <style> blocks too, so this is all inline
// styles on purpose, not an oversight. Colours and fonts are pulled
// straight from css/styles.css's own tokens (--color-gold #d4a62b,
// --font-display's Georgia/serif fallback, --font-body's system-font
// fallback) rather than the actual web fonts, since those can't load in
// an email anyway - this uses exactly what the site already falls back
// to for anyone without them.
// ---------------------------------------------------------------------

const LOGO_URL = 'https://lincolnacms.uk/Media/ACMS%20Branding/logo.png';
const GOLD = '#d4a62b';
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

function emailButton(href: string, label: string) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;"><tr><td style="border-radius:8px; background:' + GOLD + ';">' +
    '<a href="' + href + '" style="display:inline-block; padding:12px 24px; font-family:' + SANS + '; font-size:15px; font-weight:700; color:#1a1500; text-decoration:none; border-radius:8px;">' + label + '</a>' +
    '</td></tr></table>';
}

function renderEmailShell(preheader: string, bodyHtml: string) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0; padding:0; background:#0a0a0c;">' +
    '<div style="display:none; max-height:0; overflow:hidden; opacity:0;">' + preheader + '</div>' +
    '<div style="padding: 32px 16px; font-family:' + SANS + ';">' +
    '<div style="max-width:480px; margin:0 auto; background:#141414; border-radius:14px; overflow:hidden; border:1px solid rgba(212,166,43,0.3);">' +
    '<div style="height:5px; background:linear-gradient(90deg, #d4a62b 0%, #d4a62b 33%, #1e7a46 33%, #1e7a46 66%, #c1272d 66%, #c1272d 100%);"></div>' +
    '<div style="padding:32px 32px 4px; text-align:center;">' +
    '<img src="' + LOGO_URL + '" width="56" height="56" alt="LACMS" style="border-radius:50%; display:inline-block;">' +
    '<div style="margin-top:12px; color:' + GOLD + '; font-weight:700; letter-spacing:0.08em; font-size:13px; text-transform:uppercase; font-family:' + SANS + ';">LACMS</div>' +
    '<div style="color:#837e73; font-size:11px; margin-top:2px; font-family:' + SANS + ';">Lincoln African Caribbean Medical Society</div>' +
    '</div>' +
    '<div style="padding:12px 32px 8px; color:#f5f1e6; font-family:' + SANS + '; font-size:15px; line-height:1.65;">' +
    bodyHtml +
    '</div>' +
    '<div style="padding:20px 32px 28px; border-top:1px solid rgba(255,255,255,0.08); margin-top:12px; text-align:center; font-family:' + SANS + '; font-size:12px; color:#837e73;">' +
    'University of Lincoln, Brayford Pool, Lincoln<br>' +
    '<a href="mailto:acms@lincolnsu.com" style="color:' + GOLD + '; text-decoration:none;">acms@lincolnsu.com</a>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</body></html>'
  );
}

type EmailType = 'approved' | 'payment_reminder';

const TEMPLATES: Record<EmailType, (fullName: string) => { subject: string; html: string }> = {
  approved: (fullName) => ({
    subject: 'Your LACMS account is live!',
    html: renderEmailShell(
      "You're officially in - here's what's waiting for you.",
      '<h1 style="font-family:' + SERIF + '; font-size:22px; font-weight:400; color:#f5f1e6; margin:8px 0 4px;">Welcome to LACMS, ' + fullName + '.</h1>' +
      '<p>Good news - your account has been approved and is ready to go. Check your inbox for a separate email with a link to set your password, then you\'re straight in.</p>' +
      '<p style="margin-bottom:6px;">Once you\'re signed in, you can start using:</p>' +
      '<ul style="margin:0 0 8px; padding-left:20px;">' +
      '<li>Your digital membership card</li>' +
      '<li>Partner discounts and perks</li>' +
      '<li>Sankofa Circle mentorship</li>' +
      '<li>The LACMS Network</li>' +
      '<li>Members-first opportunities, events and more</li>' +
      '</ul>' +
      emailButton('https://lincolnacms.uk/member-login.html', 'Log in to LACMS') +
      '<p style="color:#b5b0a3;">Welcome to the family - we\'re glad you\'re here.</p>' +
      '<p style="color:#b5b0a3; margin-bottom:0;">- The LACMS Committee</p>'
    )
  }),
  payment_reminder: (fullName) => ({
    subject: "Finish joining LACMS - membership payment needed",
    html: renderEmailShell(
      'One quick step left before we can get your account set up.',
      '<h1 style="font-family:' + SERIF + '; font-size:22px; font-weight:400; color:#f5f1e6; margin:8px 0 4px;">Almost there, ' + fullName + '.</h1>' +
      '<p>Thanks for requesting your LACMS account! Before we can approve it, we need your membership payment to have gone through the University of Lincoln Students\' Union.</p>' +
      '<p>If you haven\'t already, you can join/pay here:</p>' +
      emailButton('https://lincolnsu.com/activities/view/acs-medical', 'Join via the Students\' Union') +
      '<p>Once that\'s done, get in touch at <a href="mailto:acms@lincolnsu.com" style="color:' + GOLD + ';">acms@lincolnsu.com</a> and we\'ll get your account approved.</p>' +
      '<p style="color:#b5b0a3; margin-bottom:0;">- The LACMS Committee</p>'
    )
  })
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });

    const { data: isPresident, error: authError } = await supabase.rpc('is_president');
    if (authError || !isPresident) {
      return jsonResponse({ error: 'Not authorized' }, 403);
    }

    const body = await req.json();
    const type = body?.type as EmailType;
    const email = body?.email as string;
    const fullName = body?.full_name as string;

    const template = TEMPLATES[type];
    if (!template || !email || !fullName) {
      return jsonResponse({ error: 'Invalid request - need a known type, email and full_name' }, 400);
    }

    const { subject, html } = template(escapeHtml(fullName));

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: email, subject, html })
    });

    if (!resendResponse.ok) {
      const errText = await resendResponse.text();
      return jsonResponse({ error: 'Resend error: ' + errText }, 502);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
