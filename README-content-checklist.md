# LACMS website — content checklist

This site is a complete, working draft built with plain HTML/CSS/JS (no build step — just open `index.html`, or host the folder as-is on GitHub Pages / Netlify / Vercel). Outstanding items are marked with a gold banner on every page until you replace it — the banner currently reads a note to Nevin about media day; update or remove it once photos/text are final (see §9).

## 1. Logo — done

`Media/logo.png` is in place and wired into every header, footer and browser tab icon.

## 2. Photos — outstanding

Drop images into `Media/` and swap the placeholder tiles for real `<img>` tags (ask your dev/committee member helping with the site, or a future Claude session, to do the swap — the filenames below are already referenced in comments/labels on each placeholder so it's a quick find-and-replace):

- `Media/hero.jpg` — homepage hero (full-bleed background behind the headline)
- `Media/about-preview.jpg`, `Media/about-story.jpg` — About page
- `Media/sankofa-mentorship.jpg`, `Media/study-skills.jpg`, `Media/widening-access.jpg` — Programmes page
- `Media/opportunities-preview.jpg` — homepage opportunities teaser
- `Media/gallery-01.jpg` through `gallery-12.jpg` — Gallery page
- Committee headshots on the About page: `nevin-boakye.jpg`, `jemimah-omotola.jpg`, `stephen-archer-jr.jpg`, `roberta-arthur.jpg`, `martin-oti.jpg`, `gloria-ndarigumije.jpg`

## 3. Committee (about.html) — done

Real names, roles and course years are in:

- President — Nevin Boakye (Medicine, Year 3)
- Vice President — Jemimah Omotola (Medicine, Year 2)
- Treasurer — Stephen Archer Jr (Medicine, Year 3)
- Event Secretary — Roberta Arthur (Medicine, Year 3)
- Social Secretary — Martin Oti (Medicine, Year 3)
- Charity Secretary — Gloria Ndarigumije (Medicine, Year 3)

Only headshots are still outstanding (see §2). The committee section now sits directly under the page hero on About us, above "Our story."

## 4. Events (index.html + events.html + programmes.html) — done, minus times/venues

The "What's on" nav item is now **Events**, and the page moved from `whats-on.html` to **`events.html`**. All 8 confirmed events are listed there in date order, each with a stable anchor ID:

- `#welcome-and-launch` — ACMS Welcome and Launch — 30 Sep 2026
- `#games-night-1` — ACMS Games Night 1 — 8 Oct 2026
- `#sankofa-circle-session-1` — ACMS Sankofa Circle Session 1 — 14 Oct 2026 (cross-links to the Sankofa Mentorship programme)
- `#professional-development-programme` — ACMS Professional Development Programme — 21 Oct 2026
- `#games-night-2` — ACMS Games Night 2 — 11 Nov 2026
- `#world-diabetes-day-charity-tournament` — World Diabetes Day Charity Tournament — 14 Nov 2026
- `#midlands-medics-gala` — The ACMS Midlands Medics Gala — 21 Nov 2026 (styled gold with a subtle shimmer as the flagship event)
- `#winter-charity-fundraiser` — ACMS Winter Charity Fundraiser — 3 Dec 2026

The homepage now has a full **"This year at LACMS" Events carousel** near the bottom (all 8 events, swipeable/draggable, with prev/next arrows either side) — keep the anchor IDs above in sync if you ever rename an event, or the carousel's "RSVP" links will point at nothing.

**Still outstanding:** every event shows "Time & venue TBC" — fill these in once confirmed, and write real descriptions in place of the current short generic ones.

## 5. Contact & socials (every page footer + join.html) — email done

- Email: `acms@lincolnsu.com` ✓
- Instagram / LinkedIn / TikTok links still point to `#` — add real profile URLs
- Address: "University of Lincoln, Brayford Pool, Lincoln" — confirm this is correct

## 6. Join form (join.html) — outstanding

The membership form is fully styled but **not connected to anything** — submitting it just shows a message asking people to email instead. To make it live, pick one:
- Easiest: replace the `<form>` with a Google Form embed
- No-code-ish: use [Formspree](https://formspree.io) — just change the `<form>` tag's `action` to your Formspree endpoint
- If you end up hosting on Netlify: add `netlify` and `name="join"` attributes to the `<form>` tag ([Netlify Forms docs](https://docs.netlify.com/forms/setup/))

Also confirm/replace the membership fee placeholder text at the top of `join.html`.

## 7. Homepage impact section — confirm the stats

Right under the hero, `index.html` has a 3-card row: a "Featured Opportunity" card (Sankofa Mentorship, with an original line-art bird and the mentor-network description you gave), an "Upcoming Event" card (the Midlands Medics Gala, with an original line-art cathedral silhouette and your black-tie/7-universities description), and an "Our Impact" stats card showing:

- **100+ Students**
- **7 Disciplines**
- **30+ Professionals**

These numbers were given as-is — confirm they're accurate before launch, and update the figures directly in `index.html` (search for `impact-stat-num`) if they change. No real photos are used in this section (both illustrations are original line art), so there's nothing to swap here unless you'd rather use real photography instead.

## 7b. Homepage "Who we are" stats + About page — done

Both pages now show: **6 active members**, **20 Professional Mentors**, **10+ events/year**. Update both places if these change — `index.html` (search `stat-num`) and `about.html`'s matching stat row.

## 7c. Homepage layout changes — done

- The old static "Programmes" 3-card grid is gone; the homepage now has a Programmes teaser section styled like the Opportunities one (text + photo placeholder, "Browse programmes" link to `programmes.html`).
- The homepage Gallery section has been removed entirely. The Gallery page and its nav link are untouched — only the homepage preview section was cut.

## 7d. ACMS Member of the Month (motm.html) — new, outstanding

New page + homepage teaser, added to the main nav, mobile drawer and footer on every page.

- **Spotlight section** (top of `motm.html`): a full editorial profile for the current honouree — photo, a rotating gold "Member of the Month" seal overlapping the photo corner, name, course/role, category tags, a pull-quote, and a two-paragraph write-up with a drop-cap opening letter.
- **Archive section**: currently an empty state ("this is where past honourees will live"), since this is a new tradition with no history yet. There's an HTML comment in `motm.html` right after the empty-state block showing the exact markup to duplicate for each new entry (wrap them in `<div class="grid grid--3">`).
- **Nominate CTA**: mailto link to `acms@lincolnsu.com?subject=MoTM Nomination`.
- **Homepage teaser**: new section on `index.html` between the Programmes teaser and the closing tagline, linking to `motm.html`.

**To publish August's honouree:** in `motm.html`, replace `[Full Name]`, `[Course, Year] · [Committee role, if applicable]`, the tags, the quote, and both `[Placeholder]` paragraphs. Swap the photo placeholder for `Media/motm-2026-08.jpg` (same filename referenced on the homepage teaser — update both if you rename it). Each future month: add a new `motm-archive-card` in the archive grid for the outgoing honouree, and update the spotlight section with the new one.

## 8. Design system

- Colours: black/near-black background, gold accent (`#d4a62b`), with red/green used only as small event-category dots — drawn from your crest.
- Fonts: Playfair Display (headings) + Inter (body), loaded from Google Fonts.
- All tokens live at the top of `css/styles.css` under `:root` if you want to adjust the palette later.

## 9. Removing the draft banner

Once photos, event details and the join form are sorted, delete the `<div class="placeholder-banner">…</div>` line near the top of each HTML file's `<body>` (currently the same message on every page — edit it there too if you want to change it before then).
