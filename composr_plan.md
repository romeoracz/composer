Prompt: ComposR – Automated Personal Social Posting SaaS

Objective
Build ComposR, a browser-based SaaS for daily automated social posting across LinkedIn, Instagram, Facebook, X (Twitter), TikTok.
	•	Designed for personal branding + Memristive exposure.
	•	Posts are generated from master prompt instructions, user-supplied events, or recommended topics from email inboxes.
	•	User reviews/edits each post every morning, previews them per platform, and then approves publication.
	•	Must support delayed publishing (7-minute undo), API analytics ingestion, simple dashboard, and history of posts.

⸻

1. Architecture
	•	Frontend:
	•	React (Next.js) or SvelteKit for fast modern SPA.
	•	TailwindCSS for styling.
	•	Shadcn/ui or Radix for clean UI components.
	•	Backend:
	•	Node.js + Express (or NestJS for structure).
	•	REST + WebSockets for live preview and undo timers.
	•	PostgreSQL (with Prisma ORM) for storage of posts, history, analytics.
	•	AI Integration:
	•	GPT-5 via OpenAI API.
	•	Separate prompt box UI for “Master Formatting Prompt” that can be updated independently of daily posts.
	•	Generation pipeline: event seed → GPT-5 formatting per platform → previews.
	•	Email Ingestion:
	•	IMAP/POP3 connector OR Gmail/Outlook API.
	•	Daily scan → classify relevant items (via GPT-5 or regex rules).
	•	UI shows recommended topics with “Use as seed” toggle.
	•	Publishing Layer:
	•	Each platform connected via official APIs:
	•	LinkedIn Marketing Developer Platform.
	•	Meta Graph API (for IG + FB).
	•	Twitter/X API v2.
	•	TikTok Business API.
	•	All tokens stored securely (Vault or encrypted DB).
	•	Analytics Collector:
	•	Post-publication: fetch likes, comments, shares, reach per API.
	•	Store and display in dashboard.

⸻

2. Core Features

A. Daily Workflow
	1.	Morning dashboard → lists recommended posts:
	•	Seeds from email inbox.
	•	Manually supplied events.
	•	AI-suggested trending topics.
	2.	Generate drafts per platform (using master formatting prompt).
	3.	Preview page:
	•	Side-by-side platform-specific previews (show word count limits, image/video attachments).
	•	Edit inline if needed.
	4.	Approval → sends to queue.
	5.	Undo buffer: 7-minute delay with cancel/edit option before hitting APIs.

B. Master Prompt System
	•	Separate settings page with text box to supply/update Master Formatting Prompt.
	•	Stored in DB + version-controlled.
	•	Daily generator always references current version.

C. Post History
	•	Timeline view with thumbnails.
	•	Click to expand → see original draft, edited final, platform previews.
	•	Stored interaction stats linked.

D. Analytics Dashboard
	•	Metrics aggregated across platforms:
	•	Engagement (likes, comments, reposts/shares).
	•	Reach/impressions (where available).
	•	Growth trendlines.
	•	Filters: by platform, by date range, by content type.
	•	Export CSV/PDF.

E. API Connection Settings
	•	“Integrations” page:
	•	Input boxes for each platform’s API keys/tokens.
	•	Test connection button → display status.
	•	Refresh/re-auth options.

⸻

3. UX / UI Design
	•	Home (Daily Review):
	•	Left sidebar: inbox-derived seeds + manual input.
	•	Center panel: AI-generated drafts per platform.
	•	Right panel: preview toggles (LinkedIn/X/IG/FB/TikTok).
	•	Approve / Edit / Discard buttons.
	•	Preview Modal:
	•	True-to-platform visual (LinkedIn card, Twitter thread, IG feed post).
	•	Word/character counters.
	•	Analytics Page:
	•	Graphs (Recharts or Chart.js).
	•	Top 5 performing posts.
	•	Engagement per platform over time.
	•	History Page:
	•	Grid of thumbnails.
	•	Mini-previews on hover.
	•	Integrations Page:
	•	Dialogs for API tokens.
	•	Connection test result (green/red).
	•	Settings:
	•	Master Prompt text box (large editor with save/version).
	•	Time of day default (when to generate posts).
	•	Undo delay duration (default 7 minutes).

⸻

4. Technical Requirements
	•	Delay Queue:
	•	Redis or BullMQ to manage 7-minute publish delay.
	•	Cancel job API to support undo.
	•	Preview Renderer:
	•	Templates styled to mimic each platform.
	•	Show truncated posts if over limits.
	•	Security:
	•	OAuth for platform APIs.
	•	Encrypted storage for access tokens.
	•	Admin login for single user.
	•	Scalability:
	•	Initially single-user, but build SaaS-ready multi-tenant architecture (user accounts, organisation IDs).

⸻

5. Development Stages

MVP (6–8 weeks)
	1.	Auth + Integrations page with API connections.
	2.	Master Prompt editor + seed input.
	3.	AI draft generation (GPT-5).
	4.	Previews + edit + approve + 7-minute delay publishing to LinkedIn + Twitter.
	5.	Basic history log.

Phase 2
	•	Add Instagram, Facebook, TikTok APIs.
	•	Analytics ingestion + dashboard.
	•	Email inbox parser (recommendation engine).
	•	Export functions.

Phase 3
	•	Multi-user SaaS model.
	•	Collaboration (team members suggest, owner approves).
	•	Scheduling flexibility (not only daily).

⸻

6. Deliverables for Developer (ComposR)
	•	Frontend: React/Next.js + Tailwind, pages: Home, Preview, History, Analytics, Integrations, Settings.
	•	Backend: Node.js/Express + Postgres/Prisma, Redis for delay queue.
	•	Integrations: LinkedIn, Meta Graph, Twitter v2, TikTok APIs.
	•	AI: OpenAI GPT-5 API.
	•	Deployment: Dockerised, deployable to AWS/GCP/Azure.
7. File Output

Save this plan into composr_plan.md with all sections above intact.
