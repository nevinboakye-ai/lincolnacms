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
