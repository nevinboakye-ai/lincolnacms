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
   - Leave `membership_number` alone — it fills itself in automatically (e.g. `LACMS-0001`)

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

- **Membership numbers become random**, not sequential (e.g. `LACMS-73412` instead of `LACMS-0001`), so the number can't be used to guess how many members you have. This re-randomizes every existing member's number too — nothing else about their account changes.
- **Adds `sankofa_eligible`** to the `members` table (defaults to `false` for everyone, including existing rows). Set it to `true` in Table Editor for Medicine and Pharmacy members, and aspiring medics/sixth formers — that's who can see the application form at `member-sankofa.html`. Everyone else sees a note explaining it's not open to them yet, instead of the form.

The Sankofa application itself is now a fuller questionnaire (stage of study, career aspirations, hobbies, social/fitness preference sliders, communication style, meeting frequency, what they want from the Circle) rather than a simple mentor/mentee choice — since every member in a Circle is both mentor and mentee to one another across the years. Review submissions the same way as before, in Table Editor → `sankofa_applications`.
