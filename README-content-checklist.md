# LACMS website — content checklist

This site is a complete, working draft built with plain HTML/CSS/JS (no build step — just open `index.html`, or host the folder as-is on GitHub Pages / Netlify / Vercel). Outstanding items are marked with a gold banner on every page until you replace it — the banner currently reads a note to Nevin about media day; update or remove it once photos/text are final (see §9).

## 1. Logo — done

`Media/ACMS Branding/logo.png` is in place and wired into every header, footer and browser tab icon.

## 1b. Media folder structure — important

Your `Media/` folder is now organised into subfolders, and every page has been updated to match:

- `Media/ACMS Branding/logo.png` — the crest, used everywhere
- `Media/ACMS Gallery/` — every real photo: `hero.jpg` (homepage), `sankofa-mentorship.jpg` (homepage Programmes teaser), plus the ~27 event photos powering the Gallery slideshow (see §2b)

**If you rename or move either folder, the whole site breaks** (this exact thing happened once already — see the git history). If you add more branding assets, put them in `Media/ACMS Branding/`; more event photos go in `Media/ACMS Gallery/` and just need adding to the `FILES` array described in §2b.

Filenames with spaces (e.g. `IMG_1164 2.JPG`) work fine — the site encodes them automatically — but it's cleaner to avoid spaces in future filenames if you're naming them yourself.

## 2. Photos — mostly outstanding

Real photos are wired in for the homepage hero, the Programmes page's Sankofa teaser, and the whole Gallery page (see §2b). Still placeholder — drop images into `Media/ACMS Gallery/` (or wherever makes sense) and swap these:

- `Media/about-preview.jpg`, `Media/about-story.jpg` — About page
- `Media/study-skills.jpg`, `Media/widening-access.jpg` — Programmes page
- `Media/sankofa-circle.jpg` — Sankofa Mentorship page (see §10)
- Committee headshots on the About page: `nevin-boakye.jpg`, `jemimah-omotola.jpg`, `stephen-archer-jr.jpg`, `roberta-arthur.jpg`, `martin-oti.jpg`, `gloria-ndarigumije.jpg`
- `Media/motm-2026-09.jpg` — September's Member of the Month (see §7d)

## 2b. Gallery slideshow — done

`gallery.html` is now a slideshow, not a grid: one large photo at a time, shuffled into random order on every page load, with Previous/Next buttons either side, a "Shuffle" button, autoplay every 5 seconds (pauses on hover, and is skipped entirely for visitors with reduced-motion enabled), and keyboard arrow-key support.

It pulls straight from `Media/ACMS Gallery/` via a hardcoded list near the top of `gallery.html` (search for `var FILES`). **To add a new photo:** drop the file into that folder and add its filename to the `FILES` array. **To remove one:** delete its entry from the array (no need to delete the file). A few files in that folder were skipped because browsers can't display them or they're currently empty on disk — `.heic` files (`NevinEmb1.heic`, `NevinEmb2.heic`, `IMG_0192.HEIC`) and a couple of 0-byte files (`1stYearAllMedics.JPG`, `Medball_Nevin-Stephen.JPEG`, likely an iCloud sync issue) — convert the HEICs to JPG and re-sync the empty ones, then add them to the list.

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

The Gala card's eyebrow now reads "Flagship Event" (was "Upcoming Event"), and its colour theme is gold (was red) — the Our Impact card carries the red theme instead.

These numbers were given as-is — confirm they're accurate before launch, and update the figures directly in `index.html` (search for `impact-stat-num`) if they change. No real photos are used in this section (both illustrations are original line art), so there's nothing to swap here unless you'd rather use real photography instead.

## 7b. Homepage "Who we are" stats + About page — done

Both pages now show: **6 active members**, **20 Professional Mentors**, **10+ events/year**. Update both places if these change — `index.html` (search `stat-num`) and `about.html`'s matching stat row.

## 7c. Homepage layout changes — done

- The old static "Programmes" 3-card grid is gone; and the standalone Opportunities and Programmes teaser sections (each with their own heading, text and photo) have since been removed from the homepage entirely, on both desktop and mobile.
- The homepage Gallery section has been removed entirely. The Gallery page and its nav link are untouched — only the homepage preview section was cut.
- The "Who we are" section's single photo is now a **5-image crossfade carousel** (pure CSS, no JS), cycling through a selection of real photos from `Media/ACMS Gallery/`. To change which photos it shows, edit the `<img class="wwa-carousel-img">` tags in `index.html`'s Who We Are section — each has a staggered negative `animation-delay` (0s, -4s, -8s, -12s, -16s) that keeps them cycling in order; keep that stagger pattern if you add/remove images.
- Underneath, the old single "Meet the committee" link is now a 3-link stack: **Meet the committee**, **Explore our programmes**, **Browse our opportunities** — pointing at `about.html#committee`, `programmes.html` and `opportunities.html` respectively. This is now the homepage's only route into Programmes/Opportunities content (besides the main nav).

## 7d. ACMS Member of the Month (motm.html) — new, outstanding

New page + homepage teaser, added to the main nav (positioned between Opportunities and Gallery), mobile drawer and footer on every page.

- **Spotlight**: eyebrow, big heading, a red/green/gold tricolour accent bar, then the current honouree — photo with a gold ribbon month badge across the corner (currently reads "September 2026"), name, course/role, a short bio, a pull-quote with a large decorative quote mark, three colour-coded category tags (red/green/gold dots), and two buttons (Nominate / How selection works).
- **"Why [Name] was selected"**: three numbered (01/02/03) reusable criteria — these are permanent template copy, not placeholder, so they don't need editing unless you want different criteria.
- **"Previous honourees"**: a populated 3-card archive grid (`[Full Name]` placeholders) — this is a brand-new tradition with no real history yet, so treat these as examples to replace, with a note under the grid saying so. Add a new card here each month for the outgoing honouree.
- **"Our selection process"**: three steps (Nominate → Committee review → Winner announced) plus a Nominate button — permanent template copy.
- **Nominate CTA**: mailto link to `acms@lincolnsu.com?subject=MoTM Nomination` (appears twice: hero and process section).
- **Homepage teaser**: section on `index.html` between "Who we are" and the Events carousel, linking to `motm.html`, using the same gold ribbon badge style.

**To publish September's honouree:** in `motm.html`, replace `[Full Name]`, `[Course] · [Year]`, the bio, the quote, and the "Why selected" heading's `[Full Name]`. Swap the photo placeholder for `Media/motm-2026-09.jpg` (same filename referenced on the homepage teaser — update both if you rename it).

## 10. Sankofa Mentorship page (sankofa.html) — new, mostly done

New dedicated page explaining the full programme, linked via "Discover more about Sankofa" on the Programmes page's Sankofa section (and the homepage's Sankofa card and Events page both now link straight here too). Not in the main nav — it's a deep-dive reached through those links.

- **The significance of Sankofa**: the Akan-word meaning and philosophy, using the detail you provided.
- **Sankofa Circles**: an 8-step visual chain (Sixth Form → Year 1–5 → F1/F2 doctor → Senior doctor/consultant) showing the continuous mentorship structure, scrolls horizontally on narrow screens.
- **How it works**: five real (not placeholder) cards covering support direction, the F1/F2 role, the senior doctor role, termly meetings, and long-term relationships — all written from the detail you gave.
- One remaining photo placeholder: `Media/sankofa-circle.jpg`.
- Also updated to match: the Sankofa section on `programmes.html` itself (now real copy instead of `[Placeholder]`, plus the new "Discover more" link).

## 11. Colour accents

Added a reusable red/green/gold tricolour bar (`.tricolor-bar`, small variant `.tricolor-bar--sm`) under the intro text on every page-hero site-wide, plus on the MoTM and Sankofa pages — a recurring brand motif tying back to the crest, beyond the existing gold-only accents.

## 8. Design system

- Colours: black/near-black background, gold accent (`#d4a62b`), with red/green used as event-category dots, tags and the tricolour accent bar — drawn from your crest.
- Fonts: Playfair Display (headings) + Inter (body), loaded from Google Fonts.
- All tokens live at the top of `css/styles.css` under `:root` if you want to adjust the palette later.

## 9. Removing the draft banner

Once photos, event details and the join form are sorted, delete the `<div class="placeholder-banner">…</div>` line near the top of each HTML file's `<body>` (currently the same message on every page — edit it there too if you want to change it before then).
