## ComposR Development Plan (Progressive, No-Regression, No-Code)

### Goals and Principles
- **Zero degradation mandate**: Every change must keep existing functionality stable or improved.
- **Progressive delivery**: Ship small, independent, value-focused stages behind feature flags.
- **Quality gates**: Automated checks, manual reviews, and non-regression tests at each stage.
- **Observability-first**: Logging, tracing, metrics embedded from day one.
- **Security-by-default**: Secrets handling, OAuth scopes, least privilege, encrypted storage.
- **Data-safety**: Migration plans with roll-forward/back, backups, idempotent jobs.

### Environments and Workflow
- **Environments**: Local → Dev (shared) → Staging (prod-like, seeded data) → Production.
- **Branching**: Trunk-based with short-lived feature branches; all functionality behind feature flags.
- **Release cadence**: Weekly milestones within each phase; hotfix branches only for critical issues.
- **CI/CD gates**: Static checks → unit tests → integration tests → E2E smoke → security scan → approval gates → promote.

---

## Phase MVP (Weeks 1–8)

### Stage 0: Project Scaffolding and Foundations
- **Objective**: Create baseline repo structure, CI/CD, and environment scaffolding.
- **Scope**:
  - Frontend app skeleton with routing and design system.
  - Backend service skeleton with REST and WebSocket endpoints placeholders.
  - Database initialization and ORM baseline models (placeholders only; minimal tables to start).
  - Redis connection placeholder for delay queue.
  - Containerization and local compose for services.
  - CI: lint, format, type-check, test, security scans.
- **Deliverables**:
  - Working local dev environment with one-step startup.
  - CI pipeline executing on PR and main.
  - Environment configs and secret placeholders.
- **Dependencies**: None.
- **Acceptance criteria**:
  - Local start completes; health endpoints respond; CI green on empty tests.
  - No hardcoded secrets; configuration management documented.
- **Non-regression gates**:
  - Baseline smoke test suite locked; must stay passing.
- **Risks**: Over-scaffolding; mitigate by keeping minimal skeleton with extension points.

### Stage 1: Authentication and Access Control (Single User to Start)
- **Objective**: Secure access to app as admin-only (single user), designed to expand later.
- **Scope**:
  - Login/logout, session handling, CSRF protections.
  - Access guardrails for pages and APIs.
  - Admin-only role baseline, feature flags ready.
- **Deliverables**:
  - Protected routes; unauthenticated redirected to login.
  - Session expiration and refresh policy documented.
- **Dependencies**: Stage 0.
- **Acceptance criteria**:
  - Auth flows covered by E2E smoke tests.
  - No unauthenticated access to protected endpoints.
- **Non-regression gates**:
  - Auth E2E suite must pass on every merge.
- **Risks**: Session fixation; mitigate with secure cookies and rotation.

### Stage 2: Integrations Settings UI and Secret Storage (LinkedIn, X)
- **Objective**: Provide UI to input and test API credentials; store secrets securely.
- **Scope**:
  - Integrations page with provider cards for LinkedIn and X.
  - Secret storage via encrypted at-rest fields; rotation and redaction policy.
  - “Test connection” action using sandbox/mocked calls where possible.
- **Deliverables**:
  - Persisted, encrypted credentials; redacted in UI.
  - Connection status indicators with last-verified timestamp.
- **Dependencies**: Stages 0–1.
- **Acceptance criteria**:
  - Secrets never logged; access controlled; audit trail stored.
  - Connection test results reproducible and actionable.
- **Non-regression gates**:
  - Secret-leak detection in CI (greps, scanners) stays green.
- **Risks**: API rate limits; mitigate with exponential backoff and mock mode.

### Stage 3: Master Prompt System (Versioned)
- **Objective**: Independent “Master Formatting Prompt” editor with versioning and audit.
- **Scope**:
  - Settings page section for prompt editing; version history; revert.
  - Metadata: author, timestamp, change notes.
  - Read-only access from generator; “current active version” pointer.
- **Deliverables**:
  - Prompt CRUD and versioning with soft delete.
  - Change log and diff view (textual).
- **Dependencies**: Stages 0–2.
- **Acceptance criteria**:
  - Generator reads only active version; updates are atomic.
  - Reverting does not affect prior generated drafts historically.
- **Non-regression gates**:
  - Prompt read contract test fixed; cannot break without explicit migration.
- **Risks**: Prompt drift affecting outputs; mitigate with prompt evaluation notes and rollback.

### Stage 4: Seed Intake (Manual events)
- **Objective**: Allow users to enter seed events manually for the day.
- **Scope**:
  - Left sidebar input and list of seeds; tagging and simple categories.
  - Persistence with editable states (draft/published seed).
- **Deliverables**:
  - CRUD seeds; ordering; simple filters.
- **Dependencies**: Stages 0–3.
- **Acceptance criteria**:
  - Seeds persist across sessions; edits tracked.
- **Non-regression gates**:
  - Seed CRUD integration tests remain passing.
- **Risks**: UX complexity; mitigate with minimal inputs first.

### Stage 5: AI Draft Generation (LinkedIn, X) Using Active Prompt
- **Objective**: Generate per-platform drafts from seeds using current prompt.
- **Scope**:
  - Generate button; background job per seed; status indicators.
  - Rate limiting; retries; idempotency keys.
  - Content fields: text, hashtags, media suggestions metadata only (no uploads yet).
- **Deliverables**:
  - Draft records linked to seeds and platforms; provenance metadata.
- **Dependencies**: Stages 0–4.
- **Acceptance criteria**:
  - Generation errors surfaced with retry; no duplicate drafts for same seed+platform unless user requests regeneration.
- **Non-regression gates**:
  - Contract tests for generator inputs/outputs schema.
- **Risks**: Cost spikes; mitigate with caching of prompt+seed hash and token budgeting.

### Stage 6: Preview and Inline Editing (LinkedIn, X)
- **Objective**: Side-by-side previews with platform constraints, inline edits saved as final drafts.
- **Scope**:
  - Character counters, truncation indicators, platform styling templates.
  - Edit-in-place; track original vs edited content.
  - Validation rules for limits per platform.
- **Deliverables**:
  - Preview UI; edited content persisted; change audit stored.
- **Dependencies**: Stages 0–5.
- **Acceptance criteria**:
  - Edits do not overwrite originals; both versions viewable in history.
- **Non-regression gates**:
  - Validation logic unit tests for platform rules.
- **Risks**: Overfitting visuals; mitigate by focusing on constraints, not pixel-perfect clones.

### Stage 7: Approval and 7-Minute Undo Queue (LinkedIn, X)
- **Objective**: Approve posts to queued publication with undo window and cancel support.
- **Scope**:
  - Approve action; job scheduled with 7-minute delay (configurable via settings).
  - Undo/cancel within buffer; edit before publish requeues timer.
  - WebSocket updates for timers on dashboard.
- **Deliverables**:
  - Delay-queue jobs with durable storage; job inspection UI.
- **Dependencies**: Stages 0–6.
- **Acceptance criteria**:
  - Cancelling prevents API calls 100% of the time; race conditions resolved by transactional state changes.
- **Non-regression gates**:
  - Concurrency tests for schedule/cancel/edit; time-travel tests for timers.
- **Risks**: Clock drift; mitigate with server-side authoritative time.

### Stage 8: Publishing (LinkedIn, X) and Basic History Log
- **Objective**: Call platform APIs after delay to publish; store outcomes and history.
- **Scope**:
  - OAuth flows or token-based auth per platform; scoped permissions minimal.
  - Post submission; error handling; idempotency on retries.
  - History page with thumbnails and detail view (original vs edited vs published).
- **Deliverables**:
  - Successful publish to LinkedIn and X in staging; production behind flag.
- **Dependencies**: Stages 0–7.
- **Acceptance criteria**:
  - Published post IDs stored; links to platform view; clear error logs.
- **Non-regression gates**:
  - Contract tests against provider mocks; production guarded by canary flag.
- **Risks**: API policy changes; mitigate with typed client wrapper and provider capability matrix.

---

## Phase 2 (Weeks 9–16)

### Stage 9: Extend Platforms (Instagram, Facebook, TikTok)
- **Objective**: Add additional platforms in parallel tracks with shared publishing contract.
- **Scope**:
  - Provider adapters for Meta Graph (IG/FB) and TikTok Business.
  - Media handling requirements and constraints surfaced in preview.
- **Deliverables**:
  - Platform adapters implemented behind flags; sandbox publishes verified.
- **Dependencies**: Stage 8.
- **Acceptance criteria**:
  - Publish workflows pass in staging; fail-safe toggles per provider.
- **Non-regression gates**:
  - Shared provider test suite runs for all adapters.
- **Risks**: Media upload complexity; mitigate with preflight checks and chunked upload retries.

### Stage 10: Analytics Ingestion and Dashboard
- **Objective**: Collect and display post-publication metrics across platforms.
- **Scope**:
  - Scheduled fetchers for likes, comments, shares, reach where available.
  - Normalization layer; storage schema for time-series metrics.
  - Dashboard with trendlines, top posts, and filters.
- **Deliverables**:
  - Aggregated metrics shown with date/platform/content filters; export CSV.
- **Dependencies**: Stages 8–9.
- **Acceptance criteria**:
  - Metrics integrity checks (sum, min/max) and unit conversions documented.
- **Non-regression gates**:
  - ETL idempotency tests; backfill jobs verified in staging.
- **Risks**: Rate limits; mitigate with incremental cursors and adaptive scheduling.

### Stage 11: Email Inbox Parser and Recommendations
- **Objective**: Suggest seeds from connected inboxes with relevance classification.
- **Scope**:
  - Connectors for IMAP/POP3 or Gmail/Outlook APIs; consent scopes minimal.
  - Daily scan; classification pipeline; deduplication; opt-in suggestions list.
- **Deliverables**:
  - “Recommended topics” panel with toggle to use as seed.
- **Dependencies**: Stage 4, Stage 5.
- **Acceptance criteria**:
  - Precision/recall targets for classification defined; false-positive management.
- **Non-regression gates**:
  - Deterministic sampling tests with fixture mailboxes.
- **Risks**: Privacy concerns; mitigate with on-device or server-side restricted retention policies.

### Stage 12: Exports (CSV/PDF)
- **Objective**: Export history and analytics.
- **Scope**:
  - CSV export for posts/metrics with filters; PDF snapshot for dashboards.
- **Deliverables**:
  - Download endpoints; export logs; rate limiting.
- **Dependencies**: Stage 10.
- **Acceptance criteria**:
  - Exports match on-screen filters; checksum verification.
- **Non-regression gates**:
  - Golden-file tests for exports.
- **Risks**: Large exports; mitigate with async jobs and email links.

---

## Phase 3 (Weeks 17–24)

### Stage 13: Multi-User SaaS and Multi-Tenancy
- **Objective**: Transition from single-user to multi-tenant architecture.
- **Scope**:
  - Tenant model (orgs, users, roles); isolation across data and jobs.
  - Invite flows; role-based access control for suggestions vs approvals.
- **Deliverables**:
  - Tenant-aware services; migration scripts; data backfill.
- **Dependencies**: All prior stages; dedicated migration window.
- **Acceptance criteria**:
  - No data leakage across tenants in tests; tenancy enforced at query and API layers.
- **Non-regression gates**:
  - Row-level filtering tests; tenancy stress tests.
- **Risks**: Migration complexity; mitigate with shadow reads and dual-write transitional period if needed.

### Stage 14: Collaboration Workflow
- **Objective**: Team members suggest posts; owner approves.
- **Scope**:
  - Suggest → review → approve workflow; comments and change requests.
  - Notifications (in-app/email) with preferences.
- **Deliverables**:
  - Collaboration UI, activity log, and permissions checks.
- **Dependencies**: Stage 13.
- **Acceptance criteria**:
  - Audit trail complete and immutable; permission errors handled gracefully.
- **Non-regression gates**:
  - Workflow E2E suite covering role transitions.
- **Risks**: Notification fatigue; mitigate with digest options.

### Stage 15: Scheduling Flexibility
- **Objective**: Beyond daily; calendars and queues.
- **Scope**:
  - Scheduling UI for future timeslots; queue management; bulk actions.
  - Timezone handling and daylight saving correctness.
- **Deliverables**:
  - Reliable scheduled publishing with previews and conflict detection.
- **Dependencies**: Stage 7–8, Stage 13.
- **Acceptance criteria**:
  - Schedule accuracy validated with time-travel tests; editing reschedules atomically.
- **Non-regression gates**:
  - Calendar math test suite.
- **Risks**: Timezone edge cases; mitigate with UTC storage and explicit user TZ settings.

---

## Cross-Cutting Quality Strategy

### Security and Compliance
- **Principles**: Least privilege, short-lived tokens, encrypted at rest/in transit, audit logs.
- **Practices**: Dependency scanning, SAST/DAST, secret scanning, SBOM generation, incident runbooks.

### Observability
- **Logging**: Structured, correlation IDs, PII-safe; log redaction.
- **Metrics**: SLIs for availability, latency, error rates; job success, retries, queue depths.
- **Tracing**: Request spans across frontend, API, database, and jobs.

### Data Management
- **Migrations**: Versioned, reversible; preflight checks; data backups and restore drills.
- **Retention**: Configurable retention for logs, drafts, analytics; GDPR-ready erase workflows.

### Testing Strategy
- **Pyramid**: Unit tests for logic; integration tests for services; E2E for critical paths.
- **Fixtures**: Deterministic provider mocks; golden snapshots for previews and exports.
- **Performance**: Load tests for queue and publishing throughput; frontend Web Vitals baselines.

### Release Safety
- **Feature flags**: Dark launch, canary users, gradual ramp-up.
- **Rollbacks**: Fast revert process; DB-safe rollbacks with compatibility windows.
- **Runbooks**: On-call, incident severity and communication templates.

---

## Milestones Overview
- **Week 1–2**: Stages 0–1 complete; secure skeleton live in dev.
- **Week 3–4**: Stages 2–4; integrations settings, prompt versioning, manual seeds.
- **Week 5–6**: Stages 5–7; generation, preview/edit, undo queue.
- **Week 7–8**: Stage 8; publish LinkedIn/X; history basic.
- **Week 9–12**: Stages 9–10; new platforms; analytics foundation.
- **Week 13–14**: Stage 11; inbox recommendations.
- **Week 15–16**: Stage 12; exports.
- **Week 17–20**: Stage 13; multi-tenancy migration.
- **Week 21–22**: Stage 14; collaboration.
- **Week 23–24**: Stage 15; scheduling flexibility.

---

## Acceptance Criteria Summary (Per Feature Family)
- **Auth/Access**: No protected route accessible unauthenticated; session rotation verified.
- **Integrations**: Secrets encrypted and redacted; connection tests reliable with mocks.
- **Prompting**: Active version pointer consistent; reverts do not alter past drafts.
- **Generation**: Idempotent requests; retry without duplication; cost monitored.
- **Previews**: Constraints enforced; edited vs original preserved; UX responsive.
- **Undo Queue**: Cancel guarantees no publish; edits requeue atomically; timers live-update.
- **Publishing**: Idempotent calls; post IDs stored; links valid; failures retried with backoff.
- **Analytics**: Metrics normalized; backfills safe; dashboards accurate with filters.
- **Inbox**: Consent-limited scopes; classifier meets defined precision/recall.
- **Exports**: Filter-consistent outputs; checksums; large exports handled async.
- **Multi-tenancy**: No cross-tenant data access; RLS enforced; migration script validated.
- **Collaboration**: Immutable audit trail; permissions enforced; notifications configurable.
- **Scheduling**: TZ-correct; DST-safe; conflict detection and resolution.

---

## Risks and Mitigations (Global)
- **External API volatility**: Abstract via provider adapters and capability matrix; pin versions; monitor deprecations.
- **Cost overruns**: Token budgeting, caching, batch jobs; cost dashboards and alerts.
- **Data loss**: Daily backups, PITR, restore rehearsals, idempotent ETL and jobs.
- **Performance regressions**: Baseline perf budgets; regression alerts on CI/CD.
- **Security incidents**: Secret rotation runbooks; audit logs; anomaly detection.

---

## Documentation and Developer Experience
- **Runbooks**: Auth, publishing, queue operations, analytics backfills, migrations.
- **Playbooks**: Feature flag rollout, canary, rollback.
- **Onboarding**: One-command local dev, sample data seeding, provider sandbox accounts list.

This plan purposefully sequences functionality to deliver user-visible value rapidly while enforcing strict non-regression and safety at every boundary. No code is included; execution details are reserved for implementation tasks referenced by stage and acceptance criteria above.
