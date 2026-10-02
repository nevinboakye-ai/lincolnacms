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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'LACMS <onboarding@resend.dev>';

type EmailType = 'approved' | 'payment_reminder';

const TEMPLATES: Record<EmailType, (fullName: string) => { subject: string; html: string }> = {
  approved: (fullName) => ({
    subject: 'Your LACMS account is live!',
    html:
      '<p>Hi ' + fullName + ',</p>' +
      '<p>Good news - your LACMS account has been approved and is ready to go. Check your inbox for a separate email with a link to set your password, then you\'re straight in.</p>' +
      '<p>Once you\'re signed in, you can start using:</p>' +
      '<ul>' +
      '<li>Your digital membership card</li>' +
      '<li>Partner discounts and perks</li>' +
      '<li>Sankofa Circle mentorship</li>' +
      '<li>The LACMS Network</li>' +
      '<li>Members-first opportunities, events and more</li>' +
      '</ul>' +
      '<p><a href="https://lincolnacms.uk/member-login.html">Log in to LACMS</a></p>' +
      '<p>Welcome to LACMS!</p>' +
      '<p>- The LACMS Committee</p>'
  }),
  payment_reminder: (fullName) => ({
    subject: "Finish joining LACMS - membership payment needed",
    html:
      '<p>Hi ' + fullName + ',</p>' +
      '<p>Thanks for requesting your LACMS account! Before we can approve it, we need your membership payment to have gone through the University of Lincoln Students\' Union.</p>' +
      '<p>If you haven\'t already, you can join/pay here: <a href="https://lincolnsu.com/activities/view/acs-medical">lincolnsu.com/activities/view/acs-medical</a></p>' +
      '<p>Once that\'s done, get in touch at acms@lincolnsu.com and we\'ll get your account approved.</p>' +
      '<p>- The LACMS Committee</p>'
  })
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
    });

    const { data: isPresident, error: authError } = await supabase.rpc('is_president');
    if (authError || !isPresident) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 });
    }

    const body = await req.json();
    const type = body?.type as EmailType;
    const email = body?.email as string;
    const fullName = body?.full_name as string;

    const template = TEMPLATES[type];
    if (!template || !email || !fullName) {
      return new Response(JSON.stringify({ error: 'Invalid request - need a known type, email and full_name' }), { status: 400 });
    }

    const { subject, html } = template(fullName);

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
      return new Response(JSON.stringify({ error: 'Resend error: ' + errText }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
