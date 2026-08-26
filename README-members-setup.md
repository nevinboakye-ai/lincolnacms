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

Prefer to add their profile before inviting them instead? See [Section 21](#21-adding-a-member-before-theyve-signed-up).

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

The site-wide "Member login" nav button (header, avatar, mobile drawer) no longer goes straight to `member-login.html` — it goes to [login.html](login.html) first, a chooser page with two cards: "Lincoln LACMS member" → `member-login.html`, and "MMG attendee or partner committee" → `mmg-login.html`. Both login pages also carry a small "choose a different login" link back to `login.html`, in case someone lands on the wrong one directly (e.g. a bookmark or the footer link, which still points straight at `member-login.html`).

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

Same pattern as the members feed — add rows in Table Editor → `mmg_updates` (**title**, **body**, **pinned**, **is_active**, **published_at**). Only people with committee-level access (Lincoln `mmg_committee = true`, or guest `access_level = committee`) can see these — enforced at the database level, not just hidden in the page. Shown in three places: `mmg.html`'s committee panel, `mmg-hub.html` (for guest committee members), and `member-hub.html` (for Lincoln committee members).

### Awards voting

Add rows in Table Editor → `mmg_award_categories` — just a **name** (e.g. "Best Dressed") and **sort_order**. Voting is write-in: anyone with attendee or committee access can type any name, one vote per category, and can change their vote while it's open. Set **voting_open** to `false` on a category to lock it (e.g. once the night starts). To see results, use the SQL Editor: `select category_id, nominee_name, count(*) from mmg_votes group by 1, 2 order by 1, count(*) desc;`.

## 13. General MMG updates, night perks and attendee media

Run [`db/migrations/010-mmg-updates-perks-media.sql`](db/migrations/010-mmg-updates-perks-media.sql) (needs migration 009 already applied).

**General MMG updates** (separate from the committee-only planning feed) — add rows in Table Editor → `mmg_attendee_updates` (same fields as `mmg_updates`: title, body, pinned, is_active, published_at). Visible to *everyone* with attendee-or-committee access, on `mmg.html`, `mmg-hub.html` and `member-hub.html` alike — this is the one to use for anything all attendees should see (dress code reminders, timing changes, etc.), keeping it clearly separate from committee-only planning chatter.

**Night-exclusive perks/vouchers** — add rows in Table Editor → `mmg_perks`. Same fields as the LACMS `discounts` table (**partner_name**, **description**, **code**, **address**, **link**, **sort_order**, **is_active**), rendered with the same card style, shown on `mmg.html` under "Perks & vouchers."

**Attendee media uploads** — attendees can upload photos/videos on `mmg.html` for the after-gala gallery/highlight video. This uses Supabase Storage: the migration creates a private `mmg-media` bucket and a policy that only lets someone with attendee-or-committee access upload into their *own* folder (named after their user ID) — nobody can browse or download via the site itself, including other attendees.

To review submissions: Supabase Dashboard → Storage → `mmg-media`, browse by folder. There's no "select" policy for attendees, so this only works from the dashboard (which uses the service role and bypasses storage policies), not from the site.

Files over 200MB are rejected client-side with a friendly message — if you need a higher limit, that's enforced both in `js/members.js` (`MMG_MEDIA_MAX_BYTES`) and in Supabase's own per-bucket file-size limit (Dashboard → Storage → `mmg-media` → bucket settings), so raise both if needed.

## 14. Member of the Month — now editable from Supabase

Run [`db/migrations/011-motm-winners-table.sql`](db/migrations/011-motm-winners-table.sql). Member of the Month is now fully data-driven — add/edit rows in Table Editor → `motm_winners` instead of asking me to edit the site's HTML.

- **This month's winner**: add a row with **is_current** = `true`. Fields: **full_name**, **course**, **year_of_study**, **month_label** (e.g. "September 2026"), **photo_url** (optional — a public image URL; leave blank for the placeholder silhouette), **quote** (optional), **bio**, **tags** (optional, e.g. `{Community,Leadership,Impact}`). Only ever have one row marked `is_current`.
- **Past honourees**: add rows with **is_current** = `false` — these show in the "Past Honourees" archive carousel automatically, newest first (controlled by **sort_order**).
- **is_active**: set `false` on any row to pull it from the site without deleting it.

If there's no current-winner row yet, both `motm.html` and the homepage teaser show a graceful "To be announced / coming soon" state instead of anything looking unfinished — no need to add a placeholder row just to avoid that.

Nominating is a LACMS member exclusive — MMG-only guest accounts now see a locked message instead of the form, enforced at the database level (not just hidden in the UI), so it can't be bypassed via a direct API call either.

## 15. Opportunities — public preview, gated, one source of truth

Run [`db/migrations/012-opportunities-public-and-seed.sql`](db/migrations/012-opportunities-public-and-seed.sql). This adds a **category** column to `member_opportunities`, opens it up to public (anon) read, and seeds it with the same 5 example opportunities that used to be hardcoded on `opportunities.html`.

`opportunities.html` and member-perks.html's "Members-first opportunities" section now both read from this **same table** — there's only one place to manage opportunities going forward: Table Editor → `member_opportunities` (title, description, category, link, sort_order, is_active).

On the public `opportunities.html` page specifically:
- **Signed-out visitors** see the first 2 (`OPPORTUNITIES_PREVIEW_COUNT` in `js/members.js`), with the rest rendered behind a blurred gradient and a "Sign in to see more" card.
- **Signed-in LACMS members** see the full list, no gate.
- **MMG-only guests** are treated the same as signed-out visitors here — this is a LACMS member benefit specifically, not an MMG one.

The RLS policy on `member_opportunities` allows public read now (previously `authenticated` only) — this is a deliberate choice: these are recruitment postings, not sensitive data, so the "members only" framing is about encouraging sign-up, not real data protection. The gating itself happens in `js/members.js`, not the database.

## 16. Discount/perk codes — reveal instead of shown outright

Discount codes (LACMS `discounts` and MMG `mmg_perks` alike) are now hidden behind a "Reveal code" button rather than shown in plain text — blurred until clicked, then a "Copy" button appears next to it. No setup needed; this is purely front-end (`renderCodeReveal()` in `js/members.js`, shared by both discount card renderers) and works automatically for any row that has a **code** filled in.

## 17. Gallery submissions

Run [`db/migrations/013-gallery-submissions-and-news.sql`](db/migrations/013-gallery-submissions-and-news.sql) (also covers News below). LACMS members can now submit photos/videos on `gallery.html` for the committee to review — same pattern as the MMG media uploads, into a private `gallery-submissions` bucket, one folder per member.

To review submissions: Supabase Dashboard → Storage → `gallery-submissions`, browse by folder. Approved photos/videos don't go live automatically — copy them into `Media/ACMS Gallery/` and add the filename to the `FILES` array near the top of `gallery.html`'s inline script, same as any other gallery photo.

## 18. LACMS News — a real feed, editable from Table Editor

Same migration as above creates `news_posts`, `news_likes`, and `news_comments`, and seeds three placeholder posts so [news.html](news.html) isn't empty on first load — edit or delete them from Table Editor whenever you're ready.

**Posting news** — add rows in Table Editor → `news_posts`:
- **title** / **body** — the post itself. `body` supports line breaks.
- **image_url** — optional, a public image URL shown at the top of the post.
- **pinned** — keeps a post at the top with a highlighted gold background, above everything else regardless of date.
- **published_at** — defaults to now(); change it to backdate or schedule how a post's date reads.
- **is_active** — set `false` to pull a post without deleting it.
- **like_count** / **comment_count** — don't edit these by hand, they're kept in sync automatically by triggers whenever someone likes or comments.

**Who sees what**: the news feed itself (posts, and their like/comment counts) is fully public — anyone can browse `news.html`, signed in or not. Liking and commenting are LACMS-member exclusives (not available to MMG-only guests): a guest sees a "Log in as a LACMS member" prompt in place of the comment box, and clicking Like sends them to the login chooser. This is enforced by RLS, not just hidden in the UI — individual like/comment rows are never readable by anyone except the member who made them (and the committee, via the dashboard), only the aggregate counts on `news_posts` are public.

To moderate a comment: Table Editor → `news_comments`, delete the row — `comment_count` on the parent post updates automatically via the same trigger.

## 19. The LACMS Network — a member directory

Run [`db/migrations/014-network-directory.sql`](db/migrations/014-network-directory.sql). This builds [member-network.html](member-network.html), reachable from the members hub ("View the Network" / the pink "Meet the LACMS Network" card) — a directory of every active LACMS member, grouped by course then year, plus a separate section for the external healthcare professionals supporting Sankofa mentorship.

**Members are added automatically** — anyone with `membership_status = 'active'` in the `members` table shows up in the Network the next time it loads, grouped under their **course** and **year_of_study**, with committee members carrying a role badge (from **committee_role**/**member_type**). There's nothing to add by hand for this part; it's the same table you already manage from every other feature.

Because the `members` table's RLS only ever allowed a member to read their own row (by design — it holds email and membership number), the directory reads through a new `get_network_members()` function instead of the table directly. It's `security definer` so it can see every row internally, but it re-checks the caller is themselves an active LACMS member before returning anything, and only ever returns the safe subset of columns a directory card needs (name, course, year, role, LinkedIn, bio) — email and membership number are never exposed to other members.

**LinkedIn and bio are self-service** — from the members hub, "Edit network profile" opens a small form (LinkedIn URL, a 280-character bio) that saves into a new `member_profiles` table, kept deliberately separate from `members` itself so a member editing their own profile can never touch committee-controlled fields like membership status. Both fields are optional; leaving them blank just means a plainer card with no LinkedIn button and no bio in the profile modal.

**Professionals** (senior doctors/consultants, alumni doctors, pharmacists, and others supporting Sankofa) aren't LACMS members and don't fill in their own profile — add them in Table Editor → `network_professionals`: **full_name**, **title** (e.g. "Consultant Cardiologist"), **organisation** (optional), **category** (`senior_doctor` / `alumni_doctor` / `pharmacist` / `other` — controls which label they carry), **bio**, **linkedin_url**, **photo_url** (optional — leave blank for the initials avatar), **is_active**, **sort_order**. They render in their own section below the member courses, visible to LACMS members and to signed-in professionals alike. See [Section 20](#20-professional-accounts-hub-access-for-doctors-and-pharmacists) for how they actually get an account and hub access.

The directory has a live search box (filters by name/course/role as you type) and every card opens a modal with the fuller bio and a styled LinkedIn button when one's set.

## 20. Professional accounts — hub access for doctors and pharmacists

Run [`db/migrations/015-professional-accounts.sql`](db/migrations/015-professional-accounts.sql) (needs migration 014 already applied). This is what turns a `network_professionals` row into a real account with members-hub access, automatically, the first time they log in — no manual UUID-pasting needed.

**To invite a professional:**
1. Add their row in Table Editor → `network_professionals` as before ([Section 19](#19-the-lacms-network--a-member-directory)), but now also fill in **email** — this has to match exactly the address you invite them with in step 2.
2. Supabase Dashboard → Authentication → Users → **Invite user**, using that same email. They'll get the branded invite email (same template as members) and set their own password.
3. That's it. The moment they finish setting their password, they land on `member-hub.html`, which automatically links their new account to the `network_professionals` row by matching the email — no further setup from you.

If you have professionals already in the table from before this migration, add their email addresses now (Table Editor) so they can be claimed the next time each of them logs in.

**What a professional account can access**: the Network (browsing members and other professionals), Discounts & members-first opportunities, and Member of the Month nominations — same as a full LACMS member. **What it can't**: applying for a Sankofa Circle — the hub shows a "Coming soon" card in that spot instead, since a dedicated Sankofa platform for professionals (seeing who's in their circle, etc.) is planned as a separate future build, not part of this feature.

Under the hood, this works through two new functions: `claim_professional_profile()` links the account (`security definer`, since before claiming they have no RLS access to their own row yet), and `is_professional()` is the same shape as `is_lacms_member()` — used by the Network directory and MoTM nomination policies to grant professionals the same access as members without duplicating logic. Discounts and opportunities needed no database changes — both were already open to any authenticated user or the public respectively; the gating there is purely about which UI a signed-in professional sees.

## 21. Adding a member before they've signed up

Run [`db/migrations/016-pending-members.sql`](db/migrations/016-pending-members.sql). This is what [Section 5](#5-add-your-first-member)'s original two-step process couldn't do: `members.id` is a person's Supabase Auth UUID, which only exists once they've actually signed up — trying to add their profile first hits `null value in column "id" ... violates not-null constraint`, since there's no UUID yet to put there.

**To pre-add someone:**
1. Table Editor → **pending_members** → Insert row. Same fields as `members` — **email** (this has to match exactly what you invite them with next), **full_name**, **course**, **year_of_study**, **member_type**, **committee_role**, **sankofa_eligible**, **mmg_attendee**, **mmg_committee** — just no `id` or `membership_number`, since those don't exist yet.
2. Whenever you're ready, invite them: Authentication → Users → **Invite user**, using that same email.
3. Done. The moment they set their password and land on the members hub, their `pending_members` row is automatically turned into a real `members` row (membership number generated as normal) and removed from `pending_members` — no manual UUID-pasting needed.

The original process from Section 5 (invite first, copy the UUID, add the `members` row yourself) still works exactly as before if you prefer it — this is an alternative for when you want someone's profile ready and waiting before they've had a chance to sign up, not a replacement. Nobody can read or write `pending_members` directly, from the site or via the API — not even a signed-in member — it's only ever touched from Table Editor and by the `security definer` `claim_member_profile()` function.

## 22. Pending members in the Network, and card styling

Run [`db/migrations/017-pending-members-network-visibility.sql`](db/migrations/017-pending-members-network-visibility.sql) (needs migration 016 already applied). Someone you've pre-added in `pending_members` ([Section 21](#21-adding-a-member-before-theyve-signed-up)) now shows up in the Network too, grouped under their course/year like everyone else, with a muted, dashed "Pending" card instead of a normal one — so other members can see they're on their way in, without it looking like a confirmed profile.

**To hide a pending person from the Network** (but keep them pending — they'll still be claimed normally once they sign up): Table Editor → `pending_members` → set **visible_in_network** to `false` on their row.

**Network card styling**, tightened up in the same pass:
- The role/category badge on every Network card now sits at a fixed position at the bottom, regardless of how many lines the name or title above it wraps to.
- Committee and Supporting Committee cards are always gold with a slow pulsing glow — the colour now fills the whole card, not just the left edge — regardless of which course accent colour their section landed on.
- Professional cards are always green, also filling the whole card. Same "special" treatment as committee, different colour, no glow — so the two read as distinct at a glance.
- Regular member cards are unchanged: a plain card with the course section's accent colour on the left edge only.

## 23. Perks, Sankofa applications and MoTM nominations — committee-only for now

No migration needed — this is a front-end change only. Discounts & members-first opportunities, Sankofa Circle applications, and Member of the Month nominations aren't actually live yet, so — until you're ready to launch each one — only committee members (Executive or Supporting Committee **member_type**) see the real card and page; everyone else (regular members and professionals) sees a visually locked "Coming soon" card on the hub, and a matching locked message if they go to the page directly (`member-perks.html`, `member-sankofa.html`, `motm.html#nominate`).

This is entirely driven by `member_type` — there's no separate switch to flip. **To launch one of these features for everyone**, that's a code change (removing the committee check in `js/members.js` — search for `checkIsCommittee`), not a Table Editor setting; ask me when you're ready and I'll flip it.

The homepage's "Discounts & Opportunities" card follows the same rule — it only unlocks to link to `member-perks.html` for committee members, staying on the locked default (pointing at `member-login.html`) for everyone else, since there's no point linking anywhere that just shows "Coming soon".

## 24. Fix: professionals couldn't save a Network bio

Run [`db/migrations/018-professional-network-profile-fix.sql`](db/migrations/018-professional-network-profile-fix.sql) (needs migration 015 already applied). A professional saving their LinkedIn/bio from "Edit network profile" on the members hub hit `new row violates row-level security policy for table "member_profiles"` — the insert policy from Section 19 only ever checked `is_lacms_member()`, so a professional (who isn't a LACMS member) could never create their first row there. This adds the same `is_professional()` check used everywhere else a professional needs member-equivalent access.

## 25. Fix: a professional's saved bio didn't show on their own Network card

Run [`db/migrations/019-professional-bio-linkedin.sql`](db/migrations/019-professional-bio-linkedin.sql) (needs migration 015 already applied). Fixing Section 24 let a professional save without an error, but the bio still didn't appear on their card — "Edit network profile" always wrote to `member_profiles`, which only the LACMS-member side of the directory reads. A professional's own card comes from their `network_professionals` row instead, which has its own separate `bio`/`linkedin_url` columns.

The form now saves to the right place automatically depending on who's signed in — no Table Editor changes needed, and nothing to configure. Under the hood, a professional's save goes through a new `update_professional_profile()` function rather than a direct table update, so they can only ever touch their own bio and LinkedIn — not their committee-set title, category or active status, which live in the same table.

## 26. "Just joined the Network" activity feed

Run [`db/migrations/020-network-join-notifications.sql`](db/migrations/020-network-join-notifications.sql) (needs migration 015 already applied). No setup after that — it's fully automatic.

**How it works**: a database trigger fires every time a new row lands in `members` — whether that's you adding someone the normal way, or a `pending_members` row getting claimed automatically on someone's first login ([Section 21](#21-adding-a-member-before-theyve-signed-up)). Either way, it logs a `network_join_events` row (name, course, year, captured at that moment — so the feed still reads correctly even if that member's details change later, or they eventually leave).

**Where it shows up**:
- **member-hub.html** — pinned permanently at the very top of the page, above even the membership card, so it's the first thing anyone sees after logging in. A small one-line banner ("Kwame Asante and 2 others just joined the Network") whenever someone's joined in the last 14 days. It disappears on its own once there's been no activity for a while, rather than sitting there claiming to be "recent" forever.
- **member-network.html** — a compact single-line ticker near the top of the directory itself, showing one join at a time, auto-advancing every 6 seconds through up to the 12 most recent, with prev/next arrows, a "3 / 12" counter, and swipe support on mobile. Hovering or focusing it pauses the auto-advance; it respects reduced-motion settings too. This is deliberately compact (one fixed-height row) so it never grows the page, however much has happened since someone last visited.
- Click **View all** on the ticker to open the complete, permanent history — every join ever logged, oldest included, in a scrollable list ("5 hours ago", "5 days ago", "4 months ago" and so on). Nothing here is ever pruned or limited to a recent window.

**To hide a specific announcement** (without deleting the join record itself): Table Editor → `network_join_events` → set **is_visible** to `false` on that row.

**Existing members show up too** — run [`db/migrations/021-backfill-network-join-events.sql`](db/migrations/021-backfill-network-join-events.sql) once, straight after 020. The trigger only logs members added from that point on; this one-off backfill adds a join event for everyone already in `members`, using their real join date (`members.created_at`) so the history and relative times ("5 days ago") are accurate for people who joined long before this feature existed, not just "just now". Safe to run more than once if you're ever unsure whether it's been done.

**Professionals show up too** — run [`db/migrations/022-professional-join-events.sql`](db/migrations/022-professional-join-events.sql) (needs 020 already applied). Same idea as members: a trigger logs a join event the moment you add someone to `network_professionals`, and existing professionals are backfilled using their own `created_at`. Nothing else to configure — the hub banner and the Network ticker both already read from the same table, so professionals just start appearing in both.

**On the Network page, the ticker colours each slide to match that person's real card** — a member's course accent (whatever colour that course's section currently has, e.g. gold for Medicine), a fixed green for a professional (same as the Professionals section), and committee's gold pulsing glow overriding either. This is computed from the live directory as it renders, so if a course's colour ever shifts (new courses appearing/disappearing changes the cycle), the ticker always matches what's actually on the page below it rather than drifting out of sync.

## 27. MMG ticket countdown

No migration needed — this is a front-end change only. The "Get your ticket" button on `mmg.html` is now a live countdown to **12 October 2026** (when tickets actually go on sale), ticking down in days/hours/minutes/seconds. Once that date passes, it automatically swaps to "Tickets are live — check back for the link!" — update `mmg.html` with the real ticket link at that point (search for `ticket-countdown-live` in `css/styles.css` if you want to restyle that moment, or ask me and I'll wire up the real button then). To change the release date, edit the date in `js/main.js` — search for `ticketTarget`.

## 28. Announcement bylines — say who a post is from

Run [`db/migrations/023-announcement-posted-by.sql`](db/migrations/023-announcement-posted-by.sql). Adds an optional **posted_by** field to `announcements` (Table Editor) — e.g. "Nevin Boakye, President" or "LACMS Committee" — shown as a small byline under the post on the members hub feed. Leave it blank on any post and no byline shows, so nothing changes for existing announcements until you fill it in.

## 29. MMG update bylines too

Run [`db/migrations/024-mmg-update-posted-by.sql`](db/migrations/024-mmg-update-posted-by.sql). Same **posted_by** field as Section 28, added to both `mmg_updates` (the committee-only planning feed) and `mmg_attendee_updates` (the general feed all attendees see) — add it in Table Editor on either table, same as announcements. Both feeds share one render function, so this covers every place they show up (`mmg.html`, `mmg-hub.html`, and the MMG sections on `member-hub.html`) in one go.

## 30. President's activity dashboard

Run [`db/migrations/025-president-dashboard.sql`](db/migrations/025-president-dashboard.sql) (needs migrations 009, 015, 016 already applied). A private, president-only page — `president-dashboard.html` — showing every account on the site (LACMS members, professionals, pending invites, and MMG/partner-university guests): who's finished setting up, when they last logged in, and who's on the site right now.

**Who can see it**: exactly one Supabase Auth account, hardcoded by its user ID in `is_president()` (SQL) and `PRESIDENT_UID` (`js/members.js`) — not a role like `committee_role = 'President'`, so it never accidentally follows a Table Editor edit. The dashboard card only appears on the members hub for that one account, and even if someone guessed the page's URL directly, every `president_get_*` function it calls independently checks `is_president()` on the database side and refuses anyone else — the page-level check is just a UX shortcut, not the actual security boundary. **If the presidency ever changes hands**, update the UUID in both of those places (ask me and I'll do it) — Authentication → Users in the Supabase dashboard is where you find the new account's ID.

**How "fully set up" is tracked**: a new `activated_at` column on `members`, `network_professionals` and `mmg_guests`, set automatically — for members/professionals, the moment they finish `updateUser({password})` on the invite flow; for MMG guests, the moment their self-signup completes (there's no separate password step for them). This is deliberately not inferred from Supabase's own `last_sign_in_at`, since that timestamp gets set the moment an invite link is opened — before a password is ever chosen — which is exactly the bug from earlier this session. The dashboard actually surfaces that distinction: anyone who has a login recorded but never finished setup shows as **"Invite opened, not finished"** rather than being lumped in with people who never opened their invite at all.

**How "online now" is tracked**: a lightweight heartbeat, not a live connection — `js/members.js` upserts a timestamp to a new `member_presence` table every 30 seconds for whoever's signed in, on any page, regardless of account type. The dashboard treats anyone seen in the last 5 minutes as online, which at a 30-second beat is a wide safety margin — ten missed beats' worth — before someone actually using the site would ever wrongly drop out of "online". The dashboard page itself also re-beats its own presence every time it loads or refreshes (not just relying on the site-wide heartbeat's own independent timing), so the person actually looking at the dashboard can never see themselves show as offline. It also auto-refreshes every 45 seconds (only while the tab is actually visible) so this stays current without manual reloading.

**Layout**: a prominent green "Online right now" panel right at the top — the first thing on the page — then a stats row, then **LACMS Members and Professionals together in one activity feed**, most-recently-active first, not segregated by account type or grouped by course/year — whoever's using the site right now rises straight to the top regardless of whether they're a student or a supporting professional. "Needs a nudge" (invited but not yet set up, including still-pending invites from `pending_members`) comes after that, and MMG/partner-university guests are last, still grouped by access level (Committee / Attendee / Pending review) since that's a meaningful tier, not an academic grouping. Each member's avatar still carries their course's colour from the Network page (Medicine gold, then green/red/purple as further courses appear) purely as a visual identifier, independent of the sort order; a professional keeps the fixed Network green.

**One-click correction**: whether someone genuinely finished setup can't always be told apart from "only ever opened the invite" using the data Supabase exposes — both look identical from the outside (see [Section 33](#33-fix-false-logged-in-status-and-a-manual-override-for-the-ones-auto-detection-cant-tell) below). Any row that isn't yet marked as set up shows a **"Mark active"** button — use it once you have direct confirmation from that person (starting with yourself) rather than guessing.

No Table Editor setup needed beyond running the migrations — everything else is automatic.

## 31. Fix: dashboard failed to load with a "structure of query" error

Run [`db/migrations/026-president-dashboard-email-type-fix.sql`](db/migrations/026-president-dashboard-email-type-fix.sql) (needs migration 025 already applied). `auth.users.email` is actually `character varying(255)` in Postgres, not `text` — the three `president_get_*` functions that join `auth.users` declared their return type as plain `text`, which Postgres rejects as a mismatch. This just adds an explicit `::text` cast; nothing else changes.

## 32. Dashboard: fixed false "online" status, added a live Online Now panel, and a redesign

No migration needed — front-end only.

**Fixed**: someone who's only ever clicked an invite link (but never finished choosing a password) already has a live Supabase session — that was enough for the site-wide presence heartbeat to record them, making them wrongly appear "online" on the dashboard even though they can't actually sign back in. "Online" now also requires `activated_at` to be set, so someone stuck mid-invite correctly shows **"Invite opened, not finished"** instead.

**New — "Online right now"**: a dedicated, glowing green panel pinned at the very top of the page, above the stat tiles — a pulsing dot, a live count, and a chip per person actually online. It's the one thing on the page designed to be seen at a glance rather than read.

**New — search**: one search box filters every section at once (online panel, needs-a-nudge, members, professionals, MMG guests), collapsing any course/year group left with nothing visible inside it.

**New — live "Updated Xs ago" + manual refresh**: the existing 45-second auto-refresh now has a visible ticking label and a refresh button, so it's obvious the data is current without needing to guess.

**New — colour-coded by account type**: member/professional/MMG guest avatars now use the same gold/green/purple language as the Network page, so account type reads at a glance across every roster row.

## 33. Fix: false "logged in" status, and a manual override for the ones auto-detection can't tell

Run [`db/migrations/027-fix-false-activation-and-manual-override.sql`](db/migrations/027-fix-false-activation-and-manual-override.sql) (needs migration 025 already applied).

**The bug**: migration 025's one-off backfill marked anyone with *any* `last_sign_in_at` as fully activated — but `last_sign_in_at` gets set the instant an invite link is opened, before a password is ever chosen. That backfill accidentally credited "opened the invite" as "finished setting up", which is exactly backwards — it's why committee members who told you directly they couldn't log in were still showing as active.

**The honest limit**: there's no way to tell "opened it and got stuck" apart from "opened it and finished" from `auth.users` alone — both look identical. Rather than guess again with a cleverer heuristic that could just as easily be wrong the other way, this migration **reverts** the incorrect backfill (only the rows it actually touched — anyone activated for real, through the normal password-set flow, is untouched) and adds a **manual override** instead.

**"Mark active" button**: every roster row that isn't yet activated now has a small "Mark active" button — one click, no Table Editor needed. Use it for anyone you have direct confirmation from (starting with your own account, and anyone like Roberta who's told you it worked). Going forward, every *new* invite is still tracked automatically and correctly — this override is only for the accounts affected by the old backfill.

**Also fixes "I'm on the dashboard right now but it doesn't say I'm online"**: the page now explicitly refreshes your own presence and waits for it to land before its first data fetch, closing a timing gap where the dashboard could momentarily read your presence before that page-load's own heartbeat had finished writing.

## 34. Fix: "Active just now" not counted in the online number, tighter presence, sort by activity

No migration needed — front-end only.

**The bug**: the "Active · X ago" label and the online/count logic were reading two different signals. The label fell back to `last_sign_in_at` when there was no heartbeat yet, so it could show "Active · Just now" from a fresh login — while the online check only ever looked at the heartbeat (`last_seen_at`), missed that same fresh login, and didn't count them. Both now read from one shared function, so the label and the count can never disagree again.

**Tighter presence, still just a heartbeat, not a live socket**: the site-wide beat interval dropped from 2 minutes to 30 seconds, giving the 5-minute online window ten missed beats of headroom instead of two. The dashboard also re-beats its own presence on *every* load and refresh now, not just the first one — so however long you leave the tab open, your own row can't go stale.

**"Active" is now green**, not a neutral grey pill, so a genuinely-active person stands out from someone who's merely been invited.

**Members, Professionals and each MMG tier are now sorted by most-recently-active first** — course/year grouping is gone from the Members section entirely. Each member's avatar still carries their course's Network colour (computed fresh each load, so it can never drift out of sync with the actual Network page), it's just no longer used to group rows into sections.

**Also fixed**: a long course + year detail line (e.g. "Medicine BMBS BMedSci · Year Three") could overflow past its column and visually collide with the status pill next to it — the wrapping element was missing `min-width: 0`, the usual cause of an ellipsis rule not actually kicking in inside a flex/grid layout.

## 35. Dashboard card moved first; Members and Professionals merged into one feed

No migration needed — front-end only.

**Hub card order**: the "Platform Activity Dashboard" card is now the first card in the members hub's quick-links grid, ahead of "Meet the LACMS Network".

**Members and Professionals are no longer two separate sections** — they're one combined, most-recently-active-first roster, exactly as described in [Section 30](#30-presidents-activity-dashboard)'s updated layout above. "Needs a nudge" moved down below it, so the top of the page leads with who's actually active rather than who still needs chasing up.

## 36. "Forgot your password?" on every login

No migration needed — front-end only. Every login page now has a working password reset, covering every account type:

- **`member-login.html`** — covers LACMS members, committee, and professionals (they all share this one login form). A "Forgot your password?" link swaps in an email-only form; submitting it sends Supabase's own reset email and shows a confirmation message. The link in that email lands back on this same page with a recovery token in the URL, which the page already knew how to handle from the invite-link fix earlier — it shows the same "set a new password" form, and afterwards sends them to `member-hub.html` as normal.
- **`mmg-login.html`** — same "Forgot your password?" link and flow for MMG/partner-university guest accounts, sending them to `mmg-hub.html` afterwards instead. This page didn't have *any* password-reset handling before — self-registered guests choose their password once at signup and had no way back in if they forgot it. It's genuinely new here, not just extended: a `mmg-set-password-form` was added, and the recovery-link detection had to be built from scratch (reusing the exact same pattern as `member-login.html`).

**A real bug caught and fixed while building this**: `mmg-login.html`'s "already signed in? skip straight to the hub" check didn't know about recovery links, and a password-reset link *also* establishes a live session immediately, the same as an invite link does. Without the fix, clicking a reset link would have bounced a guest straight to `mmg-hub.html` before they ever got to actually type a new password. The check now excludes the recovery-flow case, matching how `member-login.html` already handled it correctly.

To customise the reset email's wording/branding, see [Section 9](#9-branded-auth-emails) — the same `email-templates/` folder covers this one too (`reset-password.html`), it just hasn't been applied yet since this flow wasn't in use until now. Apply it the same way as `invite.html`: Authentication → Emails → Templates → the matching template → paste in.

## 37. Join history no longer shows the same person twice

No migration needed — front-end only.

If someone's account ever gets recreated (most commonly: they were stuck on a broken invite, you deleted the old auth user and added them fresh) their old and new `network_join_events` rows both stayed in the database — which meant the join history, the Network ticker, and the "X and N others just joined" hub banner could all show the same person's name twice, once for each account.

They're now deduped by name (case/whitespace-insensitive) everywhere `network_join_events` is read, always keeping the most recent event and discarding the older one — nothing to configure, and nothing changes for anyone who's only ever had one account.

## 38. Site-wide "Back" button, and a fix for overlapping text on mobile Network cards

No migration needed — front-end only.

**Back button**: every page now has a "Back" button at the top of the main content, styled the same on desktop and mobile. It prefers real browser history — but only when the visit actually came from somewhere else on the site — so it takes you to wherever you were before, one step back, the way a normal back button should. If there's nothing to go back to (someone opened the page directly — a bookmark, a shared link, a fresh tab), it sends them to the homepage instead of leaving them on a dead click or bouncing them off the site entirely.

**Network cards overlapping on mobile**: a member's name and course/year line could render on top of each other on some phones. Two things were fixed: the card was missing `min-width: 0`, the same flex/grid shrink bug already fixed once on the president dashboard's roster rows earlier ([Section 34](#34-fix-active-just-now-not-counted-in-the-online-number-tighter-presence-sort-by-activity)) — without it, a grid item won't shrink below its content's natural width, so long text can spill into the row below it. The card's meta line also had a small negative top margin (`margin-top: -6px`) pulling it closer to the name above — a fragile trick that depends on exact font-rendering metrics being the same across browsers, which they aren't always on mobile. That negative margin is gone; spacing between the name and meta line now comes from the card's normal `gap` instead.

To insert Back on any *new* page going forward, add this as the first thing inside `<main id="main">`:

```html
<div class="container back-nav">
  <button type="button" class="back-button" data-back-button>
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    Back
  </button>
</div>
```

No extra JS needed — `js/main.js` already wires up every `[data-back-button]` on the page.

## 39. Homepage back button removed; the *real* mobile Network glitch found; forgot-password auto-login race fixed; link/image fields hardened against script URLs

No migration needed — front-end only.

**No Back button on the homepage.** There's nowhere sensible for "back" to go from the homepage itself, so it's the one page without one.

**The actual mobile Network glitch, found from a real screenshot**: Section 38's Network-card fix was a reasonable defensive change, but it turned out not to be what you were actually seeing — a screenshot showed the real culprit is the "X just joined the Network" ticker at the top of the Network page, not the member cards below it. On a narrow screen its name text wraps onto several lines, but the prev/next arrow buttons and the "2 / 12" counter stayed vertically centred against the *whole* ticker row — so as the text grew taller, those controls drifted down into the middle of it, landing visually on top of the wrapped text. Fixed by giving the prev/next/counter/"View all" controls their own row underneath the text on mobile, instead of trying to keep everything on one line.

**Forgot-password could skip straight past the "choose a new password" step.** Confirmed real: Supabase's client library auto-detects the reset link's token in the URL and can silently establish a live session *and clean the token out of the URL* before the page's own check for "is this a password reset?" ever gets to look at it — a race, not something that failed every time, which is why it wasn't consistent. When it lost that race, the page saw an already-signed-in session with nothing marking it as a reset, and took the visitor straight to the hub without ever asking for a new password. Fixed by also listening for Supabase's own `PASSWORD_RECOVERY` event, which fires reliably regardless of that timing — it now has the final say over the URL check, so a reset link always lands on the set-password form.

**Security pass**: went through every place a database field is written into the page as a link or image (`href`/`src`) and confirmed one real gap — a member's own LinkedIn URL (self-edited from their hub, unlike most other link fields on the site which only committee can set) was inserted with no check on its scheme. Anyone could have set it to a `javascript:` URL, which would then run in *any other member's* browser the moment they clicked "View LinkedIn" on that profile. A shared `safeUrl()` helper now sits in front of every such field site-wide (LinkedIn links, discount/opportunity/perk links, MoTM and profile photos, news images) — only `http(s)`, `mailto:` and `tel:` links are ever rendered; anything else is silently dropped. Everything else checked (announcements, news posts, comments, feed items, roster names) was already going through the existing `escapeHtml()` and had no issue.

## 40. The ticker fix above still wasn't it — here's the actual cause

No migration needed — front-end only.

Section 39's ticker fix (giving the controls their own row) was a real improvement but a second screenshot showed the overlap was still happening — it was never the controls colliding with the text at all. The title (`network-ticker-item-title`) and the meta line (`network-ticker-item-meta`) are flex siblings inside `.network-ticker-item`, aligned with `align-items: baseline`. That's fine as long as both stay on one line each — but once the title starts wrapping to two or three lines on a narrow screen, a wrapped flex item's baseline is measured from its *first* line only. The meta line (which was still `white-space: nowrap`) was being positioned relative to that first line, not below the title's full wrapped height — so it rendered on top of the title's second/third line instead of underneath it.

On mobile, `.network-ticker-item`'s children now stack as plain blocks (`display: block`) instead of staying flex siblings, and the meta line wraps too — removing the baseline calculation from the picture entirely rather than trying to out-clever it. Verified against a self-contained reproduction with both a short name and a deliberately very long name + course string, at 375px width, confirming no overlap either way.

## 41. Ticker: time now on its own line under the name

No migration needed — front-end only.

The "X just joined the Network" ticker used to run everything together on one line under the name — course, year and "X ago" all joined with `·`. It's now three lines: the name, then just the time (e.g. "5 hours ago") directly underneath, then the course/year (or, for a professional, their title) below that. This also made the earlier flex/baseline layout unnecessary — `.network-ticker-item` is a simple top-to-bottom column now on every screen size, not just mobile, so there's one layout to reason about instead of a desktop one and a mobile override.

## 42. Site-wide scroll motion — reveal-on-scroll, header shrink, hero parallax, back-to-top

No migration needed — front-end only. This is the biggest visual change of the whole project so far: the site no longer just sits there fully rendered the moment a page loads — cards, rows and sections now fade and lift into place as they scroll into view, the same way most modern sites feel.

**How it decides what animates** — `js/main.js` auto-detects the site's own existing card/row/list classes (`.card`, `.network-card`, `.feed-item`, `.opp-row`, `.impact-card`, `.roster-row`, `.programme-card`, `.mmg-timeline-item`, section headers, and more) rather than requiring every page's HTML to be hand-annotated one element at a time. A single shared `MutationObserver` also catches anything `js/members.js` renders later from Supabase — network cards, feed posts, roster rows, ticker items, search results — so content that only exists after a database fetch animates in correctly too, not just what was already in the page's HTML at load.

**What it actually does, page-wide:**
- **Reveal-on-scroll** — each element fades up into place the first time it crosses into view, with a small stagger between siblings in the same grid/list so a row of cards cascades in rather than popping all at once.
- **Header shrink** — the site header tightens up (less padding, a stronger background, a subtle shadow) once you've scrolled a short way down, and relaxes back at the top.
- **Hero parallax** — the homepage's hero image drifts at a slightly different speed than the page scrolls, a classic depth effect, done with a translate that's recalculated every frame rather than a CSS transition (transitions lag behind fast scrolling; this doesn't).
- **Scroll-progress bar** — a slim gold-to-green line pinned to the very top of the viewport, tracking how far down the current page you are.
- **Back-to-top button** — appears bottom-right once you've scrolled far enough that "back to top" is actually useful, gone again near the top.
- **Count-up numbers** — the homepage's "Our Impact" stats (and the president dashboard's stat tiles) count up from 0 the first time they scroll into view instead of just appearing as static text.

**Reduced motion is a hard opt-out, not "less motion".** Every single piece above checks `prefers-reduced-motion: reduce` and, for anyone with that set, skips straight to the finished state — content is immediately visible, the header doesn't animate its transition, parallax doesn't run. Nothing auto-plays or moves for a reduced-motion visitor.

**A few components already had their own hand-built entrance animation** (the Opportunities list, the members' feed, news posts, programme cards, the MMG programme timeline, and the join/MMG hero's "why it exists" list) — these played once on page load or on render, regardless of whether the element was ever actually scrolled into view, which is a different thing from what was asked for here. They're now unified onto the same scroll-triggered system as everything else, so the whole site behaves consistently instead of two different animation approaches existing side by side. Two exceptions were deliberately left untouched: the MMG "signed in" welcome strip and the digital membership/attendee card, both of which are single, always-above-the-fold elements where a scroll-trigger would never actually get a chance to differ from "just show it" — they keep their simple page-load fade.

## 43. Fix: reveal-on-scroll triggered too late, especially on mobile

No migration needed — front-end only.

Section 42's reveal system waited until an element was well into the viewport before fading it in (shrinking the trigger zone inward by 8%, requiring 12% of the element visible) — the intent was to avoid triggering the instant something barely peeked in, but in practice it meant scrolling noticeably further than expected before the next thing appeared, worse on short mobile screens where that margin ate a larger share of the visible area. It now pre-triggers while an element is still up to 15% of a screen's height *below* the visible area, so by the time it's actually scrolled into view it's already animating in (or finished). Measured directly: an element that previously needed to be well inside the viewport now starts revealing while still ~55px below the fold on a mobile-sized screen. The fade itself is also quicker (0.5s, was 0.7s) and the stagger between cards in the same grid is tighter (up to 0.225s total, was 0.42s).

## 44. Member hub experience — personalized greeting, a real digital card, loading skeleton, "New" badges

No migration needed — front-end only. A pass specifically over the member experience — the hub primarily, plus a couple of things that reach the rest of the site — looking for the kind of polish a generic "add motion" pass wouldn't have covered on its own.

**Time-of-day greeting.** "Welcome back" is now "Good morning" / "Good afternoon" / "Good evening" / "Good night" depending on when you actually land on the members hub or the MMG hub — a small, cheap thing that stops the page feeling like the exact same static header every single visit.

**The digital membership/attendee card now behaves like a real card.** On any device with a mouse, it tracks the cursor with a subtle 3D tilt and a light glare that follows your pointer across it — the kind of interaction that makes a "digital card" actually feel like a physical credential catching the light, rather than a static rectangle with your name on it. It's on top of the card's existing ambient shimmer, which is what touch-device visitors still see (there's no cursor to track on a phone) — nothing was taken away, this is additive. Respects reduced motion, and only activates on devices that report a real mouse (`hover: hover` + `pointer: fine`), so it never fights with touch scrolling.

**A shaped loading skeleton, not just a spinner.** The members hub's "Checking your login…" spinner is now a shimmering placeholder shaped like the actual card-plus-details layout it's about to become — the same trick LinkedIn, Facebook and most polished apps use so the page doesn't look broken or empty for the second or so it takes to hear back from Supabase, and so there's no layout jump when the real content swaps in (the skeleton is already the right shape).

**"New" badges.** Anything posted in the last 48 hours — an announcement, a news post, an MMG update — now carries a small pulsing "New" badge next to its category tag. Checking back in after a few days now visibly rewards you with something that stands out, instead of every post in the feed looking identical regardless of age.

**Press feedback on interactive cards and buttons**, site-wide — buttons, Network cards, Opportunities rows and the general `.card` link/button all now give a small tactile "press" (a slight scale-down) on click/tap, on top of the hover-lift they already had. Small, but it's the difference between a page that reacts to touch and one that just... changes eventually.

## 45. The digital membership/attendee card is now a real, fully-3D flippable card

No migration needed — front-end only. Section 44 gave the card a cursor-tracked tilt; this replaces that with the real thing — a proper two-sided 3D card you can turn all the way around, built to work identically well with a mouse or a finger.

**How it's built.** `.member-card` is now just a sizing/perspective container; the actual rotation happens on an inner "flipper" with two faces — the existing front content, and a new back showing the LACMS crest and name. All of it is built at runtime in `js/main.js` rather than hand-duplicated into every page's HTML, so the two card variants on the members hub, the one on the MMG hub, and the one on the MMG portal page all stay in sync from one place. `backface-visibility: hidden` keeps whichever face isn't showing from bleeding through.

**Discoverability was the actual brief here** — "how does anyone know this moves?" — solved three different ways, deliberately layered so no one visitor has to find all three:
- **The card wiggles on its own**, once, briefly, the first time it's actually on screen in a given browser session (timed off `IntersectionObserver`, not a blind delay, since the card doesn't exist until the member's profile has loaded) — a small unmistakable "I'm not flat" demonstration before anyone has to guess.
- **A small corner badge** sits on the card permanently — both a visible hint icon and a genuine, keyboard-reachable button. Click it, tap it, or Tab to it and press Enter: the card turns all the way to the back, holds a moment, and returns. This is also the accessible path — the wiggle and drag are lovely but neither one is reachable without a mouse or a finger.
- **Hovering it** (any device with a real cursor) gives a light cursor-tracked tilt, same as before.

**Full drag-to-rotate, mouse and touch, through one implementation.** Click-and-drag or touch-and-drag turns the card in real 3D, all the way round to the back if you keep going — built on the Pointer Events API so mouse and touch share one code path rather than two separate ones to maintain. The tricky part was making sure dragging the card on a phone doesn't hijack an ordinary attempt to scroll the page: the first several pixels of a touch gesture decide whether it's predominantly horizontal ("spin the card" — commit, and block the page from scrolling for the rest of that gesture) or predominantly vertical ("scroll the page" — hand it straight back to normal scrolling, untouched). A horizontal drag over the card behaves as expected; a vertical swipe over the card scrolls the page exactly as it would anywhere else.

**It never stays where you leave it.** However far you turn it — a slight tilt, all the way to the back, anywhere in between — releasing always springs it back to front-facing with a soft overshoot ease, never left part-turned or stuck showing the back. That was the explicit brief, and it's also just correct: the card's real information only exists on the front.

**Reduced motion** disables the idle wiggle and the ambient shimmer entirely, and drops the "springs back" animation to instant — the card can still be dragged (that's direct, user-driven motion, not something auto-playing), it just resets without an animated tween.

## 46. Fix: the back of the card showed the front through it

No migration needed — front-end only.

`overflow: hidden` on the card's front/back faces (there to keep the ambient shimmer pattern from poking out past the rounded corners) turns out to be a known WebKit/Safari bug when combined with `backface-visibility: hidden` on a 3D-rotated element — Safari can let the face that's supposed to be hidden bleed through as a ghost of whatever's behind it, which is exactly what showed up: the front's text still faintly visible while looking at the back. `overflow: hidden` is gone from the card faces now — the shimmer and glare pseudo-elements round their own corners instead (`border-radius: inherit`), since an element always clips its *own* background to its own rounding regardless of `overflow`; it's specifically clipping *children* (which a pseudo-element counts as) that needed the removed rule. Also added the `-webkit-` prefixed versions of `perspective` and `transform-style` for older Safari, belt-and-braces. Verified in this session's browser sandbox that both faces still render with clean rounded corners and the shimmer/glare stay properly contained after the fix — the sandbox itself doesn't reproduce the original bug (it's Chromium-based; this is a WebKit-specific issue), so the real confirmation is on the device that showed it.

## 47. Second pass at the Safari backface bug — the fix above wasn't complete

No migration needed — front-end only. Confirmed fixed on Chrome, but not yet confirmed on Safari itself — this environment has no way to run real Safari (no Xcode install for the iOS Simulator, and the in-session browser tooling is Chromium-based), so this pass is built entirely from documented, corroborated WebKit bug reports rather than something directly seen failing and then fixed here.

Two more concrete gaps found:

- **The front face had no `transform` of its own at all** — it only ever moved because it's a child of the flipper, which does the actual rotating. Safari has a specifically documented bug where an *untransformed* child of a `preserve-3d` element doesn't get its `backface-visibility` evaluated against the parent's real 3D rotation, and can stay visibly "facing the camera" past 90° instead of correctly hiding. Fixed by giving the front face its own explicit `transform: rotateY(0deg) translateZ(0)` — a visual no-op, purely there to force Safari to treat it as a genuine 3D participant. The back face's existing `rotateY(180deg)` got the same `translateZ(0)` addition, which forces its own compositing layer (another commonly-cited trigger for the same class of bug).
- **`transform-style: preserve-3d` was only on the flipper, not on `.member-card` (the perspective container) above it.** Documented WebKit behaviour: when the element declaring `perspective` doesn't also carry `preserve-3d`, backface-visibility can be computed against each layer's transform *without* perspective applied, giving a different (wrong) answer than what's actually rendered once perspective is factored in. Added `preserve-3d` (with the `-webkit-` prefix too) to `.member-card` itself.

Also simplified the shimmer pseudo-element's stacking — it no longer needs an explicit `z-index`, since the content it sits behind (`.member-card-inner`) already has its own `z-index: 1` and naturally paints above it; one less explicit z-index inside an already-3D, backface-hidden context, on general principle of not stacking more complexity there than necessary.

If this still isn't fully fixed once you can check it on an actual iPhone, the next thing worth trying is moving the front face's content into its own extra wrapper div rather than relying on the face element itself for both the 3D participation and the content box — a pattern a few of the WebKit bug threads mention as a last-resort fix when the above wasn't enough on their specific Safari version.

## 48. Mobile experience hardening, site-wide

No migration needed — front-end only. Most visitors are on a phone, so this is a deliberate pass looking specifically for the kind of thing that's invisible on a laptop and annoying on an iPhone.

- **Every form on the site zoomed the whole page in when you tapped into a field.** iOS Safari does this automatically for any focused input under 16px — every text field site-wide (login, join, Sankofa application, network profile, change password, comments, MMG voting, the Network search box) was sized just under that threshold. Fixed with a mobile-only override; desktop keeps its slightly smaller, more refined sizing since the zoom only ever happens on a touchscreen.
- **A few small controls were genuinely hard to tap accurately** — the Network ticker's prev/next arrows (28px), the flip card's corner badge (34px), and the site-wide Back button, all under Apple's own 44px minimum guidance for a comfortable tap. Rather than redrawing them bigger (which would change the design), each gets a purely invisible expanded hit area — the button still looks exactly as designed, but the tappable region reaches further around it. Verified directly: a tap 15px outside the ticker arrow's visible edge now registers; one 30px outside still correctly misses, so the hit area is generous but bounded, not accidentally huge.
- **The homepage carousel's edge arrows and the back-to-top button both got *smaller* specifically on mobile** — backwards, given touch accuracy matters more there, not less. Both now hold at (or grow to) 44px on small screens instead of shrinking.
- **No safe-area handling for notched iPhones.** Added `viewport-fit=cover` to every page (required before `env(safe-area-inset-*)` has any effect at all) and applied it to the back-to-top button and the mobile nav drawer's bottom padding, so neither sits flush against the home indicator.
- **A defensive `overflow-x: hidden` on `html`/`body`** — a single stray element being a few pixels too wide anywhere on the site would otherwise make the *entire page* scroll sideways, which is one of the more jarring "this feels broken" mobile bugs there is. This doesn't fix an overflow's root cause if one exists, it just stops it from taking the whole page down with it.
- **The default OS tap-flash (gray/blue highlight) is gone** — every interactive element already has its own `:hover`/`:active` treatment from earlier passes this session, so the browser's own default flash on top of that just looked like a mismatched flicker rather than useful feedback.

## 49. Fix: the flip card only rotated on hover, not on click-and-drag, on desktop

No migration needed — front-end only.

Touch-drag worked correctly. Mouse click-and-drag looked like it did nothing — hover-tilt still worked, but pressing and dragging didn't add anything beyond that. Traced (by simulating a real `pointerdown`→`pointermove`→`pointerup` sequence dispatched at the card's actual on-screen coordinates, not just called directly against the JS) to the card's logo `<img>` and its name text: browsers natively let you drag an image and select text, and a mousedown that happens to land on either of those starts the *browser's own* drag or selection instead of — or fighting with — the card's custom rotate-drag. Touch was never affected because mobile Safari/Chrome don't have an equivalent native "drag this image" gesture competing with a touch-drag the same way.

Fixed with `user-select: none` and `-webkit-user-drag: none` on the flipper (inherited down to everything inside it), `img.draggable = false` set directly in JS on every image in the card (Firefox in particular ignores the CSS property and only respects the attribute), and an explicit `preventDefault()` on the initial mouse `pointerdown` as a third layer. Re-verified the actual rotate/spring-back logic afterwards with the same simulated real-coordinate drag — still works exactly as before, this only removed the competing native behaviour.

## 50. Fix, take two: split the mouse drag onto its own plain-mouse-event path

No migration needed — front-end only. Reported still not working after §49 — hover kept working, click-and-drag on desktop still didn't. Every simulated test here (pointer events *and* plain mouse events, dispatched at the card's real on-screen coordinates, sequences run through `mousedown`→`document mousemove`→`document mouseup`) kept coming back correct, so this is logged as a real gap in what this environment can verify, not a claim that §49's diagnosis was wrong — the `user-select`/`user-drag`/`draggable` fixes from §49 are still in place and still worth having regardless.

What changed: mouse and touch used to share one Pointer Events implementation (`pointerdown`/`pointermove`/`pointerup` on the flipper, `setPointerCapture` to keep tracking once dragging). That's a modern, correct API, but it's also more moving parts than the drag actually needs on desktop, and pointer capture behaviour has had more real-world browser inconsistency historically than the plain alternative. Mouse now gets its own, much older and more battle-tested pattern instead: `mousedown` on the card starts it, `mousemove`/`mouseup` are then listened for on `document` (not the card) until release — the standard way to implement a drag that a huge fraction of the web's drag-and-drop code has used for over a decade, and one that doesn't depend on pointer capture working correctly to keep tracking once the cursor drifts off the (possibly visually thin, mid-rotation) card. Touch keeps the original Pointer Events + axis-lock implementation unchanged, since that part was confirmed working.

**Also added: cache-busting on every page's CSS/JS tags** (`?v=20260824-2` on `css/styles.css`, `js/main.js`, `js/members.js`). There was none before this — every fix all session has been served from the exact same URL, which a browser (and GitHub Pages' own caching) is entitled to keep serving from cache indefinitely. If a fix ever appears not to have taken effect again, bump this version string on all three tags before assuming the code itself is still wrong.

## 51. Programmes: real Sankofa photos, whole-card click, and a real "signed in" check on Apply

No migration needed — front-end only.

- **Real photos on the Sankofa page**, from the new `Media/Sankofa/` folder: the hero photo is now `Sankofa Circle.png` (the circle diagram), and the "mentorship journey" block further down is now `Sankofa group.png` — swapped in the order given, not necessarily matching what the old placeholder text guessed would go there.
- **The whole "Sankofa Mentorship" card on programmes.html is clickable now**, not just its "Discover more" button — via a new generic `[data-card-link]` pattern (`js/main.js`): click anywhere on a card carrying that attribute and it navigates to the URL it names, except clicks that land on one of the card's own real links, which keep working exactly as before. Reusable for any future card that needs the same treatment.
- **Fixed: "Apply to be a mentee or mentor" always sent everyone to `join.html`** — buy-a-membership — even members and professionals who were already signed in. It now checks session state (reusing the same site-wide auth check that already keeps the header's "Member login" link in sync everywhere) and sends anyone signed in, either account type, to `member-sankofa.html` — the real application — instead. Logged-out visitors still go to `join.html` as before. The application page's own existing gating (committee-only while Sankofa applications are still being trialled, everyone else sees a "coming soon" note) is unchanged and still applies once they land there.

**Study Skills & Exam Prep and Widening Access to Medicine are now "Coming soon"** — deliberately *not* using the same locked-card treatment as the member hub's not-yet-launched cards, which desaturates everything to gray. These keep their full gold/purple colour variant exactly as designed; only the tag (now a muted, dashed "Coming soon" instead of "Academic"/"Outreach") and the CTA (now a plain "Not open yet — check back soon." note instead of a working link) changed.

## 52. Sankofa: enlargeable photo, cropped group shot, "Coming soon" countdown ribbon

No migration needed — front-end only.

- **The Sankofa Circle diagram (sankofa.html's hero photo) now opens larger on click** — a new generic `[data-lightbox]` pattern in `js/main.js`: mark any `<img>` with `data-lightbox` and it opens full-size over a dimmed, blurred backdrop, closeable by clicking the backdrop, the close button, or pressing Escape. Keyboard-reachable too (Tab to it, Enter or Space to open) since it's a real interactive element, not just a click target. One shared overlay per page, built only if the page actually has an image using it — reusable anywhere else a photo deserves a closer look.
- **The Sankofa group photo was cropped too tall** — its container's height came down from 360px to a 240–340px range, so `object-fit: cover` trims more off the top and bottom instead of showing the full frame.
- **That same (cropped) group photo now also fills the Sankofa card's photo slot on programmes.html**, replacing its placeholder — previously the only card of the three still showing "add: Media/…" text.

**Locked programme cards, two more changes:**
- The empty photo placeholder tile is now hidden entirely on `.programme-card--locked` (there's no real photo yet, so a dashed "add: Media/study-skills.jpg" box wasn't helping anyone) — the card's text takes the full width instead of leaving an empty second column.
- The small dashed "Coming soon" tag was easy to scroll straight past, so each locked card now also gets a **full-bleed countdown ribbon across its top edge** — "Launching in *N* days · 30 September 2026", the same launch date as the homepage's own countdown. Pulled flush to the card's own edges with negative margins (rather than sitting inset like normal content), coloured to match each card's own gold/purple accent rather than a single generic colour. Deliberately days-only, no hours/minutes/seconds — this is someone browsing the page, not a ticket sale under time pressure, so an hourly recalculation is plenty rather than a per-second tick.

## 53. Shorter text on mobile — Sankofa card and sankofa.html

No migration needed — front-end only. Two different fixes for two different situations, since "shorten the text" and "there's nowhere else to send them" don't call for the same answer:

- **The Sankofa Mentorship card on programmes.html** has two paragraphs; the second (the more elaborative one) is now hidden below 640px via a new `.mobile-hide-text` utility class. No "read more" toggle needed here — the whole card is already a `[data-card-link]` through to the full sankofa.html page, so tapping anywhere on it *is* the "find out more."
- **sankofa.html's own "An Akan word" section** has nowhere else to send someone — it's already the full-detail page. Its second paragraph is now wrapped in a genuine expand/collapse "Read more" toggle instead (reusing the same `reveal-panel` mechanism already used for committee bios and event details elsewhere on the site), shown only below 640px — desktop keeps seeing both paragraphs immediately, exactly as before. Built as a reusable pair of classes, `.read-more-wrap` / `.read-more-btn`, for anywhere else a paragraph is worth trimming on a small screen without actually losing it.

One honest caveat: the actual expand/collapse height animation (the `grid-template-rows: 0fr → 1fr` trick, already used elsewhere on the site) couldn't be visually confirmed in this session's testing sandbox — verified there that even the pre-existing, already-in-production version of this exact mechanism renders as permanently collapsed in that specific environment, which points to a sandbox rendering limitation rather than anything broken in the CSS itself. What *was* directly verified: the button and hidden-paragraph show/hide correctly at both the mobile and desktop breakpoints. Worth a real check on an actual phone once deployed.

## 54. Sankofa card redesigned: photo behind the text, not beside it

No migration needed — front-end only. An alternative to §53's mobile text-hiding for the Sankofa Mentorship card specifically: instead of a side-by-side image/text split (which is what made the text feel cramped enough to need hiding in the first place), the group photo is now the card's full-bleed background, with a gradient scrim darkening the side the text sits on — the exact same technique the homepage hero already uses (`.hero` / `.hero-bg` / `.hero-scrim`), scaled down to card size as new `.programme-card--photo` / `.programme-card-bg` / `.programme-card-scrim` / `.programme-card-content` classes.

Built responsively, matching how `.hero` itself already adapts:
- **Desktop**: the scrim runs diagonally, dark-to-transparent left-to-right — text reads clearly on the dark left side while the photo is fully visible on the right. Content sits vertically centred. Both paragraphs show now (there's actual room, unlike the old cramped half-width column), so this replaces §53's mobile-only paragraph-hiding *for this card specifically* rather than stacking on top of it — the same `.mobile-hide-text` class is still there for the second paragraph, still doing its job on small screens.
- **Mobile** (≤760px): the scrim rotates to vertical instead — image visible up top, gradually darkening toward the bottom, where the text and buttons sit anchored (`align-items: flex-end`). A side-by-side split doesn't work in a narrow column; "photo up top, dark readable band at the bottom" does, which is exactly the adaptation `.hero` already makes at this same breakpoint.

The ambient shimmer sweep every other card gets (`.programme-card::before`) is switched off for this variant — a moving diagonal light sweep animating on top of a real photo read as visually busy rather than premium, so it's disabled specifically for `.programme-card--photo`.

## 55. Sankofa mentors, self-registered professionals, and backend for Register/RSVP, gallery submissions and MoTM nominations

**Run `db/migrations/028-sankofa-mentors-and-admin-views.sql` once** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 003, 014, 015 and 025 already applied.

**Session persistence — members now stay signed in for 30 days.** Previously a session lasted only as long as Supabase's own token refresh kept working in that one browser tab/session; there was no explicit cap or floor. `js/members.js` now stamps `localStorage['lacmsSessionStartedAt']` the moment someone signs in, and on every page load checks whether more than 30 days have passed since that stamp — if so, it force-signs-them-out (`supabaseClient.auth.signOut()`) before anything else on the page runs. Signing out (via the header's "Log out" button, or an expiry) clears the stamp. Doesn't change anything about *how* a session is kept alive session-to-session (still Supabase's own `persistSession`/`autoRefreshToken`) — it only adds an outer ceiling on how long one one is allowed to keep renewing itself for.

**Event registration is no longer one-way.** The Register button on `events.html` previously only ever inserted a row and then disabled itself — there was no way to change your mind. It now checks whether the button already carries `.is-registered`: if so, clicking it confirms ("Cancel your registration for X?") and deletes the row instead of inserting one; either way the button re-enables itself afterwards rather than staying permanently disabled. Text now reads "You're registered — cancel?" instead of a plain "Registered" with no next step.

**Sankofa Circle applications now have two completely separate branches sharing one page (`member-sankofa.html`).** Which one a visitor sees is decided purely by whether they have a `network_professionals` row at all:
- **Mentee** (existing, unchanged in substance): committee-only for now, `sankofa_eligible` gated, same questionnaire as before. **New: closes Sunday 11 October 2026.** Enforced twice — a friendly note on the page itself once the client-side clock passes that date, and (the real boundary) a `before insert` trigger in the database, `enforce_sankofa_mentee_deadline()`, so the deadline can't be bypassed by calling the API directly. Mentor applications are explicitly exempted from this trigger and never close.
- **Mentor** (new): any signed-in professional, active *or* still pending approval — no committee gate, no deadline. A different question set entirely (title, category, organisation, years of experience, specialty, motivation, what they can offer a mentee, capacity, plus the same communication-style/meeting-frequency choices as the mentee form). Both branches write into the same `sankofa_applications` table, now carrying a `applicant_type` column (`'mentee'` default, so the existing mentee insert code needed no changes) plus the new mentor-only columns.
- Whichever branch someone lands in, "already applied" is checked the same way — one row per `member_id` in `sankofa_applications`, regardless of type.

**Brand-new doctors/pharmacists — no LACMS membership needed to apply as a mentor.** New page: [mentor-signup.html](mentor-signup.html). Collects name, title, category, organisation (optional), email and password, and creates the account straight away (no separate "wait for approval before you can even sign in" step). After signup:
1. It first calls the existing `claim_professional_profile()` RPC — if the committee already pre-added this person to the Network (matched by email), this links the new account to that existing row instead of creating a duplicate.
2. If nothing was claimed, it inserts a fresh row into `network_professionals` directly, with `self_registered = true` and `is_active = false` — pending, not yet visible on the public Network page, but already able to sign in and submit a mentor application immediately.
3. If Supabase's email-confirmation setting is on (no session exists yet at signup time, so step 1/2 can't run there and then), the entered details are carried in the new account's own `user_metadata` instead, and picked up automatically the first time they land on `member-hub.html` after confirming — `loadProfessionalProfile()` there now falls back to creating the same self-registered row from `user_metadata.is_mentor_signup` if `claim_professional_profile()` found nothing. Either way, the end state is identical regardless of which email-confirmation setting this project ends up running with.
4. The RLS policy allowing this (`"A professional can create their own pending profile"`) pins `is_active = false` in its own `with check` — a self-signup can never mark itself active/public no matter what the client sends, only the president's approval action can. It checks the caller's own email via `auth.jwt() ->> 'email'` rather than querying `auth.users` directly — the `authenticated` role isn't reliably granted a table-level `select` on `auth.users`, but every session already carries its own email in its JWT claims, so this avoids that dependency entirely. (The pre-existing `security definer` functions that *do* query `auth.users`, like `claim_professional_profile()` itself, are a different case — those run with the function owner's elevated privileges, not the caller's.)
5. A link to this page now also appears on `member-sankofa.html`, above the auth gate, for anyone who lands there without an account.

**No email notifications were built** — a deliberate choice (asked directly, this was the answer): checking the president dashboard covers every one of these features, and adding email would mean either spamming an inbox on every single Register-interest click, or building a whole separate "which events matter" filtering layer that wasn't asked for. If that ever changes, revisit per-feature rather than adding one blanket "email me everything" hook.

**President dashboard (`president-dashboard.html`) gains five new sections**, each backed by its own `security definer` RPC in migration 028 (same pattern as the existing `president_get_members()` etc. — re-checks `is_president()` itself, doesn't rely on RLS alone):
- **Pending mentor accounts** — every `network_professionals` row with `self_registered = true, is_active = false`, with a one-click **Approve** button (`president_approve_professional()`) that flips `is_active` to true.
- **Sankofa applications** — every application, both types, in one filterable list (All / Mentees / Mentors tabs). Each row is a collapsed summary card that expands in place on click to show every field for that application — avoids either a giant always-expanded wall of text or a separate modal per row.
- **MoTM nominations** — same expandable-card treatment, nominee/nominator/reason.
- **Event registrations** — grouped by event, newest first within each group.
- **Gallery submissions** — a real browser for the `gallery-submissions` storage bucket (previously only viewable through the Supabase dashboard's own file browser). Uploads are stored as `{uploader's auth id}/{timestamp}-{filename}` with no name attached anywhere in storage itself, so this lists the bucket two levels deep (folders, then files inside each) and resolves every folder name back to a display name in one batched call — a new `president_lookup_names(uuid[])` RPC, the same triple-join-and-coalesce pattern as every other name lookup on this dashboard, just parameterised over a list of ids instead of returning everyone. Each file gets a 1-hour signed download URL generated on load; images get a real thumbnail, everything else gets a generic file icon.
- A new storage policy, `"President can view all gallery submissions"`, is what makes any of the last section possible — previously nobody but the Supabase dashboard itself (using the service role, bypassing RLS entirely) could read this bucket at all.

Verified the whole thing — layering, scrim direction and gradient stops, text contrast, bottom-anchoring, image visibility — using a placeholder gradient image standing in for the real photo (the real one uses a relative path that doesn't resolve in this session's isolated testing sandbox, a known limitation noted in earlier sections). What's now visually confirmed correct at both breakpoints: everything except the literal real photo pixels, which is just `object-fit: cover` on a standard `<img>` — the same call already working for `.hero-bg` on the homepage.

## 56. Dashboard reorganised into cards, mentor applications made genuinely public, a live-editable gallery, and a "what you get" preview on join.html

**Run `db/migrations/029-public-mentor-applications-and-live-gallery.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Doesn't need 028 to have been run first (it's independent). If 028 was already run, its account-based mentor mechanism (the `mentor_*` columns on `sankofa_applications`, `network_professionals.self_registered`, `president_get_pending_professionals()`, `president_approve_professional()`) is left in place untouched — just no longer used by any page, since the rest of this section replaces it with something simpler.

**Sankofa mentor applications no longer need an account.** Reworked based on direct feedback that asking a doctor or pharmacist to create a password just to apply as a mentor was too much friction. The "Apply to be a mentee or mentor" button (sankofa.html, programmes.html) now opens a modal asking which one first:
- **Mentee** — unchanged in substance: still needs LACMS membership, still routes to `member-sankofa.html`'s existing gated questionnaire (or `join.html` first if not yet a member).
- **Mentor** — a genuinely public five-field form right inside the modal itself: full name, email, job title, organisation (optional), LinkedIn (optional), and a short "why do you want to mentor / what can you offer" — submits straight into a new `sankofa_mentor_applications` table with **no sign-in required at all**. This fully replaces the account-based mentor flow built in §55/migration 028 — `mentor-signup.html` has been deleted, and `member-sankofa.html` is mentee-only again.
- The RLS policy allowing the public insert (`"Anyone can submit a mentor application"`, `to anon, authenticated`) validates field lengths and a basic email shape in its `with check` — the same "public contact-form" pattern this codebase already uses for read access (`news_posts`, `motm_winners`, `opportunities` are all `to anon, authenticated` for select), just extended to insert here since this is the first genuinely anonymous-write feature on the site.
- President-only: `president_get_sankofa_mentor_applications()` (read) and `president_set_mentor_application_status(id, status)` (triage: new → reviewed → contacted) — shown as small status-toggle pills inside each mentor application's expanded card on the dashboard.

**President dashboard reorganised into a card-based hub instead of one long scrolling page** — direct feedback that there were "too many parts on one page." Landing on `president-dashboard.html` now shows six clickable cards (User Activity, MMG, Sankofa, Nominations, Events, Gallery), each with a live count pulled from the same data already being fetched. Clicking one hides the grid and shows just that section, with an "All sections" back button to return; the URL's `#hash` tracks which section is open, so a link can deep-link straight into one. Data still loads once, up front (a handful of cheap indexed RPC calls) — only the *display* changed, not the loading strategy. The old "Pending mentor accounts" section is gone along with the account-based mentor mechanism it existed for.

**A live, president-editable public gallery** — direct feedback that swapping a gallery photo shouldn't require asking Claude to hand-edit a `FILES` array in `gallery.html` every time. New table `gallery_photos` + new public storage bucket `gallery-photos`, managed from the dashboard's Gallery card:
- **Upload** — pick one or more photos, they're live on `gallery.html` immediately (the bucket is public, so no signed URLs are needed for the public page to read them).
- **Hide/Show** — a toggle per photo flips `is_active` without deleting the file, so a photo can be pulled from public view and restored later without re-uploading.
- **Reorder** — simple ←/→ buttons nudge a photo's `display_order` past its neighbour (an integer swap, not a full reindex — cheap, and never collides on repeated moves).
- **Delete** — removes both the storage object and its row, after a confirmation.
- `gallery.html` itself now fetches from `gallery_photos` (public `select`, no auth needed) instead of reading a hardcoded list, with the old hardcoded `FILES` array kept as an automatic fallback — if the migration hasn't been run yet, the table's empty, or the fetch fails for any reason, the page quietly falls back to the old list rather than ever showing a blank gallery.
- The dashboard's existing "Gallery submissions" browser (§55 — the private member-upload review queue) is unchanged and sits alongside this as a separate subsection of the same Gallery card; nothing stops a submission being manually re-uploaded through the new live-upload form once approved, though the two aren't wired together automatically.

**join.html now shows what membership actually unlocks**, addressing feedback that the page didn't sell membership hard enough. Three "browser window" mockups — illustrative, CSS-only, no real screenshots or real member data — previewing the Network, Perks/discounts and Opportunities pages members get access to, sitting between the hero and the existing "what you get" list.

**Sankofa Circle diagram photo replaced** — `Media/Sankofa/Sankofa Circle.png` was swapped for a new version, same filename; the only code change needed was bumping that image's own cache-busting query string (`?v=20260824-8`, alongside the site-wide CSS/JS version bump) so browsers and GitHub Pages' CDN don't keep serving the old cached bytes under the unchanged URL.

## 57. Sankofa applications are now deletable, the gallery drops its hardcoded list entirely, the homepage carousel links to it, and MoTM nomination opens to all members with a one-a-month cap

**Run `db/migrations/030-sankofa-delete-gallery-curation-motm-monthly-limit.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 025 and 029 already applied.

**Sankofa applications (both mentee and mentor) can now be deleted from the dashboard.** Every application card on the Sankofa dashboard card now has a "Delete application" button at the bottom — asks for confirmation, then calls one of two new president-only RPCs (`president_delete_sankofa_application()` for mentees, `president_delete_sankofa_mentor_application()` for mentors) depending on which table that application actually lives in. There was previously no way to clear one out once it had been seen and wasn't being taken forward.

**The gallery drops its hardcoded photo list entirely** — direct feedback that "select and unselect every single photo" should be genuinely possible, not just for new uploads. Migration 030 adds `gallery_photos.is_static_asset` (true = this row's `storage_path` is a plain site-relative path under `Media/`, used directly as an `<img src>`, rather than an object in the `gallery-photos` storage bucket) and seeds a row for all 27 of the photos that used to live in `gallery.html`'s hardcoded `FILES` array — every one of them is now individually selectable/unselectable from the dashboard's Gallery card exactly like a freshly uploaded photo (same toggle, now labelled "Selected"/"Not selected" rather than "Live"/"Hidden" to match how the president actually thinks about it). Unselecting just flips `is_active` off — nothing is deleted; Delete is a separate, confirmed action, and correctly skips the Storage API entirely for `is_static_asset` rows since there's no bucket object to remove, only the row.
- `gallery.html` no longer has *any* fallback content — if the fetch fails, Supabase isn't configured, or there simply aren't any active photos yet, it shows "No photos in the gallery yet — check back soon." rather than silently reaching for old hardcoded data. The photos themselves are untouched on disk either way — `Media/ACMS Gallery/` still holds the real files, gallery_photos just now decides which ones are switched on.

**The homepage's "Who we are" photo carousel is now a real link to the gallery** — previously five crossfading photos, purely decorative (`aria-hidden="true"`, no click target). It's now an `<a href="gallery.html">` wrapping the whole carousel, with a "View the gallery →" pill that fades in on hover/focus and a subtle darkening of the photos underneath it, so the affordance is clear before someone clicks.

**"Nominate a member" buttons that opened an email compose window now go to the real nomination form** (`motm.html`'s two `mailto:` buttons → `#nominate`). Also fixed along the way: the nomination form itself was wrongly gated to committee-only client-side, directly contradicting the page's own "Any member can nominate — no committee role required" copy two paragraphs above it; the same wrong gate was hiding the "Nominate" quick-link on `member-hub.html` behind a permanent "Coming soon" card for every non-committee member. Both now correctly open to any LACMS member or Network professional — which is what the underlying database policy (migration 015) already allowed; the client was the only thing actually restricting it.

**MoTM nominations are now capped at one per person per calendar month, and the page says so.** Migration 030 stamps every new nomination with `nomination_month` (e.g. `'2026-08'`, set by a trigger from the server's own clock) and adds a unique constraint on `(nominator_id, nomination_month)` — the real enforcement, immune to a stale page or a double-click. The nomination page checks this itself before ever showing the form: already nominated this month → "You've used this month's nomination — it resets on the 1st"; otherwise the form shows with a permanent reminder above it ("One nomination per member, per calendar month"). If the client-side check is ever bypassed (two tabs, a race), the resulting unique-constraint violation (`error.code === '23505'`) is caught and shown as the same friendly message instead of a raw Postgres error.

## 58. Dashboard errors stop hiding as empty sections, MoTM nominations are deletable, About's "Our story" is real copy, and Active members goes hidden-until-launch and Table Editor-editable

**Run `db/migrations/031-motm-nomination-removal-and-site-settings.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 025 already applied.

**The dashboard used to render nothing at all when an RPC failed** — no list, no "nothing here yet," no error, for Sankofa applications, MoTM nominations or Event registrations. That's indistinguishable from "there's genuinely no data" from the outside — which is exactly how a real submission that failed to load looked like a missing submission, when the actual first report of this ("I nominated someone, it's not showing up on the dashboard") turned out to be caused by something else entirely (see below), but would have been invisible either way. `showSectionLoadError()` now puts the real Postgres/PostgREST error message directly in that section's empty-state slot and marks its dashboard card "Failed to load" — this page is president-only, so showing the raw error is safe and far more useful than a generic one.

**What actually happened to the "missing" nomination**: migration 030's dedup step (added to fix the unique-constraint creation failing on pre-existing test data) kept the *earliest* nomination per person per month and deleted later ones for that month — which meant an old throwaway test nomination ("salads" / "asd", from testing before the monthly limit existed) survived, and the real nomination submitted afterward was deleted since it wasn't the earliest. That data is unrecoverable; the test row was manually deleted via SQL Editor to free up the slot again. This can't recur the same way — the dedup only ever ran once, as part of creating the constraint, not on every future insert.

**MoTM nominations can now be deleted from the dashboard** — direct feedback that if someone wants to change who or why they nominated, the president needs a way to let them resubmit. Each nomination card gets a "Delete & let them nominate again" button (confirm, then `president_delete_motm_nomination()`); deleting it is the entire fix — the monthly slot frees up automatically the moment the row's gone, since the unique constraint only blocks while a row still exists for that month. Same pattern as the Sankofa application delete buttons from §57.

**About page's "Our story" is real, considered copy now, not `[Placeholder]` text.** Left the "Our values" cards below it untouched (not mentioned in the request) — flag if those should get the same treatment.

**"Active members" is hidden site-wide until 30 September 2026, then reads live from a new hand-editable setting** instead of a hardcoded "6" baked into `index.html` and `about.html`. New generic `site_settings` key/value table (publicly readable, so the stat can load with nobody signed in; president-writable via RLS for later, though editing it is meant to happen straight from Supabase's own Table Editor — find the `active_member_count` row, change `value`, done, no code change or redeploy). Before the reveal date, the stat tile is hidden entirely (not shown as "0" or stale) via `[data-active-member-count-item]`; after it, `js/members.js` fetches the row and reveals the tile with the live number. Same table is there for future settings that don't deserve a whole new migration and a hardcoded value each time.

## 59. Gallery submissions can be published or rejected from the dashboard, and the president can create accounts directly

**Run `db/migrations/032-president-direct-account-creation.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 025 already applied. (This is the only migration this section needs — the gallery publish/reject feature is pure client-side storage/table calls using policies that already existed.)

**Member submissions in the Gallery card can now be added straight to the public gallery, or rejected** — previously the dashboard could only *view* a submission (a signed "Open" link), with no way to act on it without leaving the site. Each submission now gets two buttons: **"Add to gallery"** (images only — the public slideshow is images-only, so this doesn't show for a video) downloads the file out of the private `gallery-submissions` bucket and re-uploads it straight into the public `gallery-photos` bucket plus a new `gallery_photos` row, live immediately; **"Reject"** deletes the file outright after a confirm. Either action removes it from the submissions bucket afterward, so the review queue only ever shows what still needs a decision, never something already actioned. Storage has no cross-bucket copy in the client SDK, so "publish" is a genuine download-then-upload round trip through the browser — for typical photo sizes this is fast and needs no server-side code.

**The president can now create a member, professional or MMG guest account directly from a new "Create Account" card** on the dashboard — one form, a type switcher (LACMS member / Professional / MMG guest) that swaps in the relevant fields, submit, done. This replaces the old two-step dance (Table Editor row, then Authentication → Invite user, then copying the UUID back into the row by hand) with a single action, without ever touching the service-role admin API — that key must never exist in browser code, full stop, so this couldn't and doesn't use `auth.admin.createUser()`. Instead:
1. A **second, isolated Supabase client** (`persistSession: false, autoRefreshToken: false, detectSessionInUrl: false`) calls `auth.signUp()` with the given email and a random password nobody ever sees or needs — critical detail: doing this on the *main* client would have replaced the president's own logged-in session with the brand-new account's the instant it succeeded, since a normal client persists whatever session `signUp()` returns. The isolated client's session never touches `localStorage`, so the president's own session on the main client is completely unaffected.
2. The new account's id comes straight back in that response, so the president's own (real) session immediately inserts the matching profile row — `members`, `network_professionals`, or `mmg_guests` depending on the type selected — using three new `is_president()`-gated insert policies from migration 032, additive alongside the existing ones (Table Editor via service role; a professional or MMG guest's own self-registration), not replacing them.
3. The isolated client then calls `auth.resetPasswordForEmail()`, sending the new person a genuine password-reset email — the same flow (and, once branded, the same `reset-password.html` template from [Section 9](#9-branded-auth-emails)) `member-login.html`'s and `mmg-login.html`'s existing "Forgot your password?" links already use. They land on the matching login page, set their own password, and everything downstream (activated_at, the president dashboard's roster, `claim_professional_profile()` for anyone added the old email-matching way) works exactly as if they'd been invited the old way — because functionally, they have been.

One honest trade-off worth knowing: this sends a *reset-password*-styled email, not Supabase's dedicated *invite* email (`invite.html`) — the invite template is only reachable through the admin API, which the anon key can't call. If that distinction matters, apply and lean on `reset-password.html`'s branding so it reads as clearly as the invite one does.

## 60. Dashboard gets colour and motion, gallery "Reject" actually deletes now, and the account-creation email is LACMS-branded

**Run `db/migrations/033-gallery-submission-delete-policy.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 025 already applied.

**Fixed: "Reject" on a gallery submission didn't delete anything.** The `gallery-submissions` storage bucket had an insert policy (a member uploading into their own folder) and a select policy (the president browsing the queue, §55) — but no delete policy at all, for anyone, including the president. `storage.remove()` was being silently refused by RLS rather than erroring loudly, which is exactly the class of bug that looks like "nothing happened" from the UI — the same root cause as §58's dashboard-loading issue, just in a different corner of the app. Migration 033 adds the missing `is_president()`-gated delete policy. While fixing it, also made both the Reject and "Add to gallery" actions surface a real, visible error (an `alert()`, since this page is president-only and there's no per-item status line to write into) if the underlying delete or upload ever fails, instead of only logging to console.

**President dashboard gets real colour and motion** — direct feedback that it "looks very static." Reused the site's own existing, already-proven techniques rather than inventing new ones:
- The landing grid's seven section cards now cycle through the site's four established accents (gold/green/red/purple) with a tinted gradient background, a matching icon colour, and the same diagonal shimmer sweep the homepage's impact cards use (`impact-shimmer`, staggered per card so they don't all catch the light at once) — purely for visual rhythm, the colour doesn't carry meaning per card.
- All four dashboard stat tiles are now colour-coded (previously only "Online now" and "Needs a nudge" were — "Total accounts" and "Fully set up" sat flat and grey, which was a big part of why the top of the page read as lifeless).
- Sankofa/MoTM application cards, roster rows, and gallery grid items all got a hover state (lift + border glow) where there was previously none at all — static elements that gave zero feedback on interaction.
- Switching between the landing grid and any section (or back) now fades and slides in (`dash-panel-in`), rather than an instant, jarring `display:none` ↔ `display:block` flip.
- `.dash-nav-card`, `.dash-stat`, `.app-card`, `.online-now-chip`, `.gallery-manage-item` and `.gallery-submission-item` were added to `js/main.js`'s existing site-wide scroll-reveal system (the same one every card grid, roster row and value item on the public site already uses) — they now fade/slide in on first appearance with a staggered delay, instead of just snapping into existence the moment the async data finishes loading. All of it respects `prefers-reduced-motion` the same way the rest of the site's motion already does.

**The account-creation email (§59) now reads correctly for a brand-new account, not just "you forgot your password."** `email-templates/reset-password.html` — already LACMS-branded, just not written with this second use in mind — had it said "We received a request to reset your password" and "your password will stay the same" to someone whose account the president had just created moments ago, which would've been confusing (they never requested anything, and there's no existing password to "stay the same"). Reworded to **"Set your password"** throughout, with copy that reads correctly whether this is a first-time account or an actual reset. This is still a template file in the repo, not something a code push can activate on its own — **apply it once** (if you haven't already): Supabase Dashboard → Authentication → Emails → Templates → **Reset Password** → paste in `email-templates/reset-password.html`'s content; worth updating the **Subject** field there too, e.g. to "Set your LACMS password", since that's set separately from the HTML body and doesn't come from this file.

## 61. Fix: Nominations card erroring "structure of query does not match function result type"

**Run `db/migrations/034-fix-motm-nominations-rpc.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 025 already applied.

§58's error-visibility fix worked exactly as intended — it surfaced a real error that was previously failing silently. The error itself (`structure of query does not match function result type`) is Postgres's own runtime check inside `RETURN QUERY`, and it fires when the query's actual result columns don't match the function's declared `RETURNS TABLE`. Read literally against 028's source, `president_get_motm_nominations()`'s six selected columns line up correctly in both count and order with its six declared return columns — so the most likely explanation is the function as actually deployed on this database has drifted from that file somehow, rather than a logic bug in the SQL itself.

Rather than guess at the exact cause, this migration `drop`s every version of the function outright (`cascade`, in case anything ended up depending on it) and recreates it fresh — the reliable way to guarantee one clean, correctly-typed function regardless of how the drift happened. Also added explicit `::text` casts on `auth.users.email` (which Supabase's own schema types as `character varying`, not `text`) inside the `coalesce()` and the plain select — belt-and-braces against a type-resolution edge case that's an unlikely culprit here (the same join pattern works fine in `president_get_event_registrations()` and others) but costs nothing to rule out for certain.

If the error somehow persists after running this: Supabase Dashboard → Settings → API → **Reload schema**. PostgREST (which turns this function into the API endpoint the dashboard calls) caches function signatures separately from Postgres itself, and very occasionally needs a manual nudge to notice one changed.

## 62. "Manage Accounts" — full edit and delete for any member, professional or MMG guest, from the dashboard itself

**Run `db/migrations/035-president-manage-accounts.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 025 already applied.

New 8th dashboard card, **Manage Accounts**: every LACMS member, Network professional and MMG guest in one searchable, filterable list (All / Members / Professionals / MMG tabs, same pattern as everywhere else on the dashboard) — click anyone to open an edit modal covering every field that actually matters for that account type, save changes, or remove them outright.

**Fields, per type:**
- **Member**: full name, course, year of study, membership status (active/expired/pending), member type (member/supporting committee/executive committee/senior or junior Sankofa mentor), committee role, and the three eligibility checkboxes (Sankofa eligible, MMG attendee, MMG committee).
- **Professional**: full name, email, title, organisation, category, bio, LinkedIn, and whether they're visible on the Network page (`is_active`) — the one field here that's genuinely new capability, since there was previously no way to hide a professional from the public Network without deleting them outright.
- **MMG guest**: full name, university, access level (pending/attendee/committee) — this replaces having to use Table Editor for every single access-level change, which until now was the only way to move someone from "pending" to "attendee" or "committee".

**Reuses rather than duplicates**: the account list reuses the exact same three `president_get_*()` RPC results already being fetched every dashboard load for the Activity and MMG cards — no extra network calls just to populate this list. Opening an account for editing fetches that one row fresh and in full (`select *`, via three new `is_president()`-gated select policies) so the edit form always has every column, including ones the summary RPCs don't return (a professional's bio, LinkedIn, `is_active`, `sort_order`). The edit modal itself is the same `.network-modal` component member-network.html's profile popup already uses, just wider (`.network-modal-panel--wide`) to fit a form instead of a read-only bio.

**Delete removes the profile row — not the login.** This is the same hard boundary as §59's Create Account: deleting a real Supabase Auth login needs the service-role admin API, which must never exist in browser code, full stop. What this *can* and does do (three new `is_president()`-gated delete policies) is exactly what deleting that row in Table Editor would do — remove their `members`/`network_professionals`/`mmg_guests` row, so they lose their profile and every feature gated on having one. Their login technically still exists and they could still sign in, but would hit the same "we couldn't find your profile" state an unlinked account already shows elsewhere on this site. The confirm dialog says this explicitly every time, and points to Authentication → Users for anyone who actually needs the login itself gone too. Checked the foreign keys first: every other table that references a person points at `auth.users` (`on delete cascade`) rather than at these three tables directly, except `network_join_events` (already `on delete set null`) — so deleting a profile row here is clean and won't fail with a constraint error or silently cascade-delete anything else.

## 63. About page's "Our story" rewritten with real copy, and no more em dashes on the public site

No migration needed — front-end only.

**"Our story" on `about.html`** now runs the copy given directly, replacing the earlier draft from §56: five paragraphs on why LACMS exists, what it's building, and the "learning from those ahead while lifting those coming behind" cycle connecting doctors, students and sixth-formers. Swapped in verbatim, no rewriting.

**Every em dash on the actual site is now a plain hyphen** — every `.html` page, the five Supabase email templates, and every user-facing string in `js/main.js`/`js/members.js` (status messages, confirm dialogs, button labels, the HTML fragments those two files build). Scoped deliberately to what a visitor or a president actually sees: developer-facing text — comments in the JS/CSS files, this README, the migration files — was left exactly as it was, since none of that is "on the website," and rewriting a project's entire internal documentation style wasn't what was asked. The JS files needed a line-by-line pass rather than a blind find-and-replace, skipping any line that's purely a `//` comment, so a rendered string like `"You're registered - cancel?"` got fixed while a comment explaining *why* that string exists stayed as originally written.

## 64. Fix: a deleted account kept showing up as "just joined" on the members hub and Network page

**Run `db/migrations/036-cleanup-join-events-on-delete.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 020 and 022 already applied.

Direct feedback that §62's new "Manage Accounts" delete didn't fully remove someone — they'd still appear in the "X just joined the Network!" banner on `member-hub.html` and the recent-joins ticker on `member-network.html`. The cause: `network_join_events` (§migrations 020/022) deliberately captures a member or professional's name **at the moment they join**, not read live from `members`/`network_professionals` — so the feed still reads correctly even if someone's course or title changes later. That same design meant deleting their account left the captured event row behind completely untouched; the foreign key was already `on delete set null`, but "set null" only ever clears the *reference*, it was never going to delete the now-orphaned, still-visible row itself.

Two parts: a one-time cleanup deletes any join event that's already orphaned (from a deletion that happened before this migration existed), and two new `before delete` triggers — one on `members`, one on `network_professionals` — take a person's join event(s) with them the moment their account is deleted, going forward, no matter whether that deletion happens through the dashboard's Manage Accounts card or directly in Table Editor. All three places that read `network_join_events` (the hub banner, the Network ticker, and the Network page's own feed) needed no code changes — they just query the table directly, so a clean table is a clean feed everywhere at once.

## 65. Fix: the events page's RSVP button sent signed-in members to "buy a membership"

No migration needed — front-end only.

Each event card on `events.html` has always carried two buttons stacked on top of each other: a plain "RSVP" link straight to `join.html`, and — hidden by default, revealed by JS once a session is confirmed — a real one wired to `event_registrations`, the exact table the dashboard's Events card (`president_get_event_registrations()`, migration 028) already reads from. The real button was built and working (including the register/unregister toggle from an earlier session); the RSVP link next to it just never had a corresponding "hide once signed in" rule, so it stayed visible and clickable for everyone, member or committee included, sending an already-signed-in person to buy a membership they already had.

The fix is one attribute, not new logic: `data-hide-when-signed-in` on the RSVP link — the exact same site-wide mechanism that already hides "Join the society" nav buttons for anyone signed in, now doing the identical job here. Signed out, RSVP shows and Register stays hidden (join first, exactly as intended); signed in — member or professional, no distinction, matching `event_registrations`' own RLS policies, which never distinguished between the two either — RSVP disappears and the real Register/Registered toggle takes over, writing straight into the same table the president dashboard's Events card reads from. Verified the signed-out state directly: RSVP visible, Register hidden, on all eight event cards.

## 66. Fix: editing a name via Manage Accounts didn't update the "just joined" activity notification

**Run `db/migrations/036-sync-join-events-on-profile-edit.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 020 and 022 already applied.

Reported directly: a professional created as "Odiri Oteri" was renamed to "Dr Odiri Oteri" through §62's Manage Accounts edit — the Network directory picked it up immediately (it reads `network_professionals.full_name` live), but the "just joined the Network" banner on `member-hub.html` and the ticker on `member-network.html` kept showing the old name. The cause: `network_join_events` (§migrations 020/022) deliberately *captures* a name — plus course/year/type for a member, or title/organisation/category for a professional — the moment someone joins, rather than reading it live, specifically so the feed still reads correctly even after that person's details change or they leave. Right call for "they moved courses two years later," wrong call for "I fixed a typo five minutes after creating the account" — nothing was watching for the second case.

Two new `after update` triggers — one on `members`, one on `network_professionals` — make the snapshot self-healing from here on: any future edit to a captured field, through *any* path (Manage Accounts, Table Editor, anything else that ever touches these tables), updates the matching `network_join_events` row(s) automatically, no code changes needed on the client side at all. Alongside that, a one-time backfill resyncs every existing row against its current `members`/`network_professionals` data — that's the part that actually fixes Odiri Oteri (and anything else already drifted) the moment this migration runs.

Checked whether the same staleness exists anywhere else "across the website": everywhere the Sankofa/MoTM/Events dashboard cards and the public Network page show a name, they resolve it live via a join or a direct RLS-visible select — no other snapshot to go stale. `motm_winners` was the one other candidate that looked similar at a glance, but it's a genuinely separate, hand-curated table with no foreign key back to `members`/`network_professionals` at all — the committee writes each month's winner's bio and photo themselves, so there's no "source of truth" row to sync from in the first place, and it was left alone.

## 67. Fix: creating an account via the dashboard sent two confusing emails, and the confirmation one led nowhere

No migration needed — front-end only, plus one email template's wording.

Reported directly: creating a member through the dashboard's Create Account panel sent two emails — a "confirm your email" one and a "set your password" one — and clicking the first left the new person on `member-login.html` with no way to ever actually choose a password.

**The actual bug**: the `signUp()` call that creates the login never passed `emailRedirectTo`. If this Supabase project has "Confirm email" switched on, `signUp()` sends its own confirmation email immediately and automatically — that's Supabase's behaviour, not something the code chooses — using whatever redirect the call gives it. Leaving it unset meant that email fell back to the project's generic Site URL instead of `member-login.html`, the one page that knows how to show a "set your password" form for a link carrying `?code=...` (a deliberate site-wide convention already documented at the top of the login page's own script — this site has no other flow that ever produces that param, so its mere presence already means "show the password form," confirmation links included, not just recovery ones). Land on the wrong page and that logic never runs, so the confirmation link just confirmed the address and went nowhere useful. The code then *also* fired its own follow-up password-reset email regardless, on top of whatever `signUp()` had already done — hence two emails, only one of which (sometimes neither) actually worked.

**Fixed both halves.** `signUp()` now passes `emailRedirectTo` pointing at the right login page (`member-login.html` or `mmg-login.html`), so *if* Supabase does send its own confirmation email, that link now correctly lands somewhere that shows the set-password form. And the follow-up password-reset email only fires when it's actually needed — checked via `signUpResult.data.session`: null means "Confirm email" is on and `signUp()` already sent the one email that matters (now working correctly), so nothing else is sent; a real session back means confirmation is off and `signUp()` sent nothing on its own, so the reset email is the only one that exists. Exactly one working email, either way, self-adapting to whichever "Confirm email" setting this project happens to have — no Supabase dashboard change needed on top of this.

**`email-templates/confirm-signup.html` reworded** to match, since it may now be the *only* email a new account ever gets: "Confirm your email" → **"Confirm your email & set your password"**, with copy explaining the one link does both. Kept intentionally neutral ("Your LACMS account is ready," not "has been created for you") since this same template also fires for MMG guests self-registering on `mmg-login.html`, not just accounts the president creates.

## 68. Executive Committee gets dashboard access — five cards, not eight

**Run `db/migrations/037-executive-committee-dashboard-access.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. Needs 025, 026, 027, 028, 029, 030, 031, 033, 034 already applied (this migration only replaces function bodies and policies those already created — nothing new structurally).

Requested directly: give Executive Committee members (`members.member_type = 'executive_committee'`) access to the dashboard too, but only MMG, Sankofa, Nominations, Events and Gallery — User Activity, Create Account and Manage Accounts stay president-only, since those three touch full account rosters and the ability to create/edit/delete anyone's login, a materially bigger trust boundary than reviewing an application or curating the public gallery.

**Two new database functions establish the line**, the same way `is_president()` already does for the president alone:
- `is_executive_committee()` — true for any signed-in member whose own `members` row has `member_type = 'executive_committee'`.
- `is_dashboard_admin()` — true for the president *or* an executive committee member.

Every RPC and RLS policy behind the five shared cards (`president_get_mmg_guests`, the Sankofa application get/delete/status RPCs, `president_get_motm_nominations`/`president_delete_motm_nomination`, `president_get_event_registrations`, `president_lookup_names`, and every gallery-submissions/gallery-photos storage and table policy) swapped its `is_president()` check for `is_dashboard_admin()`. Everything behind the three restricted cards — `president_get_members`/`president_get_pending_members`/`president_get_professionals`, `president_mark_activated`, and every policy from §59 (Create Account) and §62 (Manage Accounts) — is untouched and stays `is_president()`-only. Real security boundary either way, same as it's always been: this is a database-level check, not something the page's own JS decides.

**Client side**, `president-dashboard.html`'s auth gate now checks two things instead of one: the hardcoded president UID first (unchanged), then — for anyone else signed in — their own `members.member_type`, exactly the same `auth.uid() = id` self-read every member already has. An Executive Committee session gets a `dashboardRole` of `'exec_committee'` instead of `'president'`; that value hides the three restricted landing cards outright (not just styled as locked), skips their three RPC calls entirely rather than firing a request that can only come back "Not authorized," and falls back to the landing grid if someone somehow lands on a restricted `#section` URL directly (a stale bookmark, a shared link) — defensive, not the real gate, since the RPCs behind it would refuse the data regardless of what this page does. The dashboard's own quick-link card on `member-hub.html` — previously hidden from literally everyone but the president — now reveals itself for both roles the same way.

**"President only" is "Executive Committee" everywhere it appeared** — the dashboard's own page eyebrow and meta description, and the quick-link card's tag on `member-hub.html` — since neither is accurate anymore now that a second role can be here.

## 69. Fix, properly this time: Create Account's "two emails, one of them broken" bug

No migration needed — front-end only. §67 fixed *some* of this and thought it was done; testing it for real turned up two more genuine bugs stacked underneath, both fixed now.

**Bug 1 — the double email was never actually fixed.** §67's fix for "only send the reset email when it's actually needed" checked `!signUpResult.data.session` — backwards. `session` is null exactly when "Confirm email" is *on* and `signUp()` has *already* sent its own confirmation email; that's precisely the case where a second email shouldn't fire, and the inverted check fired it anyway. It's also exactly the one case where `session` *does* come back (confirmation off, `signUp()` sent nothing itself) that a reset email is actually the only way anyone gets a link — and the inverted check skipped it there. Two real, opposite failures from one flipped `!`. Now reads `!!signUpResult.data.session`.

**Bug 2 — the surviving email's link led nowhere, on any device but the one that requested it.** This project defaults to the PKCE auth flow, where an emailed `?code=` only redeems successfully in the exact browser that requested it — the matching verifier lives in that browser's own storage, and nowhere else. That's invisible for a normal "forgot password" click (same person, same browser, both ends, most of the time) but *always* broken here: the president's browser requests the account-creation link, and a completely different person, on a completely different device, is the one who has to redeem it. No browser on earth has both halves a PKCE exchange needs. Fixed with a new shared `createImplicitFlowClient()` helper (`flowType: 'implicit'` on an isolated, non-session-persisting client) — every `signUp()`/`resetPasswordForEmail()` call that might be redeemed on a different device now goes through it, producing the older, fully self-contained `#access_token=...&type=...` link format instead, which needs no stored verifier and works from any device. Applied to Create Account (the reported case) *and*, preventively, to both regular "forgot your password?" flows (`member-login.html`, `mmg-login.html`) — the identical failure mode was always one "request on a laptop, check email on a phone" away from happening there too.

**Bug 3, found while fixing Bug 2 — `type=signup` links were never recognised at all.** Both login pages' recovery-link detection checked for `type=invite` and `type=recovery` in the URL, but not `type=signup` — the type Supabase's own `signUp()` confirmation link actually carries. A correctly-redeemable implicit-flow signup link would have still silently signed someone in and dropped them at the hub with no "set your password" prompt, on their still-unknown random password. Both `isRecoveryFlow` checks (`member-login.html`, `mmg-login.html`) now also match `type=signup`.

All three had to be fixed together for the fix to actually hold — any one alone still left a broken path. Nothing here should need a live-testing round-trip to verify again: the reasoning is that a link generated by `createImplicitFlowClient()` is fully self-contained (real tokens, not a redemption code), so it succeeds independent of which browser or device opens it, and both login pages now recognise every `type` value Supabase can put on it.

## 70. Fix: "Year Three" and "Year 3" landed a new account in its own separate group on the Network page

**Run `db/migrations/038-normalize-year-of-study.sql`** — Supabase Dashboard → SQL Editor → New query, paste, Run. No prior migration required.

Reported directly: a new account created with "Year Three" typed into `year_of_study` ended up its own separate group on the Network page, next to everyone else's "Year Three" — because most existing members were added with the year spelled out in words, and the two don't match as plain text even though they mean the same thing. (The Network page's own `yearGroupLabel()` already folds "Year 3", "Year Three" and "3rd year" into one *display* bucket — that part was already working — but the underlying *stored* value never actually changed to match, which is exactly the inconsistency being reported here.)

**Chosen digit form ("Year 3") as the one canonical form, everywhere, going forward** — not because it's inherently better than the word form, but because it's already what every display on the site (`yearGroupLabel()`, used by the Network page, the dashboard roster, and MoTM winner labels) normalises *to*. Making the stored data agree with what already gets shown, rather than the other way round, meant fewer places needed to change.

**Two places now normalise at the point of entry**, both in `js/members.js`: the dashboard's Create Account panel and its Manage Accounts edit form. A new `normalizeYearOfStudy()` — the same digit-first, then number-word ("one" through "seven"), then leave-non-numeric-text-alone logic `yearGroupLabel()` already uses for display, just a separate local copy since `member-network.html`'s script scope has no access to the president dashboard's — runs on whatever's typed before it's ever written to the database. "Year Three," "year three," "YEAR THREE" — all become "Year 3" the moment they're saved; "Foundation Doctor" and other genuinely non-numeric entries pass through completely unchanged, exactly like `yearGroupLabel()` already does for display.

**The migration is what actually fixes the *existing* mismatch** the report was about — normalising future input alone would have left old "Year Three"-style rows exactly as inconsistent as before. A one-time backfill converts every exact "Year One" through "Year Seven" (case-insensitive) already sitting in `members` and `pending_members` to its digit form. Deliberately an *exact* match only — something like "Year Three (transferred)" is left untouched rather than risk silently discarding real detail a broader pattern might have mangled.

## 71. Fix: the dashboard showed a stale "last active" even after a genuine, recent sign-in

No migration needed — front-end only.

Reported directly: Roberta signed in a few hours before the report, but the dashboard still showed her as not active in a day. Two real signals feed "how recently was this person active" — `last_seen_at` (the client-side heartbeat, upserted every 30 seconds by whichever page someone's on) and `last_sign_in_at` (Supabase's own server-side timestamp, set the instant a sign-in succeeds, no client JS execution needed afterward) — and `presidentLastActivity()` used to just take `last_seen_at` unconditionally whenever it existed at all, falling back to `last_sign_in_at` only if it didn't. That's backwards the moment the heartbeat itself goes stale for any reason (a tab closed before the next 30-second beat, a phone locked, a flaky connection on that one visit) while a real, more recent sign-in exists — exactly Roberta's case: an old heartbeat from a previous day silently outranked a real sign-in from a few hours ago, every time, because the code never actually compared *which one was newer*, just which one happened to be non-null first.

**Fixed to compare both timestamps and use whichever is genuinely more recent**, not whichever field wins an unconditional preference order. This is the one function every activity signal on the dashboard already read from — "Online now," the "Active · X ago" status pill, and the most-recently-active sort order all call `presidentLastActivity()` — so fixing it once fixes all three at once, and makes the whole system self-healing against either signal individually going stale: the heartbeat can still be missed sometimes (unavoidable — it depends on a client actually running JS), but it can no longer mask a fresher sign-in that Supabase's own server already recorded.

## 72. Fix, further: real activity was still getting hidden behind the activated_at flag

No migration needed — front-end only. Direct follow-up to §71 — reported as "members I personally know used their account earlier today, but it still doesn't show up," even after that fix landed.

**The remaining gate**: `presidentStatus()` only ever checked `presidentLastActivity()` (§71's fixed timestamp comparison) *after* first confirming `row.activated_at` was set — and `presidentIsOnline()` required it too, unconditionally. `activated_at` is a separate bookkeeping flag, set once when someone finishes `updateUser({password})` on their invite link — and this project has direct, documented history (migration 027) of that specific flag being wrong for real accounts. The practical effect: someone could have a fresh heartbeat or a same-day sign-in — genuine, unambiguous proof they used the site today — and the dashboard would still show "Hasn't opened invite," because a second, independent flag hadn't been set to agree with the timestamp that was already sitting right there.

**Reordered so real evidence is checked first, always.** `presidentIsOnline()` and `presidentStatus()` both now look at `presidentLastActivity()` on its own merits before touching `activated_at` at all — a heartbeat or a sign-in, at any point, is direct proof of use and doesn't need a second flag's permission to be believed. `activated_at` only still matters as a *fallback*, for the one case with genuinely no timestamp at all: someone the president has manually confirmed with "Mark active" but who has no tracked activity yet shows a plain "Active"; someone with neither shows "Hasn't opened invite."

**One state quietly retired: "Invite opened, not finished."** It used to mean "has `last_sign_in_at` but no `activated_at`" — but `last_sign_in_at` is now part of what `presidentLastActivity()` itself checks, so that combination now correctly reads as "Active · X ago" instead, with a real timestamp attached rather than a vague label with none. Nothing about the underlying tracking is lost, though: the "Needs a nudge" list and the "Mark active" button both still key off `activated_at` directly, completely unaffected by this — someone can now show "Active · 3 days ago" in the main roster *and* still correctly appear in "Needs a nudge" underneath it, which if anything is more useful than before: it tells the president both how long someone's been using a not-yet-flagged account, and that the flag itself needs a one-click fix.
