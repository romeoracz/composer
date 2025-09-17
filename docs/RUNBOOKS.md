# Operational Runbooks

These runbooks cover the current ComposR MVP stack: seed intake, prompt versioning, draft generation/preview, approval queue, and integrations secret storage. Update as capabilities expand.

## Environment & Deploys
- Required env vars: `SECRET_ENC_KEY` (base64 32 bytes), `DB_DRIVER`, `QUEUE_DRIVER`, `ENABLE_TEST_ENDPOINTS`, `ENABLE_SANDBOX_PUBLISH`.
- Prisma migrations: run `npx prisma migrate deploy` after every deploy. Latest migrations add draft metadata/audit trail (`20250917164243_add_draft_metadata_audit`) and approval queue storage (`20250917170610_add_approval_jobs`).
- Vercel 500s typically mean schema drift. Check logs, run pending migrations, redeploy.

## Seed Intake Issues
- Endpoint: `GET/POST /seeds`, `POST /seeds/:id`, `DELETE /seeds/:id`.
- Symptoms: missing seeds, filters not working, 400 `title_required`.
- Fix: verify request payload (title, tags array), ensure DB migrations applied, check Redis/bull flags not interfering.

## Prompt Versioning
- Endpoint: `GET/POST /prompts`, `POST /prompts/activate`.
- Symptoms: 400 `content_required`, missing diffs.
- Fix: ensure active prompt exists before generation; if Prisma driver, confirm migrations and promptVersion table populated.

## Draft Generation Failures
- Endpoint: `POST /drafts/generate`.
- Symptoms: per-platform status `failed` with `generation_failed`.
- Fix: check generator logs; idempotency key prevents duplicate drafts. If metadata missing, ensure migration deployed. Retry shows previously generated drafts as `reused`.

## Preview & Editing
- Endpoint: `GET /drafts`, `GET /drafts/:id`, `POST /drafts/:id/edit`, `POST /preview/validate`.
- Symptoms: validation errors, audit trail missing.
- Fix: ensure providers metadata loaded (`/api/providers`). Edits create records in `DraftAudit`; confirm Prisma table exists. Validation uses provider constraints (text length).

## Approval Queue & Undo (Stage 7 groundwork)
- Endpoint: `POST /approve`, `POST /approve/cancel`.
- Default queue driver is memory; BullMQ requires Redis + `QUEUE_DRIVER=bullmq`.
- Symptoms: job not scheduled, cancel ineffective.
- Fix: check queue driver config, ensure Redis URL reachable.
- Memory driver: process pending jobs via `POST /publish/process-due` (requires auth + CSRF token). Schedule this via cron if needed.
- BullMQ driver: worker spins up automatically on API start; check Redis logs if publish attempts stall.

## Integrations Secrets
- Endpoint: `/integrations/*`.
- Symptoms: 500 `SECRET_ENC_KEY not set` or Prisma decrypt errors.
- Fix: rotate `SECRET_ENC_KEY`, rerun migrations, confirm encrypt/decrypt using same key across environments.

## Incident Response Checklist
1. Observe logs (Vercel, server console).
2. Validate env vars/migrations.
3. Roll back recent deploy if blocking.
4. For data issues, restore from latest backup (Prisma DB) and re-run idempotent jobs.
5. Update this runbook with new edge cases.
