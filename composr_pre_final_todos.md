# ComposR Pre-Final TODOs (Production Hardening Plan)

Scope: Bring the MVP to production-grade per plan, with zero degradation and feature flags for risky changes.

## Tasks and Gates

1) Persistence: Postgres + Prisma
- [x] Add Prisma to API; define schema for orgs, memberships, integrations, prompts, seeds, drafts, history, metrics, schedules, collab
- [x] Generate client; create dev/staging DBs; add migration scripts
- [x] Introduce repository layer with drivers: memory (default) and prisma
- [ ] Gate: CI stays green on memory driver; staging uses prisma driver with successful migrations

2) Delay Queue: Redis + BullMQ
- [x] Add BullMQ; create `publishQueue`; implement producer/worker; retries/backoff
- [x] Feature-flag queue driver: memory (default) vs bullmq
- [ ] Gate: CI uses memory; staging validates BullMQ flow and idempotency

3) Secrets: Encrypted storage/Vault
- [x] Encryption-at-rest for credentials; KMS-managed key or libsodium keyfile
- [x] Redaction everywhere; remove stubbed test endpoints; add rotate key workflow
- [ ] Gate: secret scanners show 0 leaks; rotation integration test passes

4) Provider OAuth + Publish (LinkedIn/X/Meta/TikTok)
- [ ] OAuth flows and token storage per provider; scopes least privilege
- [ ] Sandbox publish; canary toggle; idempotent retries
- [ ] Gate: sandbox smoke for all providers; canary publish in staging succeeds

5) Frontend UI Buildout
- [ ] Integrations UI with status/test; Settings: Master Prompt editor/versioning
- [ ] Daily Review: seeds, generate drafts, preview/edit, approve/undo
- [ ] History and Analytics dashboards with filters and exports
- [ ] Gate: E2E flows green for auth→review→approve→history; Web Vitals budgets met

6) Testing and Quality Gates
- [ ] Full E2E suites for critical paths; DAST/ZAP in CI; coverage ≥ 80/70 (lines/branches)
- [ ] Performance budgets and smoke perf checks; contract tests for provider adapters
- [ ] Gate: CI gates enforced; perf within budgets across PRs

7) Observability
- [x] Structured logs with redaction; request IDs; tracing (OpenTelemetry); metrics/SLIs
- [x] Dashboards and alerts (availability, latency, errors, queues, costs)
- [ ] Gate: staging dashboards healthy; alert runbook tested

8) CI/CD and Repo Hygiene
- [ ] Dependabot/Renovate; CODEOWNERS; PR template; commit lint
- [ ] Security scans (SAST/DAST/deps) as required checks
- [ ] Gate: PRs blocked until all checks pass

9) Infra and Deployment
- [ ] Docker production images; IaC (Terraform) for DB/Redis/app; TLS/CDN
- [ ] Deploy to target cloud (AWS/GCP/Azure) with blue/green or canary
- [ ] Gate: successful staging→prod promotion; rollback playbook verified

10) Security Hardening
- [ ] Rate limiting, input validation, CORS/CSRF review; headers (HSTS, CSP)
- [ ] Gate: external pen test issues triaged; criticals resolved

11) Docs and Runbooks
- [ ] Onboarding docs; ops runbooks; incident playbooks; support SLAs
- [ ] Gate: new dev can set up in <30 mins with docs

12) Optional: Billing and Plans
- [ ] Stripe subscriptions; plan entitlements and quotas; metering
- [ ] Gate: test payment and downgrade/upgrade flows

## Default Drivers
- DB_DRIVER=memory|prisma (default: memory for CI; prisma for staging/prod)
- QUEUE_DRIVER=memory|bullmq (default: memory for CI; bullmq for staging/prod)

## Promotion Strategy
- Develop behind flags and drivers; CI remains green on memory drivers
- Validate prisma/bullmq drivers in staging with seed data and smoke tests
- Gradual rollout of provider OAuth and publishing via canary flags
