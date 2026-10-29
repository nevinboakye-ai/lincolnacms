# LACMS website: data protection and regulatory compliance report

**Society:** Lincoln African Caribbean Medical Society (LACMS), a student society of the University of Lincoln Students' Union (ULSU)
**Website:** lincolnacms.uk
**Report date:** 30 October 2026 (version 1.0)
**Privacy notice version this report matches:** 2026-10-30

---

## 0. Read this first

**What this document is.** A record of what was checked on the LACMS website, what was changed so that it meets the law and ULSU's rules, and what still has to be done by people (a website can't do everything). It is written so that it can be shown to ULSU.

**Where things stand with ULSU.** The society has **not yet been in contact with ULSU** about any of this. ULSU's published policies are used throughout as a **benchmark and reference**, not because any agreement, approval or arrangement exists. Nothing on the website or in this report should be read as saying ULSU has approved, reviewed or is overseeing it. The website describes ULSU's contacts and policies as options available to members and to the committee. Section 10.1 is the first step: open the conversation.

**What it is not.** It is not legal advice, and it does not certify that the society is compliant. Nobody can honestly say "we comply with every regulation" without a person at ULSU or a data protection adviser confirming the open items in section 10. Where this document says **Done**, that thing exists in the code and was tested. Where it says **Action needed** or **ULSU to confirm**, it is not finished and it says who has to finish it.

**How the work was done.**
1. Every page, script, database table and email template in the website was inspected for what personal data it collects, stores, shows, shares or sends.
2. ULSU's published policies were fetched and read: the Privacy Notice (August 2026), the Safeguarding of Children and Vulnerable Adults Policy, the Student Members' Social Media Policy, and the Group Gmail Access and Onboarding Policy. Their titles only were seen for the Code of Conduct, Equal Opportunities Policy, Complaints Handbook, Terms and Conditions, Cookie Policy and the University/ULSU Data Sharing Agreement; these should be read by the committee (see section 2).
3. ULSU does not publish a data protection guide for societies' own websites, and its privacy notice does not say how a society's website should be treated. Where ULSU is silent, this report applies the law (UK GDPR, Data Protection Act 2018, PECR, Data (Use and Access) Act 2025 and others) directly.
4. Code, database and content changes were made, then tested (section 11).

**Status key:** **Done** = built and tested. **Action needed** = the committee must do it. **ULSU to confirm** = needs a decision or written confirmation from ULSU.

---

## 1. Summary

| # | Area | Before | Now | Status |
|---|---|---|---|---|
| 1 | Privacy notice | None | Full notice at `privacy.html`, matched to what the code collects; members must read it and are asked again when it changes | Done |
| 2 | Cookies and visit counting | Every visitor was counted with a stored random ID whether or not they agreed | Opt-in banner and settings page; counting only after consent; ID deleted if consent is withdrawn; Do Not Track / Global Privacy Control respected | Done |
| 3 | Third parties receiving visitors' IP addresses | Google Fonts (loaded on every page) and the jsDelivr CDN (loaded the login library on 28 pages, unpinned version) | Both removed. Fonts and the library are hosted with the site and the library is pinned to one version | Done |
| 4 | Right of access and portability | None | Members download all their data instantly; the committee can produce a file for anyone | Done |
| 5 | Right to erasure | Committee could delete a profile row only; login and linked data survived | One committee action erases the login and everything linked, removes copies kept by email address, anonymises what must stay, and lists what needs checking by hand | Done |
| 6 | Other rights, complaints and concerns | None | Public "Your data rights" form (no account needed) feeding a dashboard queue with a one-month deadline, overdue warnings and notes; a "report a concern" route | Done |
| 7 | Retention | Nothing was ever deleted | Written schedule; automatic clean-up function; inactive-account review tool | Done (see 10.5) |
| 8 | Email | No sender identification or opt-out | Every email says who sent it, why, and links to the privacy notice and data rights; society updates can be switched off; the email centre skips people who opted out | Done (edge functions must be redeployed, 10.2) |
| 9 | Sensitive data | Optional "country of heritage" and mood check-ins with no notice | Plain-language notices; explicit-consent wording; "not a crisis service" and where to get urgent help | Done |
| 10 | Safeguarding | No page or route | Safeguarding page built from ULSU's policy (Safeguarding Officers, wellbeing contacts, Prevent) | Done; contact person needed (10.8) |
| 11 | Terms and community rules | None | Terms of use aligned to ULSU's Code of Conduct and social media policy, including a ban on patient information and a takedown route | Done |
| 12 | Accessibility | No statement | Accessibility statement; unlabelled search and file inputs fixed | Done; independent audit recommended |
| 13 | Society identity | Not stated on the site | Every page footer states LACMS is a society of ULSU and links the legal pages | Done |
| 14 | Controller arrangement with ULSU | Unstated | Notice names LACMS as responsible with ULSU's DPO overseeing | **ULSU to confirm** |
| 15 | Contracts, registrations and account security | n/a | See section 10 | **Action needed** |

---

## 2. Lincoln Students' Union's published requirements and how the website lines up with them

This is a comparison against ULSU's published documents. **No agreement or contact with ULSU has taken place yet.**

| ULSU document | What it says (as read) | How the website lines up |
|---|---|---|
| **Privacy Notice (08/26)**: ULSU is data controller for SU activity; DPO is `compliance@lincolnsu.com`; complaints `complaints@lincolnsu.com`; rights include access, correction, deletion, restriction/objection, withdrawing consent, portability; SARs answered within one month; direct right to complain to the controller first, acknowledged within 30 days (DUAA); marketing via consent or charity soft opt-in with free opt-out; children's data minimised; retention: membership records for involvement + up to 6 years, enquiries up to 2 years | Our notice uses the same rights list, the one-month time limit and the 30-day complaint acknowledgement; names the ULSU DPO and complaints contacts; email opt-out in place; children's data not collected knowingly. Our retention periods are shorter than ULSU's for data we hold (ULSU keeps the master membership record). | Done / **ULSU to confirm** the controller wording |
| **Safeguarding of Children and Vulnerable Adults Policy (04/25)**: committee members are "Student Volunteers" and must report concerns immediately to the Safeguarding Officers (Group Chief Executive and Deputy); do not investigate or promise confidentiality; wellbeing concerns go to University Student Wellbeing (01522 886400); Prevent duty is escalated by the Chief Executive; records kept with restricted access | `safeguarding.html` states this route, the urgent-help numbers and the Prevent escalation; dashboard flags safeguarding requests with a reminder to pass them to ULSU and not investigate; chat reports kept as safeguarding records | Done |
| **Student Members' Social Media Policy (08/26)**: groups are acting under ULSU's auspices; content must be professional; no harassment, discrimination, explicit content, defamation; no unapproved use of the ULSU name or logo; handover of social media logins to ULSU each year; MFA recommended; AI content must not deceive or impersonate; "mini websites" are managed via the Student Dashboard | Terms of use prohibit each of these (including deceptive AI content). The site does **not** use the ULSU logo. | Done; see 10.7 for logins, MFA and whether ULSU wants to approve this independent website |
| **Group Gmail Access and Onboarding Policy (09/25)**: societies must use their official ULSU-managed address (not personal addresses); credentials not shared outside the elected committee; annual handover; MFA mandatory | The website publishes and sends from `acms@lincolnsu.com`. | **Action needed**: every service account behind the site must use that official address (10.7) |
| Code of Conduct 2026-27, Equal Opportunities Policy, Complaints Handbook, Terms & Conditions, Cookie Policy, UL/ULSU Data Sharing Agreement | **Not read in full** (titles and links only) | The terms and accessibility pages point to ULSU's complaints route and reflect the equality principle | **Action needed**: committee to read and confirm nothing conflicts |

---

## 3. Legal framework

| Law | What it requires of a society like LACMS | What was done | Status |
|---|---|---|---|
| **UK GDPR and Data Protection Act 2018**: lawful, fair and transparent processing | A lawful basis for each use; plain-language notice at collection | Lawful basis table in the notice; short notices added beside the forms that collect data (account request, professional request, Sankofa application, mentor application, event feedback, nominations, gallery uploads, check-ins) | Done |
| Purpose limitation, data minimisation | Collect only what's needed, only use it for the stated purpose | Student number justified and limited (matching ULSU's membership list, visible only to approvers); heritage optional; no analytics without consent; the Sankofa matching data is used for matching only | Done |
| Accuracy | Keep data correct; let people correct it | Members edit their own profile; correction requests via the form | Done |
| Storage limitation | Do not keep data longer than needed | Retention schedule (section 6), `privacy_purge_expired()`, inactive-account tool | Done (run schedule: 10.5) |
| Integrity and confidentiality (Art. 32) | Appropriate security | Section 7 | Done / **Action needed** for account security |
| Accountability and records (Art. 5(2), Art. 30) | Show compliance; keep a record of processing | This report; section 4 is the record of processing; request log with outcomes | Done |
| Special category data (Art. 9) | Extra condition needed (e.g. explicit consent) | Heritage (ethnic origin) optional with explicit consent wording; wellbeing mood data optional with notice | Done |
| Data subject rights (Art. 15 to 22) | Respond within one month, free | Self-service export and request form; dashboard queue with deadlines (section 8 is the procedure) | Done |
| Processors (Art. 28) and transfers (Ch. V) | Written contracts; safeguards for non-UK transfers | Processors listed (section 5); notice discloses them | **Action needed** (10.3) |
| Breach reporting (Art. 33 and 34) | ICO within 72 hours if risk; tell individuals if high risk | Procedure in section 8.3; telling ULSU's DPO is recommended but not yet agreed | **Action needed** to rehearse (10.9); telling ULSU's DPO is recommended but not yet agreed |
| DPIA (Art. 35) | Assess high-risk processing | Summary DPIA in Appendix A (wellbeing, heritage, messaging) | Done / **ULSU to confirm** |
| Children (Art. 8, ICO Children's code) | Care with any child's data | The site is for adults and does not set out to collect children's data; the privacy notice has no separate children's section (at the committee's request), so this is a small residual gap | Done / review |
| DPO (Art. 37) | Required only for public authorities / large-scale special category | Not required for a society; ULSU's DPO oversees | n/a |
| **Data (Use and Access) Act 2025** | Controller complaints procedure; SAR "reasonable and proportionate" search and stop-the-clock; new cookie exceptions (statistical, appearance) | Complaints route and 30-day acknowledgement in the notice; SAR procedure reflects it; **cookies stay opt-in** so nothing depends on the new exceptions. Commencement dates of some provisions should be checked on legislation.gov.uk | Done / verify dates |
| **PECR 2003** (cookies, storage and electronic marketing) | Consent for non-essential storage; identify sender; opt-out for marketing | Banner and settings, opt-in analytics; email sender identification and opt-out | Done |
| **Equality Act 2010** | No discrimination; reasonable adjustments | Accessibility statement and request route; terms prohibit discrimination | Done; audit recommended (10.10) |
| **Online Safety Act 2023** | Services with user-to-user features (chat, comments, uploads) must assess illegal-content risk, offer reporting and complaints, and have clear terms | Reporting in chat, a "report a concern" form and email; terms explain moderation; short risk assessment in Appendix B | Done; review yearly |
| **Safeguarding law and duties** (Children Acts 1989 and 2004, Care Act 2014, Safeguarding Vulnerable Groups Act 2006, Counter-Terrorism and Security Act 2015) | Report concerns; safe recruitment; Prevent | Via ULSU's policy, as above | Done; **Action needed** (10.8) |
| **Copyright, Designs and Patents Act 1988** | Remove infringing content promptly | Terms contain a takedown route; uploaders warrant their rights | Done |
| Defamation, harassment and communications offences | Don't host unlawful content | Terms and moderation | Done |
| **Higher Education (Freedom of Speech) Act 2023** | Duties fall on universities and students' unions | Terms welcome lawful debate and ban harassment; no further action in code | ULSU to confirm if it needs anything from societies |
| Professional confidentiality (GMC guidance) | Never disclose identifiable patient information | Terms prohibit patient information anywhere on the site | Done |
| Payments | Cards and money | Not applicable: membership is bought on ULSU's site; the website never handles payments | n/a |

---

## 4. Record of processing (what personal data the website holds)

| Data (tables) | People | Purpose | Lawful basis | Who can see it | Retention |
|---|---|---|---|---|---|
| Account requests: name, university email, student number, course, year, note (`account_requests`, `pending_members`) | Students | Check membership, create account | Legitimate interests / pre-contract steps | Committee (approvers) | Deleted 12 months after decision |
| Member record: name, course, year, membership number, type, committee role (`members`) | Members | Run membership, hub, perks | Legitimate interests | The person; committee per access rules | While a member; inactive 12 months reviewed |
| Profile: LinkedIn, bio (`member_profiles`) | Members | Network | Legitimate interests | Signed-in members | As above |
| Student number (`members`, `account_requests`) | Members | Match to ULSU list | Legitimate interests | The person; approvers | As above |
| Professionals: name, email, title, organisation, category, specialty, bio, photo, LinkedIn (`network_professionals`, `professional_requests`) | Professionals | Approve and show in Network | Consent (Network); legitimate interests | Signed-in members (Network) | Request 12 months after decision; profile while active |
| Mentor applications (`sankofa_mentor_applications`) and guest mentors (`sankofa_guest_mentors`) | Doctors | Review; place in Circles | Legitimate interests | Committee; Circle members see name/role | 24 months |
| Sankofa applications and Hub: interests, heritage (optional), goals, check-ins (mood), posts, RSVPs, XP (`sankofa_*`) | Participants | Matching and Circles | Legitimate interests; **explicit consent** for heritage and mood | Sankofa managers; Circle mentors (check-ins and shared goals) | While participating; erased on request |
| Messages, blocks, reports (`chat_*`) | Members | Messaging; moderation | Legitimate interests; legal obligation / vital interests | Participants; committee for reported messages only | Deleted messages 30 days; reports 24 months after resolution |
| Events, nominations, comments, likes, resources, perk use, XP and badges (`event_registrations`, `motm_*`, `news_*`, `resource_*`, `discount_usage`, `member_*`) | Members | Run activities | Legitimate interests | Committee; public where published | While member |
| Event feedback (`event_feedback`) | Members and guests | Improve events | Legitimate interests (anonymous option) | Committee; partners see anonymised results | Anonymised on erasure |
| Visit counts (`page_views`, `qr_scans`) | Visitors | Understand site use | **Consent** (page views); none identifying (QR scans) | Committee | 14 months |
| Email records (`email_log`, `*_emails`) | Recipients | Prove what was sent | Legitimate interests | Committee | 24 months |
| Admin previews (`view_as_log`) | Members | Accountability | Legitimate interests | Committee | 12 months |
| Data requests (`compliance_requests`) | Requesters | Meet legal duties | Legal obligation | Committee | 3 years after closing |
| Preferences and acknowledgements (`email_preferences`, `privacy_acknowledgements`) | Members | Respect choices; show notice changes | Legal obligation / consent | The person; committee (opt-out list) | While member |
| Gallery and committee content (`gallery_photos`, `committee_members`, `motm_winners`) | Members, committee | Publicise society | Consent / legitimate interests | Public | Until removed on request |

---

## 5. Processors and transfers

| Provider | Role | Data | Needed |
|---|---|---|---|
| **Supabase** | Database, login, file storage, edge functions | All account and activity data | Sign/accept its Data Processing Addendum; confirm project **region**; note UK transfer mechanism |
| **GitHub Pages** | Hosts the static pages | Visitor IP address in server logs | Accept GitHub's data protection terms; enforce HTTPS |
| **Resend** | Sends email | Recipient address, email content | Sign/accept DPA; confirm transfer mechanism (US) |
| Domain registrar and DNS for lincolnacms.uk | Domain | Domain contacts | Use the official society address (10.7) |
| ULSU | Related controller (membership, DPO oversight) | Membership list | Confirm arrangement (10.1) |

**Note:** at the committee's request the privacy notice no longer has a section naming these providers or describing transfers outside the UK. UK GDPR Article 13 normally expects a notice to say who receives personal data and about any overseas transfers, so this is an open risk (10.3).  **No other third-party scripts, fonts, analytics, advertising or social widgets load on the site** (verified by scanning every page).

---

## 6. Retention schedule

Implemented in `privacy_purge_expired()` (migration 110) and published in the notice.

| Data | Kept for |
|---|---|
| Accounts, profiles, activity, Sankofa records | While a member; inactive 12 months reviewed |
| Approved/declined account and professional requests | 12 months after decision |
| Mentor applications | 24 months |
| Email logs | 24 months |
| Anonymous analytics | 14 months |
| Deleted chat messages | 30 days |
| Closed chat/safeguarding reports | 24 months after resolution (longer if a safeguarding or legal reason) |
| Admin preview records | 12 months |
| Resource PIN attempts | 30 days |
| Data requests and complaints | 3 years after closing |

ULSU's own notice keeps membership records for the period of involvement plus up to 6 years. The periods above are for data **this website** holds; the committee should confirm with ULSU that they are acceptable.

---

## 7. Security

**Verified in this review**
- All 84 database tables have row-level security enabled (checked across every migration). Only a short list of public forms and public content can be written or read without signing in (page views, account request, professional request, mentor application, and public read of published content).
- Passwords are handled and hashed by Supabase Auth; the website never sees them.
- Private chat messages are never shown in the committee's "view as" preview; previews are read-only and logged.
- Third-party code removed: Google Fonts and the jsDelivr login library are now served from the site and the library is pinned (`js/vendor/supabase-js-2.118.0.min.js`).
- Every erasure, export, request and clean-up action runs through administrator-only database functions (migration 110); none of the new tables is directly readable.
- Rate limits on the public request form (5 per email per day, 100 per hour overall).

**Known limits (be honest with ULSU about these)**
- Sessions stay signed in until the person logs out (a deliberate convenience choice). On shared computers people should log out; the committee may prefer a shorter session.
- GitHub Pages cannot send security headers (Content-Security-Policy, HSTS). The pages are static and use pinned local scripts, but a header-setting layer (for example Cloudflare in front) would harden it further.
- Passwords require 8 characters; Supabase can also block known-leaked passwords (a dashboard setting, 10.4).
- The website's public Supabase key is in the page source. That is normal and safe only because row-level security is on; do not ever put the `service_role` key anywhere in the code.

---

## 8. Procedures (people, not code)

### 8.1 Handling a data request (one month)
1. Requests arrive in **Dashboard, Data & Privacy** (or by email to `acms@lincolnsu.com`; add emailed ones to the dashboard through the form yourself).
2. Set status to **Checking identity** and confirm it is the person: reply to the address on their account. Never release data to an unverified address.
3. **Copy of data:** press *Download their data*, send the file securely to the verified address, delete your copy, mark Completed.
4. **Correction:** fix it in Dashboard, reply, mark Completed.
5. **Deletion:** press *Erase their data* (type ERASE). Read the "still to check" list (public winners wall, uploaded files, retained chat reports) and deal with each. Mark Completed. Explain anything kept and why.
6. **Objection / restriction / withdraw consent:** act, reply, record in the note.
7. If you need more time (complex or many requests) tell them within the month; the law allows up to two more months.
8. **Complaints:** acknowledge within 30 days; copy the complaint to `complaints@lincolnsu.com` and `compliance@lincolnsu.com` if it concerns ULSU.
9. Never put personal data in the Note field.

### 8.2 Safeguarding
*Recommended procedure, based on ULSU's published policy. It has not yet been discussed or agreed with ULSU.*

Do not investigate. Listen, do not promise confidentiality, record date/time/what was said, and **report immediately** to ULSU's Safeguarding Officers (Group Chief Executive or Deputy Chief Executive); in an emergency call 999.

### 8.3 Personal data breach
1. Contain it (change passwords/keys, remove access, pause the feature).
2. Consider telling ULSU's DPO (`compliance@lincolnsu.com`) straight away. This is recommended, not yet agreed with ULSU.
3. Record what happened, what data, how many people, and what you did.
4. If there is a risk to people, the ICO must be told **within 72 hours** of becoming aware (ico.org.uk/make-a-complaint, "report a breach", 0303 123 1113). If the risk is high, tell the people affected without undue delay.
5. Keep the record whether or not you report it.

### 8.4 Annual handover (every June to September)
- Move all service logins (Supabase, GitHub, Resend, domain) to the official society address and hand details to ULSU as its policies require; re-enrol MFA.
- Run **Data & Privacy, Run clean-up now**, and review **Inactive accounts**.
- Review the privacy notice, bump the version in `js/privacy.js` and `privacy.html` if anything changed.
- Committee members complete ULSU's data protection and safeguarding training.

---

## 9. What changed in the code

**New pages:** `privacy.html`, `cookies.html`, `terms.html`, `accessibility.html`, `safeguarding.html`, `data-request.html`.
**New scripts:** `js/privacy.js` (consent, analytics, data-rights form, member panel), `js/privacy-admin.js` (dashboard).
**Database:** `db/migrations/110-data-protection-compliance.sql`.
**Changed:** every page (footer legal links, privacy script, version string); `member-hub.html` (My data and privacy); `president-dashboard.html` (the committee dashboard; Data & Privacy section); `js/main.js` (visit counter moved behind consent); `js/members.js` (privacy notice gate with versioning, also for professionals); `js/email-centre.js` and the two email edge functions (opt-out, sender identification); `js/sankofa-hub.js`, `js/members.js`, `js/feedback.js`, `request-account.html`, `request-professional-account.html`, `member-sankofa.html`, `motm.html`, `gallery.html`, `mmg.html` (notices at the point of collection); `css/styles.css` (self-hosted fonts and new styles); all pages (login library self-hosted, unlabelled inputs fixed).
**New static assets:** `css/fonts/*` (Inter and Fraunces, SIL Open Font License) and `js/vendor/supabase-js-2.118.0.min.js`.

---

## 10. Open actions (nothing here can be done in code)

| # | Priority | Action | Owner |
|---|---|---|---|
| 10.1 | **High** | **Make first contact with ULSU** (none has happened yet) and get **written confirmation** of who is the data controller for the society's website (LACMS alone, ULSU, or joint) and that the wording in section 1 of the privacy notice is right. Ask whether ULSU wants a data-sharing or processing agreement with LACMS. | Committee, with ULSU Student Communities and DPO (`compliance@lincolnsu.com`) |
| 10.2 | **High** | **Deploy:** run migration 110 in Supabase; redeploy the two email edge functions (`send-account-email`, `send-member-email`); publish the site. Until 110 runs, the request form and "My data" tools tell people to email instead. | Site administrator |
| 10.3 | **High** | Accept the data processing terms with **Supabase**, **Resend** and **GitHub**; note each provider's transfer safeguard; confirm the Supabase project **region**. Decide with ULSU whether the privacy notice should describe recipients and overseas transfers (it currently doesn't). | Site administrator |
| 10.4 | **High** | Switch on **MFA** for every account behind the site (Supabase, GitHub, Resend, domain registrar, and every committee member with dashboard access). In Supabase enable leaked-password protection. Confirm "Enforce HTTPS" is on in GitHub Pages. | Site administrator |
| 10.5 | Medium | Enable the **pg_cron** extension in Supabase, then run migration 110 again (it then schedules the nightly clean-up), or press *Run clean-up now* monthly. Review inactive accounts annually. | Committee |
| 10.6 | Medium | Confirm with ULSU the **ICO registration** position: is LACMS covered by ULSU's data protection fee, or does it need its own? | Committee, with ULSU |
| 10.7 | **High** | **Account continuity and ULSU policies:** make sure every service login uses `acms@lincolnsu.com` (not a personal address) and is handed to ULSU at each annual handover; ask ULSU whether this independent website needs its approval under the social media policy; keep the ULSU logo off it unless approved (it currently isn't used). The site is currently run by a single volunteer, so the society needs a second trusted administrator so its data isn't stranded when committees change. | Committee, with ULSU |
| 10.8 | **High** | **Safeguarding:** agree who on the committee is the point of contact for passing safeguarding concerns to ULSU's Safeguarding Officers; committee members to complete ULSU's safeguarding and data protection training. | Committee |
| 10.9 | Medium | Rehearse the breach procedure once (who to call, where the log is). | Committee |
| 10.10 | Medium | Commission an **independent accessibility audit** (WCAG 2.2 AA) and update the accessibility statement with the result. | Committee |
| 10.11 | Medium | Read the ULSU documents only skimmed in this review (section 2) and tell us if anything conflicts. | Committee |
| 10.12 | Medium | Confirm winners' **consent before publishing** Member of the Month entries and committee photos; the notice says winners are shown but does not claim a recorded consent. | Committee |
| 10.13 | Low | Review the privacy notice, terms and this report every year, or whenever a new feature collects new data (for example update `privacy.html` and bump `PRIVACY_VERSION` in `js/privacy.js`). | Committee |
| 10.14 | Low | Check the commencement dates of the Data (Use and Access) Act 2025 provisions on legislation.gov.uk before relying on any date mentioned in this report. | Site administrator |

---

## 11. How this was verified

- **Database (migration 110):** 62 automated checks against a clean PostgreSQL instance with stand-in tables (public submissions and rate limit, permissions for anonymous, member and administrator, export contents and exclusion of other people's data, full erasure with cascades and anonymisation, retention deletes old and keeps new, inactive accounts, email preferences, privacy acknowledgement). All passed. It was **not** run against the live Supabase database, so run the checks in section 10.2 after deploying.
- **Browser:** consent banner (no storage or recording before consent, deletion of the visitor ID on withdrawal, Do Not Track), cookie settings, data-rights form (validation, honeypot, submission, confirmation), members hub "My data and privacy" (download, email preference, deletion request, request list), committee dashboard "Data & Privacy" (queue, overdue and safeguarding flags, status save, export, erase, clean-up, inactive accounts). These ran against a mock server, not the live back end.
- **Static checks:** every local link, script and font referenced by every page resolves; no third-party script, font, iframe or tracker is loaded; form controls labelled; all pages have a language and title, and all pages except the QR redirect and partner-results pages have a skip link.
- **Not done:** the edge functions could not be run locally (no Deno), so their changes are text edits that need a test email after redeploying; no independent legal review; no accessibility audit; no penetration test.

---

## Appendix A: Data protection impact assessment (summary)

**Processing:** Sankofa mentoring Hub (wellbeing check-ins, optional heritage), and private messaging.

| Risk | Likelihood | Severity | Controls in place | Residual |
|---|---|---|---|---|
| Wellbeing information seen by the wrong people | Low | High | Visible only to the person, Circle mentors and Sankofa managers; optional; notice at submission; erasable | Low |
| Sensitive heritage data misused or leaked | Low | High | Optional; explicit consent wording; used only for matching; access limited to Sankofa managers; erasable | Low |
| Abuse in messages or comments | Medium | Medium | Report in chat, form and email; block; suspend; committee review; terms | Low |
| Data kept longer than needed | Medium | Medium | Retention schedule; purge; inactive-account review | Low (needs 10.5) |
| Account takeover | Low | High | Supabase hashing; row-level security | Medium until MFA (10.4) |
| One person holding the keys | Medium | High | None in code | **High until 10.7** |

Recommended: ULSU's DPO reviews and signs off this assessment.

## Appendix B: Illegal-content risk assessment (Online Safety Act), short form

The site is a small, members-only service with private messaging, comments, resource uploads and a gallery. Users are verified students or approved professionals. Risk categories considered: harassment and abuse, hate, child safety, terrorism, intimate-image abuse, fraud, copyright. Likelihood is low because access is restricted to approved accounts and the audience is small. Measures: approval before account creation, report buttons and a report form, block and suspend tools, a committee review process, clear terms, escalation to ULSU and the police where required, and removal of content that breaks the terms. Review annually and after any serious incident. Record of reports: the dashboard's Message Reports and Data & Privacy sections.

## Appendix C: Sources read

- ULSU Privacy Notice (08/26): `assets-cdn.sums.digital/LN/documents/Website_Policies/ULSU_Privacy_Notice.pdf`
- ULSU Group Safeguarding of Children and Vulnerable Adults Policy (04/25)
- ULSU Group Student Members' Social Media Policy (08/26)
- ULSU Group Gmail Access and Onboarding Policy for Sports and Societies (09/25)
- Index of ULSU policies: `lincolnsu.com/your-union/how-we-are-run/su-policies`
- ICO guidance on storage and access technologies (cookies) as updated for the Data (Use and Access) Act 2025
