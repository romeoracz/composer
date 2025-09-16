# ComposR Phase TODOs with Automated Gates (No-Code)

This document enumerates detailed TODOs for each stage, with measurable, automated success metrics and explicit promotion gates to proceed to the next stage. No implementation code is included.

Conventions
- [ ] Checkbox: task to complete
- Metric format: name → threshold (how measured)
- Gates are enforced via CI/CD pipeline jobs (names suggested below)

---

Progress Status (as of 2025-09-16)
- Stage 0: Foundations — Partial. Monorepo, web/api scaffolds, Docker, CI smoke done. Missing: Prisma migrations, CODEOWNERS/PR template, dependabot.
- Stage 1: Auth — Partial. Sessions, CSRF, guards, login page, CI smoke done. Missing: full DAST and E2E suites.
- Stage 2: Integrations settings/secret storage — Not started in UI; no encrypted secret store yet.
- Stage 3: Master Prompt — Not started.
- Stage 4: Seeds UI — Not started.
- Stage 5: AI Generation — Not started.
- Stage 6: Preview/Edit — Not started.
- Stage 7: Undo Queue — Not started.
- Stage 8: Publish/History — Not started.
- Stage 9: Platform Adapters — Completed (stubs + flags, registry, /providers, CI validation).
- Stage 10: Analytics — Completed (in-memory ingest/list, exports CSV/PDF, CI checks).
- Stage 11: Inbox Recommendations — Completed (fixtures + classifier stub, CI checks).
- Stage 12: Exports — Completed (CSV/PDF endpoints, CI checks).
- Stage 13: Multi-Tenancy — Completed (in-memory orgs, isolation enforced, CI checks).
- Stage 14: Collaboration — Completed (suggest/comment/approve with permissions, invites, CI checks).
- Stage 15: Scheduling — Completed (schedule/reschedule, conflict detection, CI checks).

---

## Phase MVP (Weeks 1–8)

### Stage 0: Project Scaffolding and Foundations
Checklist
- [ ] Initialize mono-repo or multi-repo structure with agreed layout
- [ ] Scaffold frontend app with routing, design system placeholder, feature flagging
- [ ] Scaffold backend service with REST and WebSocket placeholders
- [ ] Initialize database with migration tooling and a placeholder base schema
- [ ] Configure Redis connection placeholder and health checks
- [ ] Add Dockerfiles and docker-compose for local dev (frontend, backend, db, redis)
- [ ] Create CI pipelines: lint, format, type-check, unit test, security scan, build images
- [ ] Add CODEOWNERS, PR templates, commit message guidelines
- [ ] Configure environments: .env.sample for local, Dev/Staging secrets in vault
- [ ] Add baseline smoke tests for app health endpoints and frontend boot
- [ ] Set up dependabot/renovate for dependency updates

Automated Success Metrics
- CI lint errors → 0 (ci:lint)
- Type-check errors → 0 (ci:typecheck)
- Unit tests pass rate → 100% (ci:test)
- Container build → success (ci:build)
- Security scan criticals → 0 (ci:security)
- Frontend boot smoke: first render < 3s in CI container (ci:e2e:smoke)
- Backend /health p50 < 100ms in CI (ci:perf:smoke)

Promotion Gate (Stage 1 readiness)
- All metrics above green for two consecutive CI runs on main
- Local one-command startup works; health endpoints reachable

Rollback/Blockers
- If ci:security reports critical, block promotion until resolved

---

### Stage 1: Authentication and Access Control (Single User)
Checklist
- [ ] Implement login/logout flow with secure sessions and CSRF protection
- [ ] Protect backend endpoints and frontend routes (guards)
- [ ] Configure session timeout, refresh, and cookie security flags
- [ ] Add feature flagging for protected areas
- [ ] Write E2E tests for login, unauthorized redirects, and logout

Automated Success Metrics
- Unauthorized access E2E tests → 100% pass (ci:e2e:auth)
- Session fixation/rotation tests → 100% pass (ci:security:auth)
- OWASP ZAP baseline alerts criticals → 0 (ci:security:dast)

Promotion Gate (Stage 2 readiness)
- All auth E2E and security tests pass on two consecutive runs
- No protected route accessible unauthenticated in tests

Rollback/Blockers
- Any critical auth vulnerability blocks promotion

---

### Stage 2: Integrations Settings UI and Secret Storage (LinkedIn, X)
Checklist
- [ ] Build Integrations page with provider cards for LinkedIn and X
- [ ] Add forms for credentials, with validation and redaction on display
- [ ] Encrypt at-rest secrets; ensure no plaintext in logs
- [ ] Implement Test Connection actions using sandbox/mocks
- [ ] Store verification status and last-checked timestamps
- [ ] Add audit trail for secret changes
- [ ] Add integration tests for secret storage and redaction

Automated Success Metrics
- Secrets redaction tests → 100% pass (ci:test:integrations)
- Secret leak scanner findings → 0 (ci:security:leaks)
- Test Connection success with valid mock creds → 100% (ci:integrations:mock-verify)

Promotion Gate (Stage 3 readiness)
- No secret exposures detected; mock verification reliable

Rollback/Blockers
- Any occurrence of plaintext secret in logs/artifacts blocks promotion

---

### Stage 3: Master Prompt System (Versioned)
Checklist
- [ ] Add prompt editor in Settings with version history and diff view
- [ ] Implement active version pointer; atomic updates
- [ ] Store author, timestamp, and change notes
- [ ] Make generator read-only consumer of active prompt
- [ ] Add revert-to-version functionality without touching historical drafts
- [ ] Write integration tests for versioning and revert behavior

Automated Success Metrics
- Prompt versioning tests → 100% pass (ci:test:prompt)
- Active pointer consistency checks → 100% pass (ci:test:prompt-pointer)

Promotion Gate (Stage 4 readiness)
- Reverting versions leaves historical draft references intact in tests

Rollback/Blockers
- Any pointer inconsistency or historical mutation blocks promotion

---

### Stage 4: Seed Intake (Manual Events)
Checklist
- [ ] Left sidebar UI for seed entry with basic tagging and categories
- [ ] CRUD operations for seeds with draft/published seed states
- [ ] Sorting and filtering by date and tag
- [ ] Persistence and optimistic UI updates
- [ ] Integration tests for CRUD, ordering, filtering

Automated Success Metrics
- Seed CRUD tests → 100% pass (ci:test:seeds)
- UI E2E for create/edit/delete → 100% pass (ci:e2e:seeds)

Promotion Gate (Stage 5 readiness)
- Seeds persist and are retrievable across sessions in E2E

Rollback/Blockers
- Data corruption or lost updates in tests blocks promotion

---

### Stage 5: AI Draft Generation (LinkedIn, X)
Checklist
- [ ] Generate drafts per platform from seeds using active prompt
- [ ] Background job per seed; idempotency keys to avoid dupes
- [ ] Rate limiting and retries with backoff
- [ ] Store provenance metadata (prompt version, seed id, generation time)
- [ ] Error surfacing with user-facing retry controls
- [ ] Contract tests for generator I/O schema

Automated Success Metrics
- Generator contract tests → 100% pass (ci:test:generator)
- Idempotency test: duplicate requests produce 1 draft → 100% pass (ci:test:idempotency)
- Cost budget simulation per run ≤ configured cap (ci:budget:generation)

Promotion Gate (Stage 6 readiness)
- All generator tests pass; duplicate suppression verified

Rollback/Blockers
- Any generator producing inconsistent schema blocks promotion

---

### Stage 6: Preview and Inline Editing (LinkedIn, X)
Checklist
- [ ] Side-by-side previews with platform constraints (char count, media placeholders)
- [ ] Inline edit of drafts; persist edited vs original separately
- [ ] Validation rules for each platform; truncation indicators
- [ ] Change audit for edits
- [ ] Unit tests for validation rules
- [ ] E2E tests for edit, save, and preview constraints

Automated Success Metrics
- Validation rule tests → 100% pass (ci:test:validation)
- E2E edit and save → 100% pass (ci:e2e:preview)
- Preview render time p95 < 200ms in CI (ci:perf:preview)

Promotion Gate (Stage 7 readiness)
- Edited content preserved; original intact; validation enforced in E2E

Rollback/Blockers
- Any loss of original content or validation bypass blocks promotion

---

### Stage 7: Approval and 7-Minute Undo Queue (LinkedIn, X)
Checklist
- [ ] Approve action schedules job with configurable 7-minute delay
- [ ] Undo/cancel action cancels queued job reliably
- [ ] Editing during window requeues timer atomically
- [ ] WebSocket dashboard shows live timers
- [ ] Concurrency tests for schedule/cancel/edit flows
- [ ] Time-travel tests for timers

Automated Success Metrics
- Queue reliability simulation (1,000 runs) cancel success → 100% (ci:test:queue-reliability)
- Race condition tests → 100% pass (ci:test:queue-concurrency)
- Timer drift over 7 minutes < 2s (simulated) (ci:test:timer-drift)

Promotion Gate (Stage 8 readiness)
- All queue reliability and concurrency tests pass

Rollback/Blockers
- Any missed cancel leading to publish in tests blocks promotion

---

### Stage 8: Publishing (LinkedIn, X) and Basic History
Checklist
- [ ] Implement platform auth flows/tokens with least privilege scopes
- [ ] Submit posts after delay; capture platform post IDs and links
- [ ] Idempotent retries on transient failures
- [ ] History page with thumbnails and detail (original, edited, published)
- [ ] Provider mocks for CI; canary flag for production
- [ ] Contract tests against mocks for error handling

Automated Success Metrics
- Provider contract tests → 100% pass (ci:test:providers)
- Publish idempotency tests → 100% pass (ci:test:publish-idempotency)
- Canary deploy publishes 1 test post in staging → success (ci:canary:publish-staging)

Promotion Gate (Phase 2 readiness)
- Staging publishes succeed; history entries complete and link back to platforms

Rollback/Blockers
- API policy violations or failed canary blocks promotion

---

## Phase 2 (Weeks 9–16)

### Stage 9: Extend Platforms (Instagram, Facebook, TikTok)
Checklist
- [ ] Implement provider adapters with unified contract
- [ ] Support media requirements and preflight checks per provider
- [ ] Update preview constraints for new platforms
- [ ] Sandbox verification for each provider
- [ ] Add per-provider feature flags

Automated Success Metrics
- Shared adapter test suite → 100% pass (ci:test:adapters)
- Sandbox publish tests per provider → success (ci:canary:ig/fb/tiktok)

Promotion Gate (Stage 10 readiness)
- All new providers pass adapter and sandbox tests; flags default off in prod

Rollback/Blockers
- Any provider failing sandbox tests blocks promotion

---

### Stage 10: Analytics Ingestion and Dashboard
Checklist
- [ ] Scheduled fetchers for metrics (likes, comments, shares, reach)
- [ ] Normalization across providers; time-series storage
- [ ] Dashboard with trendlines, top posts, filters
- [ ] ETL idempotency and backfill jobs
- [ ] Export CSV from dashboard data

Automated Success Metrics
- ETL idempotency test (double-run equality) → 100% pass (ci:test:etl-idempotency)
- Metrics integrity checks (sum/avg bounds) → 100% pass (ci:test:metrics-integrity)
- Dashboard E2E with filters → 100% pass (ci:e2e:analytics)

Promotion Gate (Stage 11 readiness)
- Idempotent ETL and accurate dashboard metrics in staging

Rollback/Blockers
- Metric drift beyond bounds blocks promotion

---

### Stage 11: Email Inbox Parser and Recommendations
Checklist
- [ ] Connectors for IMAP/POP3 or Gmail/Outlook with minimal scopes
- [ ] Daily scan; classification for relevance; deduplication
- [ ] “Recommended topics” UI with toggle to seed
- [ ] Sampling tests with fixture mailboxes
- [ ] Privacy controls and retention policy

Automated Success Metrics
- Classifier precision ≥ 0.75, recall ≥ 0.6 on fixtures (ci:test:classifier-metrics)
- Connector rate limit handling tests → 100% pass (ci:test:mail-connectors)

Promotion Gate (Stage 12 readiness)
- Classifier meets thresholds; opt-in workflow verified in E2E

Rollback/Blockers
- Failure to meet classifier thresholds blocks promotion

---

### Stage 12: Exports (CSV/PDF)
Checklist
- [ ] CSV export for posts and metrics with current filters
- [ ] PDF snapshot for dashboards
- [ ] Async large-export jobs with email/download links
- [ ] Golden-file tests for CSV and PDF

Automated Success Metrics
- Golden-file comparison → 100% pass (ci:test:exports)
- Export size > 100k rows completes < 5 min in CI (ci:perf:exports)

Promotion Gate (Phase 3 readiness)
- Exports reflect on-screen filters exactly; checksums stable

Rollback/Blockers
- Golden-file drift without spec change blocks promotion

---

## Phase 3 (Weeks 17–24)

### Stage 13: Multi-User SaaS and Multi-Tenancy
Checklist
- [ ] Introduce tenant/org model with users and roles
- [ ] Enforce tenant isolation at query, API, and job layers
- [ ] Migration scripts and backfill; shadow reads and audit
- [ ] Tenant-aware secrets and integrations
- [ ] Row-level security rules and tests

Automated Success Metrics
- Cross-tenant access tests → 0 violations (ci:test:tenancy-rls)
- Migration dry-run with snapshot diff → 0 unexpected changes (ci:migrate:dry-run)

Promotion Gate (Stage 14 readiness)
- Tenancy isolation proven in tests; migrations reversible and rehearsed

Rollback/Blockers
- Any cross-tenant leakage blocks promotion

---

### Stage 14: Collaboration Workflow
Checklist
- [ ] Suggest → review → approve workflow with comments
- [ ] Permission checks for roles; activity log
- [ ] Notification preferences; digests
- [ ] E2E coverage for common flows and edge cases

Automated Success Metrics
- Workflow E2E tests → 100% pass (ci:e2e:collab)
- Permission escalation attempts → 0 succeeds (ci:test:permissions)

Promotion Gate (Stage 15 readiness)
- Audit trail immutable; permissions enforced consistently in tests

Rollback/Blockers
- Any permission bypass blocks promotion

---

### Stage 15: Scheduling Flexibility
Checklist
- [ ] Calendar UI for future timeslots; conflict detection
- [ ] Timezone management; DST-safe scheduling
- [ ] Bulk scheduling and rescheduling with atomic updates
- [ ] Time-travel tests for boundaries and DST transitions

Automated Success Metrics
- Schedule accuracy tests → 100% pass (ci:test:scheduling)
- TZ/DST transitions tests → 100% pass (ci:test:timezone)
- Queue throughput at 95th percentile ≥ target (ci:perf:scheduling)

Promotion Gate (Feature family completion)
- Scheduling correctness proven under TZ/DST tests; conflicts prevented in E2E

Rollback/Blockers
- Any missed schedule or TZ misfire blocks feature enablement

---

## Global Promotion Guardrails (Apply to All Stages)
- Code scanning criticals → 0
- Dependency vulnerabilities criticals → 0
- Test pass rate → 100% required for promotion
- Coverage threshold → ≥ 80% lines, ≥ 70% branches (ci:coverage)
- Performance budgets → maintained or improved stage-over-stage
- Error budgets (SLOs) → remain within targets in staging

## Suggested CI Job Names
- ci:lint, ci:format, ci:typecheck, ci:test, ci:coverage
- ci:security, ci:security:leaks, ci:security:dast
- ci:build, ci:publish:images
- ci:e2e:smoke, ci:e2e:auth, ci:e2e:seeds, ci:e2e:preview, ci:e2e:analytics, ci:e2e:collab
- ci:perf:smoke, ci:perf:preview, ci:perf:exports, ci:perf:scheduling
- ci:test:generator, ci:test:idempotency, ci:test:validation, ci:test:queue-reliability, ci:test:queue-concurrency, ci:test:timer-drift, ci:test:providers, ci:test:adapters, ci:test:etl-idempotency, ci:test:metrics-integrity, ci:test:classifier-metrics, ci:test:mail-connectors, ci:test:exports, ci:test:tenancy-rls, ci:test:permissions, ci:test:scheduling, ci:test:timezone
- ci:canary:publish-staging, ci:canary:ig, ci:canary:fb, ci:canary:tiktok

This checklist defines objective, automated gates to ensure zero-degradation and safe, incremental delivery across all phases.
