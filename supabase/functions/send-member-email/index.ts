// Supabase Edge Function: send-member-email
//
// Sends the automatic confirmation emails members get after they do something
// on the site:
//   * sankofa_application - "we've received your Sankofa application"
//   * motm_nomination     - "thanks for nominating <name> for Member of the Month"
// Sent through Resend (https://resend.com), the same as send-account-email.
//
// ---------------------------------------------------------------------
// Deploying this (no command line needed):
//   1. Supabase Dashboard -> Edge Functions -> Deploy a new function.
//   2. Name it exactly "send-member-email" (js/members.js calls it by this name).
//   3. Paste this whole file in as its source, then Deploy.
//   4. It uses the same secrets as send-account-email - RESEND_API_KEY and
//      RESEND_FROM_EMAIL - which are shared by every function in the project,
//      so there's nothing new to add. (SUPABASE_SERVICE_ROLE_KEY is provided
//      to functions automatically.)
//   5. Run db/migrations/082-member-email-log.sql (the log that stops anyone
//      getting the same email twice).
// ---------------------------------------------------------------------
//
// Who can call it, and what it will send: the browser calls this right after
// someone submits the form, with their own session. The function checks that
// the application / nomination named in the request really is THEIRS (and was
// made in the last hour), sends to that person's own account email - never to
// an address the browser supplies - and records it in member_email_log, where
// a unique key on (kind, ref_id) means the same submission can never trigger
// two emails, however often this is called. A failed send is recorded as
// failed and can be retried. Nothing here can be used to email anyone else.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
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

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function escapeHtml(str: string) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------
// Branded shell (inline styles on purpose - email clients strip stylesheets).
// ---------------------------------------------------------------------
const LOGO_URL = SITE + '/Media/ACMS%20Branding/logo.png';
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
    'This message was sent from an address we don\'t read, so please don\'t reply to it - email us at ' +
    '<a href="mailto:' + REPLY_TO + '" style="color:' + GOLD + '; text-decoration:none;">' + REPLY_TO + '</a> instead.<br>' +
    'University of Lincoln, Brayford Pool, Lincoln' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</body></html>'
  );
}

const H1 = 'font-family:' + SERIF + '; font-size:22px; font-weight:400; color:#f5f1e6; margin:8px 0 4px;';
const MUTED = 'color:#b5b0a3;';

function sankofaEmail(first: string, phase: string) {
  const what = phase ? 'your application for a Sankofa Circle (' + escapeHtml(phase) + ')' : 'your application for a Sankofa Circle';
  return {
    subject: "We've received your Sankofa application",
    html: renderEmailShell(
      "Thanks for applying - here's what happens next.",
      '<h1 style="' + H1 + '">Thanks for applying, ' + escapeHtml(first) + '.</h1>' +
      '<p>We\'ve got ' + what + '. Nothing more for you to do - here\'s what happens next:</p>' +
      '<ol style="margin:0 0 8px; padding-left:20px;">' +
      '<li style="margin-bottom:6px;"><strong>We review it.</strong> The committee reads every application.</li>' +
      '<li style="margin-bottom:6px;"><strong>We match you.</strong> We pair Circles around what you have in common, ahead of the coming cycle.</li>' +
      '<li><strong>You hear from us.</strong> We\'ll email you as soon as there\'s an update.</li>' +
      '</ol>' +
      emailButton(SITE + '/member-hub.html', 'Open the Members Hub') +
      '<p style="' + MUTED + '">Questions or something to add? Just email us at acms@lincolnsu.com.</p>' +
      '<p style="' + MUTED + ' margin-bottom:0;">- The LACMS Committee</p>'
    )
  };
}

function motmEmail(first: string, nominee: string, monthLabel: string, reason: string) {
  const when = monthLabel ? ' for ' + escapeHtml(monthLabel) : '';
  return {
    subject: 'Thanks for nominating ' + nominee.replace(/[\r\n]+/g, ' ') + ' for Member of the Month',
    html: renderEmailShell(
      'Your nomination is in.',
      '<h1 style="' + H1 + '">Thank you, ' + escapeHtml(first) + '.</h1>' +
      '<p>Your nomination of <strong>' + escapeHtml(nominee) + '</strong> for Member of the Month' + when + ' is in. It means a lot that you took the time to recognise someone.</p>' +
      (reason
        ? '<p style="margin-bottom:6px;' + MUTED + '">What you said:</p><p style="margin-top:0; padding:10px 14px; border-left:3px solid ' + GOLD + '; background:rgba(255,255,255,0.04); font-style:italic;">' + escapeHtml(reason).replace(/\n/g, '<br>') + '</p>'
        : '') +
      '<p>The committee reviews every nomination, and the winner and runners-up win LACMS prizes. Winners are shared on the Member of the Month page. You can make one nomination a month, so you\'re welcome to nominate again from the 1st of next month.</p>' +
      emailButton(SITE + '/motm.html', 'See Member of the Month') +
      '<p style="' + MUTED + ' margin-bottom:0;">- The LACMS Committee</p>'
    )
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    // Who is calling (their own session - never a value from the request body).
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user || !user.email) return jsonResponse({ error: 'Not signed in' }, 401);

    const body = await req.json();
    const type = String(body?.type ?? '');
    const refId = String(body?.ref_id ?? '');
    if (!['sankofa_application', 'motm_nomination'].includes(type) || !UUID.test(refId)) {
      return jsonResponse({ error: 'Invalid request' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Their name for the greeting.
    let fullName = '';
    {
      const { data: m } = await admin.from('members').select('full_name').eq('id', user.id).maybeSingle();
      fullName = m?.full_name ?? '';
      if (!fullName) {
        const { data: p } = await admin.from('network_professionals').select('full_name').eq('user_id', user.id).limit(1).maybeSingle();
        fullName = p?.full_name ?? '';
      }
    }
    const first = (fullName.trim().split(/\s+/)[0]) || 'there';

    let email: { subject: string; html: string };
    const recent = (iso: string) => Date.now() - new Date(iso).getTime() < 60 * 60 * 1000;

    if (type === 'sankofa_application') {
      const { data: app } = await admin.from('sankofa_applications')
        .select('id, member_id, role_applied_for, round_id, created_at').eq('id', refId).maybeSingle();
      if (!app || app.member_id !== user.id || app.role_applied_for !== 'mentee') return jsonResponse({ error: 'Not found' }, 404);
      if (!recent(app.created_at)) return jsonResponse({ error: 'That application is too old to confirm' }, 400);
      let phase = '';
      if (app.round_id) {
        const { data: r } = await admin.from('sankofa_rounds').select('name').eq('id', app.round_id).maybeSingle();
        phase = r?.name ?? '';
      }
      email = sankofaEmail(first, phase);
    } else {
      const { data: n } = await admin.from('motm_nominations')
        .select('id, nominator_id, nominee_name, reason, nomination_month, created_at').eq('id', refId).maybeSingle();
      if (!n || n.nominator_id !== user.id) return jsonResponse({ error: 'Not found' }, 404);
      if (!recent(n.created_at)) return jsonResponse({ error: 'That nomination is too old to confirm' }, 400);
      let monthLabel = '';
      const m = /^(\d{4})-(\d{2})$/.exec(n.nomination_month ?? '');
      if (m) monthLabel = new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      email = motmEmail(first, n.nominee_name, monthLabel, n.reason ?? '');
    }

    // Claim it: the unique key means a second call for the same submission stops here.
    const { data: claim, error: claimErr } = await admin.from('member_email_log')
      .insert({ kind: type, ref_id: refId, user_id: user.id, recipient: user.email, status: 'sending' })
      .select('id').single();
    if (claimErr) {
      if ((claimErr as { code?: string }).code === '23505') return jsonResponse({ ok: true, skipped: 'already sent' }, 200);
      return jsonResponse({ error: 'Couldn\'t log the email: ' + claimErr.message }, 500);
    }

    const resend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: user.email, reply_to: REPLY_TO, subject: email.subject, html: email.html })
    });
    if (!resend.ok) {
      const errText = await resend.text();
      await admin.from('member_email_log').update({ status: 'failed', error: errText.slice(0, 1000) }).eq('id', claim.id);
      return jsonResponse({ error: 'Resend error: ' + errText }, 502);
    }
    await admin.from('member_email_log').update({ status: 'sent' }).eq('id', claim.id);
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
