# LACMS Members Hub — setup guide (Phase 1)

This covers what's built (member login, profile, digital membership card) and the steps you need to do yourself to switch it on — none of it costs anything at LACMS's scale.

## What's live in the code

- `member-login.html` — login page, plus a "set your password" form for first-time members arriving from an invite email
- `member-hub.html` — the protected members hub: digital membership card, profile details, log out
- `js/supabase-client.js` — where your project keys go (currently placeholders)
- `js/members.js` — all the login/session/profile logic
- `db/schema.sql` — the one database table this needs, plus its security rule
- A "Member login" link has been added to the header, mobile menu and footer on every page

Nobody can access anything through this yet — the pages detect that Supabase isn't configured and show a notice instead of a broken login form. That's expected until you complete the steps below.

## 1. Create a free Supabase project (~5 minutes)

Supabase is the free backend service handling logins and storing member profiles. I can't create this account for you — it needs your email and agreement to their terms.

1. Go to [supabase.com](https://supabase.com) and sign up (free, no card required).
2. Click **New project**. Pick any name (e.g. "lacms"), set a database password (save it somewhere — you likely won't need it again, but keep it safe), and choose the region closest to the UK.
3. Wait ~2 minutes for the project to finish setting up.

## 2. Run the database schema

1. In your new project, open the **SQL Editor** (left sidebar).
2. Click **New query**, paste in the entire contents of [`db/schema.sql`](db/schema.sql) from this repo, and click **Run**.
3. This creates a `members` table and a security rule so a logged-in member can only ever see their own row — never anyone else's.

## 3. Set your site URL (needed for invite emails to work)

1. Go to **Authentication → URL Configuration**.
2. Set **Site URL** to your live site, e.g. `https://lincolnacms.uk`.
3. Under **Redirect URLs**, add `https://lincolnacms.uk/member-login.html` (and `http://localhost:8765/member-login.html` too if you want to test locally first).

Without this, invite/password-reset email links will send members to the wrong place.

## 4. Connect the site to your project

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key (not the `service_role` one — that one must never appear in the website's code).
3. Open [`js/supabase-client.js`](js/supabase-client.js) and paste them in:
   ```js
   const SUPABASE_URL = 'https://your-project-ref.supabase.co';
   const SUPABASE_ANON_KEY = 'your-long-anon-key-here';
   ```
4. Commit and push — the members hub is now live.

## 5. Add your first member

This is a two-step manual process for now (Phase 1 doesn't have an admin panel yet — you use Supabase's own dashboard, which already has everything needed):

1. **Invite them:** Authentication → Users → **Invite user**. Enter their email. Supabase emails them a link that lets them set their own password and land on `member-hub.html`.
2. **Add their profile:** Table Editor → `members` table → **Insert row**. Set:
   - `id` — open the Authentication → Users list, copy the UUID next to the person you just invited, paste it here
   - `full_name`, `course`, `year_of_study`, `membership_status` (`active` / `pending` / `expired`)
   - `member_type` — one of `member`, `supporting_committee`, `executive_committee`, `senior_sankofa_mentor`, `junior_sankofa_mentor`. Shown on the membership card.
   - `committee_role` — optional free text (e.g. `President`, `Treasurer`). Leave blank for regular members — it only shows up on the card and in Your Details when set.
   - Leave `membership_number` alone — it fills itself in automatically (e.g. `LACMS-482`)

Repeat step 2 for every member. Step 1 (inviting) only needs doing once per person, ever.

## 6. Test it

Log in as that member at `member-login.html` (or click "Member login" in the nav) and confirm the membership card shows their real name, course, year and membership number.

## 7. Phase 2 — discounts, Sankofa, event registration, MoTM nominations

Run [`db/migrations/003-phase-2-tables.sql`](db/migrations/003-phase-2-tables.sql) in the SQL Editor (same process as before — paste, Run) to add the tables this needs. Then:

- **Partner discounts** — Table Editor → `discounts` → Insert row: `partner_name`, `description`, `code` (optional), `link` (optional), `sort_order` (lower numbers show first). Set `is_active` to false to hide one without deleting it. Shows up on `member-perks.html`.
- **Members-first opportunities** — same idea, in the `member_opportunities` table (`title` instead of `partner_name`). This is separate from the public `opportunities.html` page — it's a members-only list.
- **Sankofa applications** — members apply themselves at `member-sankofa.html`; review them in Table Editor → `sankofa_applications`. Update `status` to `accepted` / `declined` as you go — there's no notification sent automatically, so let people know by email once decided.
- **Event registration** — members register themselves from a "Register" button that appears on `events.html` when signed in (alongside the existing RSVP email link, which still works for everyone). See who's registered for what in Table Editor → `event_registrations`.
- **MoTM nominations** — a real form now shows on `motm.html` for signed-in members (the mailto button stays too, for non-members). Nominations land in Table Editor → `motm_nominations`.
- **Change password** — members can now do this themselves from `member-hub.html`, no email link needed.

Everything here is committee-reviewed manually in Supabase's dashboard, same pattern as member provisioning — there's still no separate admin panel.

## 8. Random membership numbers + Sankofa Circle eligibility

Run [`db/migrations/004-random-membership-numbers-and-sankofa-circle.sql`](db/migrations/004-random-membership-numbers-and-sankofa-circle.sql). This does two things:

- **Membership numbers become random**, not sequential (e.g. `LACMS-482` instead of `LACMS-0001`), so the number can't be used to guess how many members you have. This re-randomizes every existing member's number too — nothing else about their account changes. (If you're setting this up fresh, also run [`005-membership-number-3-digits.sql`](db/migrations/005-membership-number-3-digits.sql) right after — 004 originally generated 5-digit numbers, 005 shortens the format to 3.)
- **Adds `sankofa_eligible`** to the `members` table (defaults to `false` for everyone, including existing rows). Set it to `true` in Table Editor for Medicine and Pharmacy members, and aspiring medics/sixth formers — that's who can see the application form at `member-sankofa.html`. Everyone else sees a note explaining it's not open to them yet, instead of the form.

The Sankofa application itself is now a fuller questionnaire (stage of study, career aspirations, hobbies, social/fitness preference sliders, communication style, meeting frequency, what they want from the Circle) rather than a simple mentor/mentee choice — since every member in a Circle is both mentor and mentee to one another across the years. Review submissions the same way as before, in Table Editor → `sankofa_applications`.

## 9. Branded auth emails

By default, Supabase sends invite/magic-link/reset-password emails using its own plain generic template — no LACMS branding at all. The [`email-templates/`](email-templates) folder has 5 ready-made, LACMS-branded HTML templates (black header, crest, gold tricolor accent, gold CTA button) to replace them:

- [`invite.html`](email-templates/invite.html) — sent when the committee invites a new member (the one currently in use).
- [`magic-link.html`](email-templates/magic-link.html) — passwordless sign-in link, if that's ever enabled.
- [`reset-password.html`](email-templates/reset-password.html) — "forgot password" flow.
- [`confirm-signup.html`](email-templates/confirm-signup.html) — email confirmation, if self-signup is ever enabled.
- [`change-email.html`](email-templates/change-email.html) — confirming an email address change.

**To apply them:** in the Supabase dashboard, go to **Authentication → Emails → Templates**. For each template listed above, open the matching one in the Supabase dashboard, switch to source/HTML view, and paste in the full contents of the matching file from `email-templates/`. Leave anything inside `{{ .ConfirmationURL }}`-style double braces exactly as-is — Supabase fills those in automatically. Each file starts with an HTML comment reminding you of this.

Also worth setting while you're there, under **Authentication → Emails → SMTP Settings** (or the "Sender details" fields): set the **Sender name** to `LACMS` instead of the Supabase default, so invites arrive in inboxes clearly labelled as coming from the society, not from Supabase.

At minimum, apply `invite.html` now since it's the only flow actually in use today — the other four are there ready for whenever those flows get switched on.

## 10. Discount partner address field

Run [`db/migrations/007-discount-address.sql`](db/migrations/007-discount-address.sql). This adds an optional `address` column to `discounts` — fill it in via Table Editor with whatever's most useful for that partner: a real building address, a social media handle, or a website. If filled in, it shows on the card between the partner name and the description; leave it blank to omit it.

Note: the "Lounge 11" discount card always renders in pink regardless of its position in the grid (matched by partner name) — every other discount cycles through gold/green/red/purple automatically based on order.

## 11. Members news feed

Run [`db/migrations/008-announcements-feed.sql`](db/migrations/008-announcements-feed.sql). This creates an `announcements` table and shows a "News & updates" feed on the members hub, between the profile card and the quick links.

To post something, add a row in Table Editor → `announcements`:

- **title** / **body** — the post itself. `body` supports line breaks (typed newlines show as paragraph breaks on the feed).
- **category** — one of `announcement` (gold), `news` (purple), `update` (green), or `urgent` (red). Controls the coloured tag on the post.
- **pinned** — set `true` to keep a post at the top of the feed with a highlighted background, above everything else regardless of date.
- **published_at** — defaults to the moment you create the row; change it if you want to backdate or schedule how a post's date reads.
- **is_active** — set `false` to pull a post from the feed without deleting it.

Members only ever see `is_active = true` posts, pinned first, then newest first.

## 12. Midlands Medics Gala (MMG) portal

Run [`db/migrations/009-mmg-portal.sql`](db/migrations/009-mmg-portal.sql). This builds the whole MMG portal: [mmg.html](mmg.html) (public event info + exclusive gated content), [mmg-login.html](mmg-login.html) (login/signup for people who aren't full LACMS members), and [mmg-hub.html](mmg-hub.html) (an MMG guest's own account page — digital pass, details, access status, change password — the equivalent of member-hub.html for people who aren't full LACMS members). The homepage's two Gala links and the events-page Gala row now point at `mmg.html` instead of the events calendar.

MMG guests are routed to `mmg-hub.html`, not `member-hub.html` — the site-wide "Members hub" header link now checks which table a signed-in session actually belongs to (`members` vs `mmg_guests`) and sends them to the right one, so an MMG-only account never hits a "couldn't find your profile" error.

**Before this goes live**, swap the placeholder ticket link — search `mmg.html` for `#mmg-ticket-link-todo` and replace it with wherever tickets are actually sold. Also replace the three `[Placeholder]` paragraphs (Location, Speaker list, Programme & night order) once those details are confirmed.

### Two separate kinds of MMG access

**Existing Lincoln LACMS members** don't need a new account — their normal login already works on the portal. But being a LACMS member doesn't automatically mean being an MMG attendee, so nothing exclusive shows until you flip a flag for them:

- Table Editor → `members` → find the person → set **mmg_attendee** to `true` to unlock location, programme, speaker list and voting.
- Set **mmg_committee** to `true` to *also* unlock the planning-updates feed (this implies attendee access too, no need to set both).

**Attendees and partner-committee members from the other 7 universities** aren't Lincoln students and can't become LACMS members via the Students' Union, so they get their own account instead, self-registered on `mmg-login.html`:

- They fill in name, university, email and password themselves — no invite needed from you.
- Every new signup lands in Table Editor → `mmg_guests` with **access_level** = `pending`, and can see nothing exclusive yet.
- Once you've verified they're legitimate (checking against a ticket list, or who partner committees confirm), change **access_level** to `attendee` or `committee` for them. That's it — the portal picks it up on their next visit.
- Their signup uses Supabase's normal "Confirm signup" email — already branded if you applied the template from [Section 9](#9-branded-auth-emails).

### Planning updates (committee only)

Same pattern as the members feed — add rows in Table Editor → `mmg_updates` (**title**, **body**, **pinned**, **is_active**, **published_at**). Only people with committee-level access (Lincoln `mmg_committee = true`, or guest `access_level = committee`) can see these — enforced at the database level, not just hidden in the page.

### Awards voting

Add rows in Table Editor → `mmg_award_categories` — just a **name** (e.g. "Best Dressed") and **sort_order**. Voting is write-in: anyone with attendee or committee access can type any name, one vote per category, and can change their vote while it's open. Set **voting_open** to `false` on a category to lock it (e.g. once the night starts). To see results, use the SQL Editor: `select category_id, nominee_name, count(*) from mmg_votes group by 1, 2 order by 1, count(*) desc;`.
