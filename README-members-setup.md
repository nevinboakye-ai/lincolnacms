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
   - `member_type` — `member`, `supporting_committee`, or `executive_committee`. Shown on the membership card.
   - Leave `membership_number` alone — it fills itself in automatically (e.g. `LACMS-0001`)

Repeat step 2 for every member. Step 1 (inviting) only needs doing once per person, ever.

## 6. Test it

Log in as that member at `member-login.html` (or click "Member login" in the nav) and confirm the membership card shows their real name, course, year and membership number.

## What's next (Phase 2, not built yet)

Once this is solid: Sankofa applications, members-first opportunities, event registration, MoTM nominations, partner discount codes, and self-service password/account changes beyond the current reset-email flow.
