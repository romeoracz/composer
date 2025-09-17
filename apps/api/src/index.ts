import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import { collectDefaultMetrics, createHistogram, register as metricsRegister } from './metrics';
import { getProvidersInfo, getAdapterByKey } from './providers/registry';
import { addMetric, listMetrics } from './analytics';
import { generateCSV, generatePDF } from './exports';
import { createOrgForUser, getActiveOrgId, listMembershipsForUser, setActiveOrg, isUserMemberOfOrg, addMember, getRole } from './tenancy';
import { addComment, approveSuggestion, canApprove, canComment, canSuggest, createSuggestion, listActivity, listComments, listSuggestions } from './collab';
import { list as listSchedules, reschedule as reschedulePost, schedule as schedulePost } from './scheduling';
import { createSecretRecord, decryptRecord, hydrateSecretRecord, redact, serializeSecretRecord, setCredentials, status as integrationStatus, testConnection, testRecord, type ProviderKey } from './integrations';
import { activate, createVersion, getActive, listVersions, PromptVersion } from './prompts';
import { createSeed, deleteSeed, listSeeds, updateSeed } from './seeds';
import { createDraft, editDraft, listDrafts, listDraftAudits } from './drafts';
import { cancelJob, runNow, scheduleJob, getJobsForOrg, getJobForDraft, rescheduleJob, markCompleted, markFailed, dueJobs } from './queue';
import { recordPublish, listHistory } from './history';
import { getQueueDriver, initBull, addBullJob, startBullWorker, removeBullJob } from './queueDriver';
import { getDriver } from './repo';
import { getPrisma } from './prismaClient';
import { encryptJson } from './crypto';
import { withRequestId } from './logging';
import { oauthStart, oauthCallback } from './oauth';
import { diffLines, type DiffSegment } from './diff';
import { ensureGeneration, recordDraftMetadata, getDraftMetadata, type SeedState } from './generator';

function isTestEndpointsEnabled() {
  return (process.env.ENABLE_TEST_ENDPOINTS || 'false').toLowerCase() === 'true';
}

type PromptVersionView = {
  id: string;
  orgId: string;
  author: string;
  notes?: string;
  content: string;
  createdAt: number;
  sourceVersionId?: string;
  isActive: boolean;
  diff?: DiffSegment[];
};

type SeedFilters = { state?: SeedState; tag?: string; search?: string };

const VALID_SEED_STATES: SeedState[] = ['draft', 'ready'];
const SUPPORTED_PLATFORMS = ['linkedin', 'x', 'instagram', 'facebook', 'tiktok'];
const APPROVAL_DEFAULT_DELAY_MS = Number(process.env.APPROVAL_DELAY_MS || 7 * 60 * 1000);

type ApprovalJobStatus = 'pending' | 'cancelled' | 'completed' | 'failed';

type ApprovalJobView = {
  id: string;
  draftId: string;
  jobId: string;
  runAt: number;
  status: ApprovalJobStatus;
  createdAt: number;
  updatedAt: number;
};

const memoryApprovalJobs = new Map<string, ApprovalJobView>();

function approvalMemoryKey(orgId: string, draftId: string) {
  return `${orgId}:${draftId}`;
}

async function ensurePrismaSchema(prisma: any) {
  const globalAny = global as any;
  if (globalAny.__composrPrismaSchemaEnsured) return;
  const result: any[] = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'ApprovalJob'
    ) AS exists;
  `);
  const tableExists = result?.[0]?.exists === true || result?.[0]?.exists === 't';
  if (!tableExists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ApprovalJob" (
        "id" TEXT PRIMARY KEY,
        "orgId" TEXT NOT NULL,
        "draftId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "runAt" TIMESTAMP(3) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ApprovalJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "ApprovalJob_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
  }
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "approval_job_org_draft_unique" ON "ApprovalJob" ("orgId", "draftId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "approval_job_org_draft" ON "ApprovalJob" ("orgId", "draftId")
  `);

  // History columns
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "History" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'success'
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "History" ADD COLUMN IF NOT EXISTS "error" TEXT
  `);

  // Integration unique index
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "integration_org_provider_unique" ON "Integration" ("orgId", "provider")
  `);

  globalAny.__composrPrismaSchemaEnsured = true;
}

function normalizePrismaPromptVersion(row: any, sourceVersionId?: string): PromptVersion {
  return {
    id: row.id,
    orgId: row.orgId,
    author: row.author,
    notes: row.notes ?? undefined,
    content: row.content,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime(),
    sourceVersionId,
  };
}

function toPromptView(version: PromptVersion, activeId: string, activeContent: string): PromptVersionView {
  const isActive = version.id === activeId;
  const diffSegments = isActive ? undefined : diffLines(version.content, activeContent);
  const hasMeaningfulDiff = diffSegments?.some((segment) => segment.type !== 'context');
  return {
    id: version.id,
    orgId: version.orgId,
    author: version.author,
    notes: version.notes,
    content: version.content,
    createdAt: version.createdAt,
    sourceVersionId: version.sourceVersionId,
    isActive,
    diff: hasMeaningfulDiff ? diffSegments : undefined,
  };
}

function buildPromptResponsePayload(versions: PromptVersion[], activeVersion?: PromptVersion | null) {
  if (!versions.length) {
    return { active: null, versions: [] as PromptVersionView[] };
  }
  const sorted = versions.slice().sort((a, b) => b.createdAt - a.createdAt);
  const active = activeVersion ?? sorted[0];
  const activeId = active.id;
  const activeContent = active.content;
  const views = sorted.map((version) => toPromptView(version, activeId, activeContent));
  const activeView = views.find((v) => v.id === activeId) ?? null;
  return { active: activeView, versions: views };
}

function serializeSeed(seed: any) {
  return {
    ...seed,
    tags: Array.isArray(seed.tags) ? seed.tags : [],
    createdAt: seed.createdAt instanceof Date ? seed.createdAt.getTime() : seed.createdAt,
  };
}

function parseSeedFilters(query: any): SeedFilters {
  const filters: SeedFilters = {};
  const stateRaw = query?.state;
  if (stateRaw && typeof stateRaw === 'string' && VALID_SEED_STATES.includes(stateRaw as SeedState)) {
    filters.state = stateRaw as SeedState;
  }
  const tagRaw = query?.tag;
  if (tagRaw && typeof tagRaw === 'string' && tagRaw.trim().length) {
    filters.tag = tagRaw.trim();
  }
  const searchRaw = query?.q || query?.search;
  if (searchRaw && typeof searchRaw === 'string' && searchRaw.trim().length) {
    filters.search = searchRaw.trim();
  }
  return filters;
}

function parseTagsInput(input: unknown): string[] {
  if (!input) return [];
  const source = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n]/)
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of source) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      tags.push(trimmed);
    }
  }
  return tags.slice(0, 10);
}

function normalizeSeedCreate(body: any) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    throw Object.assign(new Error('title_required'), { status: 400 });
  }
  const notesRaw = typeof body?.notes === 'string' ? body.notes.trim() : undefined;
  const notes = notesRaw && notesRaw.length ? notesRaw : undefined;
  const tags = parseTagsInput(body?.tags);
  const stateRaw = typeof body?.state === 'string' ? body.state.trim().toLowerCase() : undefined;
  const state: SeedState = VALID_SEED_STATES.includes(stateRaw as SeedState) ? (stateRaw as SeedState) : 'draft';
  return { title, notes, tags, state };
}

function toApprovalView(row: any): ApprovalJobView {
  return {
    id: row.id,
    draftId: row.draftId,
    jobId: row.jobId,
    runAt: row.runAt instanceof Date ? row.runAt.getTime() : row.runAt,
    status: row.status as ApprovalJobStatus,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
  };
}

async function getApprovalJob(orgId: string, draftId: string): Promise<ApprovalJobView | null> {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    await ensurePrismaSchema(prisma);
    const row = await prisma.approvalJob.findUnique({ where: { orgId_draftId: { orgId, draftId } } as any });
    return row ? toApprovalView(row) : null;
  }
  const entry = memoryApprovalJobs.get(approvalMemoryKey(orgId, draftId));
  return entry ?? null;
}

async function listApprovalJobs(orgId: string): Promise<ApprovalJobView[]> {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
     await ensurePrismaSchema(prisma);
    const rows = await prisma.approvalJob.findMany({ where: { orgId }, orderBy: { runAt: 'asc' } });
    return rows.map((row: any) => toApprovalView(row));
  }
  const views: ApprovalJobView[] = [];
  for (const [key, value] of memoryApprovalJobs.entries()) {
    if (key.startsWith(`${orgId}:`)) views.push(value);
  }
  return views.sort((a, b) => a.runAt - b.runAt);
}

async function upsertApprovalJob(orgId: string, draftId: string, job: { jobId: string; runAt: number; status: ApprovalJobStatus }): Promise<ApprovalJobView> {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    await ensurePrismaSchema(prisma);
    const row = await prisma.approvalJob.upsert({
      where: { orgId_draftId: { orgId, draftId } } as any,
      update: { jobId: job.jobId, runAt: new Date(job.runAt), status: job.status },
      create: { orgId, draftId, jobId: job.jobId, runAt: new Date(job.runAt), status: job.status },
    });
    return toApprovalView(row);
  }
  const key = approvalMemoryKey(orgId, draftId);
  const existing = memoryApprovalJobs.get(key);
  const now = Date.now();
  const view: ApprovalJobView = {
    id: existing?.id ?? job.jobId,
    draftId,
    jobId: job.jobId,
    runAt: job.runAt,
    status: job.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  memoryApprovalJobs.set(key, view);
  return view;
}

async function updateApprovalJobStatus(orgId: string, draftId: string, status: ApprovalJobStatus, runAt?: number, jobId?: string): Promise<ApprovalJobView | null> {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    await ensurePrismaSchema(prisma);
    const row = await prisma.approvalJob.findUnique({ where: { orgId_draftId: { orgId, draftId } } as any });
    if (!row) return null;
    const updated = await prisma.approvalJob.update({
      where: { id: row.id },
      data: {
        status,
        ...(runAt ? { runAt: new Date(runAt) } : {}),
        ...(jobId ? { jobId } : {}),
      },
    });
    return toApprovalView(updated);
  }
  const key = approvalMemoryKey(orgId, draftId);
  const existing = memoryApprovalJobs.get(key);
  if (!existing) return null;
  const updated: ApprovalJobView = {
    ...existing,
    jobId: jobId ?? existing.jobId,
    runAt: runAt ?? existing.runAt,
    status,
    updatedAt: Date.now(),
  };
  memoryApprovalJobs.set(key, updated);
  return updated;
}

async function scheduleApprovalJob(orgId: string, draftId: string, delayMs: number, payload: any) {
  const queueDriver = getQueueDriver();
  if (queueDriver === 'bullmq') {
    const job = await addBullJob(payload, { delay: delayMs, attempts: 1, backoff: { type: 'exponential', delay: 2000 } });
    const runAt = Date.now() + delayMs;
    const jobId = job.id?.toString();
    if (!jobId) throw new Error('job_id_missing');
    if (getDriver() === 'prisma') await ensurePrismaSchema(getPrisma());
    await upsertApprovalJob(orgId, draftId, { jobId, runAt, status: 'pending' });
    return { id: jobId, runAt };
  }
  const job = scheduleJob(orgId, payload, delayMs);
  await upsertApprovalJob(orgId, draftId, { jobId: job.id, runAt: job.runAt, status: 'pending' });
  return { id: job.id, runAt: job.runAt };
}

async function cancelQueueJobById(jobId: string) {
  if (getQueueDriver() === 'bullmq') {
    await removeBullJob(jobId);
  } else {
    cancelJob(jobId);
  }
}

async function rescheduleApproval(orgId: string, draftId: string, currentJob: ApprovalJobView, payload: any, delayMs: number) {
  const queueDriver = getQueueDriver();
  if (queueDriver === 'bullmq') {
    await removeBullJob(currentJob.jobId);
    const job = await addBullJob(payload, { delay: delayMs, attempts: 1, backoff: { type: 'exponential', delay: 2000 } });
    const runAt = Date.now() + delayMs;
    const jobId = job.id?.toString();
    if (!jobId) throw new Error('job_id_missing');
    if (getDriver() === 'prisma') await ensurePrismaSchema(getPrisma());
    await upsertApprovalJob(orgId, draftId, { jobId, runAt, status: 'pending' });
    return { id: jobId, runAt };
  }
  const rescheduled = rescheduleJob(currentJob.jobId, delayMs);
  if (rescheduled) {
    await upsertApprovalJob(orgId, draftId, { jobId: rescheduled.id, runAt: rescheduled.runAt, status: 'pending' });
    return { id: rescheduled.id, runAt: rescheduled.runAt };
  }
  const job = scheduleJob(orgId, payload, delayMs);
  await upsertApprovalJob(orgId, draftId, { jobId: job.id, runAt: job.runAt, status: 'pending' });
  return { id: job.id, runAt: job.runAt };
}

function normalizeSeedPatch(body: any) {
  const patch: { title?: string; notes?: string | null; tags?: string[]; state?: SeedState } = {};
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw Object.assign(new Error('title_required'), { status: 400 });
    patch.title = title;
  }
  if ('notes' in body) {
    if (typeof body.notes === 'string') {
      const trimmed = body.notes.trim();
      patch.notes = trimmed.length ? trimmed : null;
    } else if (body.notes == null) {
      patch.notes = null;
    }
  }
  if ('tags' in body) {
    patch.tags = parseTagsInput(body.tags);
  }
  if ('state' in body) {
    const stateRaw = typeof body.state === 'string' ? body.state.trim().toLowerCase() : undefined;
    if (!stateRaw || !VALID_SEED_STATES.includes(stateRaw as SeedState)) {
      throw Object.assign(new Error('invalid_state'), { status: 400 });
    }
    patch.state = stateRaw as SeedState;
  }
  return patch;
}

const app = express();
app.use(withRequestId);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
    }
  },
  hsts: { maxAge: 15552000, includeSubDomains: true, preload: false }
}));

// Prometheus metrics
collectDefaultMetrics();
const httpReqDuration = createHistogram({ name: 'http_request_duration_ms', help: 'HTTP request duration ms', labelNames: ['method', 'path', 'status'], buckets: [5, 10, 25, 50, 100, 250, 500, 1000] });
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpReqDuration.labels(req.method, req.path, String(res.statusCode)).observe(duration);
  });
  next();
});

app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', metricsRegister.contentType);
  res.end(await metricsRegister.metrics());
});

const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:3000';
app.use(cors({ origin: WEB_ORIGIN, credentials: true }));

app.use(express.json());
app.use(cookieParser());

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change';
app.use(
  cookieSession({
    name: 'sid',
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24,
  })
);

const csrfProtection = csrf({ cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' } });

function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function requireOrg(req: any, res: any, next: any) {
  const orgId = getActiveOrgId(req.session);
  if (!orgId) return res.status(400).json({ error: 'no_active_org' });
  const email = req.session.user?.email;
  if (!email || !isUserMemberOfOrg(email, orgId)) return res.status(403).json({ error: 'forbidden' });
  (req as any).orgId = orgId;
  next();
}

// Simple in-memory rate limiter for auth routes
const authHits: Record<string, { count: number; ts: number }> = {};
function rateLimitAuth(req: any, res: any, next: any) {
  const key = (req.ip || 'ip') + ':' + (req.path || '');
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 30;
  const entry = (authHits[key] ||= { count: 0, ts: now });
  if (now - entry.ts > windowMs) {
    entry.ts = now; entry.count = 0;
  }
  entry.count += 1;
  if (entry.count > limit) return res.status(429).json({ error: 'rate_limited' });
  next();
}

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/providers', (_req, res) => {
  res.json({ providers: getProvidersInfo() });
});

// Tenancy endpoints
app.post('/orgs', requireAuth, csrfProtection, (req, res) => {
  const email = (req.session as any).user.email;
  const name = (req.body?.name as string) || 'My Org';
  const org = createOrgForUser(email, name);
  setActiveOrg(req.session, org.id);
  res.json({ org });
});

app.get('/orgs/memberships', requireAuth, (req, res) => {
  const email = (req.session as any).user.email;
  const list = listMembershipsForUser(email);
  res.json({ memberships: list });
});

app.post('/orgs/select', requireAuth, csrfProtection, (req, res) => {
  const email = (req.session as any).user.email;
  const orgId = req.body?.orgId as string;
  if (!orgId || !isUserMemberOfOrg(email, orgId)) return res.status(400).json({ error: 'invalid_org' });
  setActiveOrg(req.session, orgId);
  res.json({ ok: true });
});

app.post('/orgs/invite', requireAuth, requireOrg, csrfProtection, (req: any, res) => {
  const requester = req.session.user.email as string;
  const role = getRole(requester, req.orgId);
  if (role !== 'owner') return res.status(403).json({ error: 'forbidden' });
  const { email, asRole } = req.body as { email: string; asRole: 'owner' | 'editor' | 'viewer' };
  addMember(req.orgId, email, asRole);
  res.json({ ok: true });
});

// Integrations (Stage 2)
app.get('/integrations/status', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const rows = await prisma.integration.findMany({ where: { orgId: req.orgId } });
    type IntegrationRow = (typeof rows)[number];
    const providerKeys: ProviderKey[] = ['linkedin', 'x', 'instagram', 'facebook', 'tiktok'];
    const providers = providerKeys.map((providerKey) => {
      const row = rows.find((integration: IntegrationRow) => integration.provider === providerKey);
      if (!row) {
        return { key: providerKey, hasCreds: false, creds: undefined, lastUpdatedAt: undefined, lastVerifiedAt: undefined, lastStatus: undefined, lastError: undefined };
      }
      const record = hydrateSecretRecord(row.data);
      if (!record) {
        return { key: providerKey, hasCreds: false, creds: undefined };
      }
      const creds = redact(decryptRecord(record));
      return {
        key: providerKey,
        hasCreds: true,
        creds,
        lastUpdatedAt: record.lastUpdatedAt,
        lastVerifiedAt: record.lastVerifiedAt,
        lastStatus: record.lastStatus,
        lastError: record.lastError,
      };
    });
    return res.json({ providers });
  }
  res.json({ providers: integrationStatus(req.orgId) });
});

app.post('/integrations/creds/:key', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const key = req.params.key as ProviderKey;
  const credsInput = (req.body || {}) as { clientId?: string; clientSecret?: string; accessToken?: string; refreshToken?: string };
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const record = createSecretRecord(credsInput);
    await prisma.integration.upsert({ where: { orgId_provider: { orgId: req.orgId, provider: key } } as any, update: { data: serializeSecretRecord(record) }, create: { orgId: req.orgId, provider: key, data: serializeSecretRecord(record) } });
    return res.json({ ok: true, provider: key, creds: redact(decryptRecord(record)), meta: { lastUpdatedAt: record.lastUpdatedAt } });
  }
  const record = setCredentials(req.orgId, key, credsInput);
  res.json({ ok: true, provider: key, creds: redact(credsInput), meta: { lastUpdatedAt: record.lastUpdatedAt } });
});

app.post('/integrations/test/:key', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  if (!isTestEndpointsEnabled()) return res.status(404).json({ error: 'not_found' });
  const key = req.params.key as ProviderKey;
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const row = await prisma.integration.findUnique({ where: { orgId_provider: { orgId: req.orgId, provider: key } } as any });
    if (!row) return res.json({ ok: false, details: 'credentials_missing' });
    const record = hydrateSecretRecord(row.data);
    if (!record) return res.json({ ok: false, details: 'credentials_invalid' });
    const result = testRecord(record, key);
    await prisma.integration.update({ where: { id: row.id }, data: { data: serializeSecretRecord(result.record) } });
    return res.json({ ok: result.ok, details: result.details });
  }
  const result = testConnection(req.orgId, key);
  res.json(result);
});

// Master Prompt (Stage 3)
app.get('/prompts', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const rows = await prisma.promptVersion.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    const mapped = rows.map((row: any) => normalizePrismaPromptVersion(row));
    return res.json(buildPromptResponsePayload(mapped, mapped[0] ?? null));
  }
  const versions = listVersions(req.orgId);
  const active = getActive(req.orgId) ?? versions[0] ?? null;
  res.json(buildPromptResponsePayload(versions, active));
});

app.post('/prompts', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const content = String(req.body?.content || '').trim();
  const notesRaw = req.body?.notes as string | undefined;
  const notes = notesRaw ? notesRaw.trim() : undefined;
  if (!content) return res.status(400).json({ error: 'content_required' });
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    await prisma.promptVersion.create({ data: { orgId: req.orgId, content, notes, author: req.session.user.email } });
    const rows = await prisma.promptVersion.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    const mapped = rows.map((row: any) => normalizePrismaPromptVersion(row));
    return res.json(buildPromptResponsePayload(mapped, mapped[0] ?? null));
  }
  createVersion(req.orgId, req.session.user.email, content, notes);
  const versions = listVersions(req.orgId);
  const active = getActive(req.orgId) ?? versions[0] ?? null;
  res.json(buildPromptResponsePayload(versions, active));
});

app.post('/prompts/activate', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const id = String(req.body?.id || '');
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const version = await prisma.promptVersion.findUnique({ where: { id } });
    if (!version || version.orgId !== req.orgId) return res.status(404).json({ error: 'not_found' });
    const activationNotesRaw = req.body?.notes as string | undefined;
    const activationNotes = activationNotesRaw ? activationNotesRaw.trim() : undefined;
    await prisma.promptVersion.create({ data: { orgId: req.orgId, content: version.content, notes: activationNotes ?? `Reinstated from version ${version.id}`, author: req.session.user.email } });
    const rows = await prisma.promptVersion.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    const mapped = rows.map((row: any) => normalizePrismaPromptVersion(row));
    return res.json(buildPromptResponsePayload(mapped, mapped[0] ?? null));
  }
  const notesRaw = req.body?.notes as string | undefined;
  const cleanedNotes = notesRaw ? notesRaw.trim() : undefined;
  const v = activate(req.orgId, id, req.session.user.email, cleanedNotes);
  if (!v) return res.status(404).json({ error: 'not_found' });
  const versions = listVersions(req.orgId);
  const active = getActive(req.orgId) ?? versions[0] ?? null;
  res.json(buildPromptResponsePayload(versions, active));
});

// Seeds (Stage 4)
app.get('/seeds', requireAuth, requireOrg, async (req: any, res) => {
  const filters = parseSeedFilters(req.query);
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const baseWhere: any = { orgId: req.orgId };
    if (filters.state) baseWhere.state = filters.state;
    if (filters.tag) baseWhere.tags = { has: filters.tag };
    const andClauses: any[] = [];
    if (filters.search) {
      andClauses.push({
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { notes: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
    }
    const where = andClauses.length ? { ...baseWhere, AND: andClauses } : baseWhere;
    const rows = await prisma.seed.findMany({ where, orderBy: { createdAt: 'desc' } });
    const items = rows.map((row: any) => serializeSeed(row));
    return res.json({ items, filters, meta: { count: items.length } });
  }
  const items = listSeeds(req.orgId).filter((seed) => {
    if (filters.state && seed.state !== filters.state) return false;
    const tags = seed.tags || [];
    if (filters.tag && !tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())) return false;
    if (filters.search) {
      const haystack = `${seed.title}\n${seed.notes ?? ''}`.toLowerCase();
      if (!haystack.includes(filters.search.toLowerCase())) return false;
    }
    return true;
  }).map((seed) => ({ ...seed, tags: seed.tags || [] }));
  res.json({ items, filters, meta: { count: items.length } });
});

app.post('/seeds', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  let payload;
  try {
    payload = normalizeSeedCreate(req.body || {});
  } catch (err: any) {
    const status = err?.status || 400;
    return res.status(status).json({ error: err?.message || 'invalid_seed' });
  }
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const seed = await prisma.seed.create({ data: { orgId: req.orgId, title: payload.title, notes: payload.notes ?? null, tags: payload.tags, state: payload.state } });
    return res.json({ seed: serializeSeed(seed) });
  }
  const s = createSeed(req.orgId, payload);
  res.json({ seed: { ...s, tags: s.tags || [] } });
});

app.post('/seeds/:id', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  let patch;
  try {
    patch = normalizeSeedPatch(req.body || {});
  } catch (err: any) {
    const status = err?.status || 400;
    return res.status(status).json({ error: err?.message || 'invalid_seed' });
  }
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const seed = await prisma.seed.update({ where: { id: req.params.id }, data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.state !== undefined ? { state: patch.state } : {}),
    } });
    return res.json({ seed: serializeSeed(seed) });
  }
  const memoryPatch = { ...patch } as any;
  if (patch.notes === null) {
    memoryPatch.notes = undefined;
  }
  const s = updateSeed(req.orgId, req.params.id, memoryPatch);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ seed: { ...s, tags: s.tags || [] } });
});

app.delete('/seeds/:id', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    await prisma.seed.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  }
  const ok = deleteSeed(req.orgId, req.params.id);
  res.json({ ok });
});

// Drafts/Generation and Preview (Stage 5 & 6)
function generateTextFromSeed(seedTitle: string, seedNotes?: string | null, prompt?: string, platform?: string) {
  const header = `[${(platform || 'GEN').toUpperCase()}] ${seedTitle}`;
  const promptLine = prompt ? `${prompt.trim()}` : 'Generate a compelling social post';
  const notesSection = seedNotes && seedNotes.trim().length ? `Key Points:\n- ${seedNotes.trim()}` : '';
  const body = `${promptLine}\n\n${notesSection}`.trim();
  return [header, body].filter(Boolean).join('\n\n').slice(0, 1200);
}

function delayForGeneration(platform: string) {
  const base = 80;
  const jitter = (platform.length % 3) * 40;
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

function attachDraftMetadata(draft: any) {
  const meta = getDraftMetadata(draft.id);
  const generatedAt = draft.generatedAt instanceof Date
    ? draft.generatedAt.getTime()
    : typeof draft.generatedAt === 'number'
      ? draft.generatedAt
      : meta?.generatedAt;
  return {
    ...draft,
    createdAt: draft.createdAt instanceof Date ? draft.createdAt.getTime() : draft.createdAt,
    updatedAt: draft.updatedAt instanceof Date ? draft.updatedAt.getTime() : draft.updatedAt,
    generatedAt,
    generatorMeta: meta ?? null,
  };
}

function shapeAuditEntry(audit: any) {
  return {
    id: audit.id,
    draftId: audit.draftId,
    editor: audit.editor,
    editedText: audit.editedText,
    createdAt: audit.createdAt instanceof Date ? audit.createdAt.getTime() : audit.createdAt,
  };
}

async function buildDraftResponse(orgId: string, drafts: any[]) {
  return Promise.all(
    drafts.map(async (draft) => {
      const base = attachDraftMetadata(draft);
      const approvalJob = await getApprovalJob(orgId, base.id);
      return { ...base, approvalJob };
    })
  );
}

async function publishDraft(orgId: string, draftId: string) {
  const driver = getDriver();
  const prisma = driver === 'prisma' ? getPrisma() : null;
  if (prisma) await ensurePrismaSchema(prisma);
  let draft: any;
  if (driver === 'prisma') {
    draft = await prisma!.draft.findUnique({ where: { id: draftId } });
    if (!draft || draft.orgId !== orgId) throw new Error('draft_not_found');
  } else {
    draft = listDrafts(orgId).find((d) => d.id === draftId);
    if (!draft) throw new Error('draft_not_found');
  }

  const adapter = getAdapterByKey(draft.platform);
  if (!adapter || !adapter.isEnabled()) throw new Error('adapter_disabled');

  const textSource = (draft.editedText && draft.editedText.trim().length > 0 ? draft.editedText : draft.originalText) as string;
  const validation = adapter.validateDraft({ text: textSource });
  if (!validation.ok) {
    throw new Error(validation.errors.join(', ') || 'validation_failed');
  }

  try {
    const result = await adapter.publish({ text: textSource });
    const postId = result.postId || `post_${draftId}_${Date.now()}`;
    if (driver === 'prisma') {
      await prisma!.history.create({
        data: {
          orgId,
          seedId: draft.seedId,
          draftId,
          platform: draft.platform,
          postId,
          url: result.url ?? null,
          originalText: draft.originalText,
          editedText: draft.editedText ?? null,
          status: 'success',
          error: null,
        },
      });
    } else {
      recordPublish({
        orgId,
        seedId: draft.seedId,
        draftId,
        platform: draft.platform,
        postId,
        url: result.url ?? undefined,
        originalText: draft.originalText,
        editedText: draft.editedText ?? undefined,
        status: 'success',
        error: null,
      });
    }
    await updateApprovalJobStatus(orgId, draftId, 'completed');
    return { postId, url: result.url ?? null };
  } catch (err: any) {
    const message = err?.message || 'publish_failed';
    if (driver === 'prisma') {
      await prisma!.history.create({
        data: {
          orgId,
          seedId: draft.seedId,
          draftId,
          platform: draft.platform,
          postId: `failed_${draftId}_${Date.now()}`,
          url: null,
          originalText: draft.originalText,
          editedText: draft.editedText ?? null,
          status: 'failed',
          error: message,
        },
      });
    } else {
      recordPublish({
        orgId,
        seedId: draft.seedId,
        draftId,
        platform: draft.platform,
        postId: `failed_${draftId}_${Date.now()}`,
        url: undefined,
        originalText: draft.originalText,
        editedText: draft.editedText ?? undefined,
        status: 'failed',
        error: message,
      });
    }
    await updateApprovalJobStatus(orgId, draftId, 'failed');
    throw err;
  }
}

app.post('/drafts/generate', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { seedId, platforms } = req.body as { seedId: string; platforms?: string[] };
  const orgId = req.orgId as string;
  if (!seedId) return res.status(400).json({ error: 'seed_required' });

  const requestedPlatforms = Array.from(new Set((platforms && Array.isArray(platforms) ? platforms : ['linkedin', 'x']).filter((platform) => SUPPORTED_PLATFORMS.includes(platform))));
  if (!requestedPlatforms.length) return res.status(400).json({ error: 'platforms_invalid', supported: SUPPORTED_PLATFORMS });

  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const seed = await prisma.seed.findUnique({ where: { id: seedId } });
    if (!seed || seed.orgId !== orgId) return res.status(404).json({ error: 'seed_not_found' });
    const latestPrompt = await prisma.promptVersion.findFirst({ where: { orgId }, orderBy: { createdAt: 'desc' } });
    if (!latestPrompt) return res.status(400).json({ error: 'prompt_not_configured' });

    const results: Array<{ platform: string; status: string; draft?: any; error?: string; reused?: boolean }> = [];

    for (const platform of requestedPlatforms) {
      const outcome = await ensureGeneration(
        {
          orgId,
          seedId,
          platform,
          promptVersionId: latestPrompt.id,
          promptContent: latestPrompt.content,
          seedTitle: seed.title,
          seedNotes: seed.notes ?? null,
        },
        async () => {
          await delayForGeneration(platform);
          return generateTextFromSeed(seed.title, seed.notes, latestPrompt.content, platform);
        }
      );

      if (outcome.reused && outcome.record.draftId) {
        const existing = await prisma.draft.findUnique({ where: { id: outcome.record.draftId } });
        if (existing) {
          const enriched = attachDraftMetadata(existing);
          const approvalJob = await getApprovalJob(orgId, enriched.id);
          results.push({ platform, status: 'reused', draft: { ...enriched, approvalJob }, reused: true });
          continue;
        }
      }

      if (outcome.record.status !== 'completed' || !outcome.text) {
        results.push({ platform, status: 'failed', error: outcome.record.error || 'generation_failed' });
        continue;
      }

      const generatedAt = Date.now();
      const draft = await prisma.draft.create({
        data: {
          orgId,
          seedId,
          platform,
          originalText: outcome.text,
          promptVersionId: outcome.record.promptVersionId,
          generatorRunId: outcome.record.runId,
          generatedAt: new Date(generatedAt),
        },
      });
      recordDraftMetadata(outcome.record, draft.id, generatedAt, false);
      const enriched = attachDraftMetadata(draft);
      const approvalJob = await getApprovalJob(orgId, enriched.id);
      results.push({ platform, status: 'generated', draft: { ...enriched, approvalJob } });
    }

    const items = await prisma.draft.findMany({ where: { orgId, seedId }, orderBy: { createdAt: 'desc' } });
    const enrichedDrafts = await buildDraftResponse(orgId, items);
    return res.json({ seedId, results, drafts: enrichedDrafts });
  }

  const seed = listSeeds(orgId).find((s) => s.id === seedId);
  const prompt = getActive(orgId);
  if (!seed) return res.status(404).json({ error: 'seed_not_found' });
  if (!prompt) return res.status(400).json({ error: 'prompt_not_configured' });

  const results: Array<{ platform: string; status: string; draft?: any; error?: string; reused?: boolean }> = [];

  for (const platform of requestedPlatforms) {
    const outcome = await ensureGeneration(
      {
        orgId,
        seedId,
        platform,
        promptVersionId: prompt.id,
        promptContent: prompt.content,
        seedTitle: seed.title,
        seedNotes: seed.notes ?? null,
      },
      async () => {
        await delayForGeneration(platform);
        return generateTextFromSeed(seed.title, seed.notes, prompt.content, platform);
      }
    );

    if (outcome.reused && outcome.record.draftId) {
      const existing = listDrafts(orgId, seedId).find((draft) => draft.id === outcome.record.draftId);
      if (existing) {
        const enriched = attachDraftMetadata(existing);
        const approvalJob = await getApprovalJob(orgId, enriched.id);
        results.push({ platform, status: 'reused', draft: { ...enriched, approvalJob }, reused: true });
        continue;
      }
    }

    if (outcome.record.status !== 'completed' || !outcome.text) {
      results.push({ platform, status: 'failed', error: outcome.record.error || 'generation_failed' });
      continue;
    }

    const generatedAt = Date.now();
    const draft = createDraft(orgId, seedId, platform, outcome.text, { promptVersionId: prompt.id, generatorRunId: outcome.record.runId, generatedAt });
    recordDraftMetadata(outcome.record, draft.id, generatedAt, false);
    const enrichedDraft = attachDraftMetadata(draft);
    const approvalJob = await getApprovalJob(orgId, enrichedDraft.id);
    results.push({ platform, status: 'generated', draft: { ...enrichedDraft, approvalJob } });
  }

  const drafts = await buildDraftResponse(orgId, listDrafts(orgId, seedId));
  res.json({ seedId, results, drafts });
});

app.get('/drafts', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.draft.findMany({ where: { orgId: req.orgId, ...(req.query.seedId ? { seedId: String(req.query.seedId) } : {}) }, orderBy: { createdAt: 'desc' } });
    const drafts = await buildDraftResponse(req.orgId, items);
    return res.json({ items: drafts });
  }
  const items = await buildDraftResponse(req.orgId, listDrafts(req.orgId, req.query.seedId as string | undefined));
  res.json({ items });
});

app.get('/drafts/:id', requireAuth, requireOrg, async (req: any, res) => {
  const draftId = req.params.id;
  const orgId = req.orgId as string;
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const draft = await prisma.draft.findUnique({ where: { id: draftId } });
    if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: 'not_found' });
    const audits = await prisma.draftAudit.findMany({ where: { draftId }, orderBy: { createdAt: 'desc' } });
    const approvalJob = await getApprovalJob(orgId, draftId);
    return res.json({ draft: { ...attachDraftMetadata(draft), approvalJob }, audits: audits.map((audit: any) => shapeAuditEntry(audit)) });
  }
  const draft = listDrafts(orgId).find((d) => d.id === draftId);
  if (!draft) return res.status(404).json({ error: 'not_found' });
  const audits = listDraftAudits(orgId, draftId).map((audit) => shapeAuditEntry(audit));
  const approvalJob = await getApprovalJob(orgId, draftId);
  res.json({ draft: { ...attachDraftMetadata(draft), approvalJob }, audits });
});

app.post('/drafts/:id/edit', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const text = String(req.body?.text || '');
  const editor = req.session?.user?.email || 'unknown';
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const existing = await prisma.draft.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.orgId !== req.orgId) return res.status(404).json({ error: 'not_found' });
    const draft = await prisma.draft.update({ where: { id: existing.id }, data: { editedText: text } });
    await prisma.draftAudit.create({ data: { orgId: req.orgId, draftId: draft.id, editor, editedText: text } });
    const approvalJob = await getApprovalJob(req.orgId, draft.id);
    if (approvalJob && approvalJob.status === 'pending') {
      await rescheduleApproval(req.orgId, draft.id, approvalJob, { type: 'publish', orgId: req.orgId, draftId: draft.id }, APPROVAL_DEFAULT_DELAY_MS);
    }
    const audits = await prisma.draftAudit.findMany({ where: { draftId: draft.id }, orderBy: { createdAt: 'desc' } });
    const updatedApproval = await getApprovalJob(req.orgId, draft.id);
    return res.json({ draft: { ...attachDraftMetadata(draft), approvalJob: updatedApproval }, audits: audits.map((audit: any) => shapeAuditEntry(audit)) });
  }
  const d = editDraft(req.orgId, req.params.id, text, editor);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const approvalJob = await getApprovalJob(req.orgId, req.params.id);
  if (approvalJob && approvalJob.status === 'pending') {
    await rescheduleApproval(req.orgId, req.params.id, approvalJob, { type: 'publish', orgId: req.orgId, draftId: req.params.id }, APPROVAL_DEFAULT_DELAY_MS);
  }
  const audits = listDraftAudits(req.orgId, req.params.id).map((audit) => shapeAuditEntry(audit));
  const updatedApproval = await getApprovalJob(req.orgId, req.params.id);
  res.json({ draft: { ...attachDraftMetadata(d), approvalJob: updatedApproval }, audits });
});

app.post('/preview/validate', requireAuth, requireOrg, (req: any, res) => {
  const { platform, text } = req.body as { platform: string; text: string };
  const adapter = getAdapterByKey(platform);
  if (!adapter) return res.status(400).json({ ok: false, errors: ['unknown_platform'] });
  const r = adapter.validateDraft({ text });
  res.json(r);
});

// Approve and Undo Queue (Stage 7)
app.post('/approve', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { draftId, delayMs } = req.body as { draftId: string; delayMs?: number };
  const orgId = req.orgId as string;
  const delay = typeof delayMs === 'number' ? delayMs : APPROVAL_DEFAULT_DELAY_MS;
  let draft: any;
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    draft = await prisma.draft.findUnique({ where: { id: draftId } });
    if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: 'draft_not_found' });
  } else {
    draft = listDrafts(orgId).find((d) => d.id === draftId);
    if (!draft) return res.status(404).json({ error: 'draft_not_found' });
  }

  const existing = await getApprovalJob(orgId, draftId);
  if (existing && existing.status === 'pending') {
    await cancelQueueJobById(existing.jobId);
    await updateApprovalJobStatus(orgId, draftId, 'cancelled');
  }

  const payload = { type: 'publish', orgId, draftId };
  const scheduled = await scheduleApprovalJob(orgId, draftId, delay, payload);
  res.json({ job: scheduled });
});

app.get('/approve/jobs', requireAuth, requireOrg, async (req: any, res) => {
  const jobs = await listApprovalJobs(req.orgId);
  res.json({ jobs });
});

app.post('/approve/cancel', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { jobId, draftId } = req.body as { jobId: string; draftId?: string };
  if (!jobId) return res.status(400).json({ error: 'jobId_required' });
  const orgId = req.orgId as string;
  let approval = draftId ? await getApprovalJob(orgId, draftId) : null;
  if (!approval) {
    const jobs = await listApprovalJobs(orgId);
    approval = jobs.find((job) => job.jobId === jobId) || null;
  }
  if (!approval) return res.json({ ok: false });
  await cancelQueueJobById(approval.jobId);
  await updateApprovalJobStatus(orgId, approval.draftId, 'cancelled');
  res.json({ ok: true });
});

// Publish and History (Stage 8)
app.post('/publish/run-now', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { draftId } = req.body as { draftId?: string };
  const orgId = req.orgId as string;
  if (!draftId) return res.status(400).json({ error: 'draftId_required' });
  try {
    const result = await publishDraft(orgId, String(draftId));
    return res.json({ ok: true, result });
  } catch (err) {
    const message = (err as any)?.message || 'publish_failed';
    return res.status(500).json({ error: message });
  }
});



if (getQueueDriver() === 'bullmq') {
  initBull();
  const globalAny = global as any;
  if (!globalAny.__composrPublishWorkerStarted) {
    startBullWorker(async (payload) => {
      if (payload?.type === 'publish') {
        await publishDraft(String(payload.orgId), String(payload.draftId));
      }
    });
    globalAny.__composrPublishWorkerStarted = true;
  }
}

app.post('/publish/process-due', requireAuth, csrfProtection, async (req: any, res) => {
  if (getQueueDriver() === 'bullmq') {
    return res.json({ driver: 'bullmq', processed: 0 });
  }
  const processed: Array<{ jobId: string; draftId?: string; status: string; error?: string }> = [];
  const due = dueJobs();
  for (const job of due) {
    const draftId = job.payload?.draftId ? String(job.payload.draftId) : undefined;
    if (!draftId) {
      markFailed(job.id);
      processed.push({ jobId: job.id, status: 'failed', error: 'draftId_missing' });
      continue;
    }
    try {
      await publishDraft(job.orgId, draftId);
      markCompleted(job.id);
      processed.push({ jobId: job.id, draftId, status: 'success' });
    } catch (err: any) {
      markFailed(job.id);
      const message = err?.message || 'publish_failed';
      processed.push({ jobId: job.id, draftId, status: 'failed', error: message });
    }
  }
  res.json({ processed });
});

app.get('/history', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.history.findMany({ where: { orgId: req.orgId }, orderBy: { publishedAt: 'desc' } });
    return res.json({ items });
  }
  res.json({ items: listHistory(req.orgId) });
});

// Analytics ingest
app.post('/analytics/ingest', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const orgId = req.orgId as string;
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    await prisma.metric.create({ data: { orgId, postId: String(req.body?.postId || ''), platform: String(req.body?.platform || ''), likes: Number(req.body?.likes || 0), comments: Number(req.body?.comments || 0), shares: Number(req.body?.shares || 0), impressions: req.body?.impressions == null ? null : Number(req.body?.impressions), at: new Date(Number(req.body?.at || Date.now())) } });
    return res.json({ ok: true });
  }
  addMetric({ ...req.body, orgId });
  res.json({ ok: true });
});

app.get('/analytics/list', requireAuth, requireOrg, async (req: any, res) => {
  const { platform, from, to } = req.query as any;
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.metric.findMany({ where: { orgId: req.orgId, ...(platform ? { platform: String(platform) } : {}), ...(from ? { at: { gte: new Date(Number(from)) } } : {}), ...(to ? { at: { lte: new Date(Number(to)) } } : {}) }, orderBy: { at: 'asc' } });
    return res.json({ metrics: items });
  }
  const parsed = listMetrics({
    orgId: req.orgId,
    platform,
    from: from ? Number(from) : undefined,
    to: to ? Number(to) : undefined,
  });
  res.json({ metrics: parsed });
});

// Scheduling endpoints
app.get('/schedules', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.schedule.findMany({ where: { orgId: req.orgId }, orderBy: { runAt: 'asc' } });
    return res.json({ items });
  }
  res.json({ items: listSchedules(req.orgId) });
});

app.post('/schedules', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { platform, postId, runAt } = req.body as { platform: string; postId: string; runAt: number };
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    // naive conflict check: same platform within 5m
    const min = new Date(Number(runAt) - 5 * 60 * 1000);
    const max = new Date(Number(runAt) + 5 * 60 * 1000);
    const conflict = await prisma.schedule.findFirst({ where: { orgId: req.orgId, platform, runAt: { gte: min, lte: max } } });
    if (conflict) return res.status(409).json({ error: 'conflict' });
    const scheduled = await prisma.schedule.create({ data: { orgId: req.orgId, platform, postId, runAt: new Date(Number(runAt)) } });
    return res.json({ scheduled });
  }
  try {
    const s = schedulePost(req.orgId, { orgId: req.orgId, platform, postId, runAt });
    res.json({ scheduled: s });
  } catch (e: any) {
    if (e?.message === 'conflict') return res.status(409).json({ error: 'conflict' });
    return res.status(400).json({ error: 'bad_request' });
  }
});

app.post('/schedules/:id/reschedule', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const existing = await prisma.schedule.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.orgId !== req.orgId) return res.status(404).json({ error: 'not_found' });
    const runAt = Number(req.body?.runAt);
    const min = new Date(runAt - 5 * 60 * 1000);
    const max = new Date(runAt + 5 * 60 * 1000);
    const conflict = await prisma.schedule.findFirst({ where: { orgId: req.orgId, platform: existing.platform, NOT: { id: existing.id }, runAt: { gte: min, lte: max } } });
    if (conflict) return res.status(409).json({ error: 'conflict' });
    const scheduled = await prisma.schedule.update({ where: { id: existing.id }, data: { runAt: new Date(runAt) } });
    return res.json({ scheduled });
  }
  try {
    const s = reschedulePost(req.orgId, req.params.id, Number(req.body?.runAt));
    res.json({ scheduled: s });
  } catch (e: any) {
    if (e?.message === 'conflict') return res.status(409).json({ error: 'conflict' });
    if (e?.message === 'not_found') return res.status(404).json({ error: 'not_found' });
    return res.status(400).json({ error: 'bad_request' });
  }
});

// Exports
app.get('/exports/csv', requireAuth, requireOrg, (req: any, res) => {
  const { platform, from, to } = req.query as any;
  const csv = generateCSV({ orgId: req.orgId, platform, from: from ? Number(from) : undefined, to: to ? Number(to) : undefined });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
  res.send(csv);
});

app.get('/exports/pdf', requireAuth, requireOrg, async (req: any, res) => {
  const { platform, from, to } = req.query as any;
  const pdf = await generatePDF({ orgId: req.orgId, platform, from: from ? Number(from) : undefined, to: to ? Number(to) : undefined });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="analytics.pdf"');
  res.send(pdf);
});

// Inbox fixtures and recommendations (stub classifier)
const inboxFixtures = [
  { id: 'm1', subject: 'Product launch next week', body: 'Draft your announcement.' },
  { id: 'm2', subject: 'Industry report: AI trends', body: 'Key takeaways for your audience.' },
  { id: 'm3', subject: 'Team milestone', body: 'We shipped v1.2' }
];

function classifyRelevant(message: { subject: string; body: string }) {
  const text = `${message.subject} ${message.body}`.toLowerCase();
  const score = (text.includes('launch') ? 0.5 : 0) + (text.includes('report') ? 0.3 : 0) + (text.includes('milestone') ? 0.2 : 0);
  return score; // 0..1
}

app.get('/inbox/recommendations', requireAuth, requireOrg, (_req, res) => {
  const recs = inboxFixtures
    .map((m) => ({ ...m, score: classifyRelevant(m) }))
    .filter((m) => m.score >= 0.3)
    .sort((a, b) => b.score - a.score);
  res.json({ items: recs });
});

// Collaboration endpoints
app.get('/collab/suggestions', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.suggestion.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    return res.json({ items });
  }
  res.json({ items: listSuggestions(req.orgId) });
});

app.post('/collab/suggestions', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const content = String(req.body?.content || '');
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const suggestion = await prisma.suggestion.create({ data: { orgId: req.orgId, content, createdBy: req.session.user.email, status: 'suggested' } });
    return res.json({ suggestion });
  }
  const role = getRole(req.session.user.email, req.orgId);
  if (!canSuggest(role)) return res.status(403).json({ error: 'forbidden' });
  const s = createSuggestion(req.orgId, content, req.session.user.email);
  res.json({ suggestion: s });
});

app.post('/collab/suggestions/:id/approve', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    // Only owners can approve: enforce like memory path
    const role = getRole(req.session.user.email, req.orgId);
    if (!canApprove(role)) return res.status(403).json({ error: 'forbidden' });
    const suggestion = await prisma.suggestion.update({ where: { id: req.params.id }, data: { status: 'approved' } });
    return res.json({ suggestion });
  }
  const role = getRole(req.session.user.email, req.orgId);
  if (!canApprove(role)) return res.status(403).json({ error: 'forbidden' });
  const s = approveSuggestion(req.orgId, req.params.id, req.session.user.email);
  res.json({ suggestion: s });
});

app.get('/collab/suggestions/:id/comments', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.comment.findMany({ where: { orgId: req.orgId, suggestionId: req.params.id }, orderBy: { createdAt: 'desc' } });
    return res.json({ items });
  }
  res.json({ items: listComments(req.orgId, req.params.id) });
});

app.post('/collab/suggestions/:id/comments', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const text = String(req.body?.text || '');
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const comment = await prisma.comment.create({ data: { orgId: req.orgId, suggestionId: req.params.id, text, author: req.session.user.email } });
    return res.json({ comment });
  }
  const role = getRole(req.session.user.email, req.orgId);
  if (!canComment(role)) return res.status(403).json({ error: 'forbidden' });
  const c = addComment(req.orgId, req.params.id, text, req.session.user.email);
  res.json({ comment: c });
});

app.get('/collab/activity', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.activity.findMany({ where: { orgId: req.orgId }, orderBy: { at: 'desc' } });
    return res.json({ items });
  }
  res.json({ items: listActivity(req.orgId) });
});

// CSRF token endpoint
app.get('/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: (req as any).csrfToken() });
});

// Simple in-memory users
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const USER2_EMAIL = process.env.USER2_EMAIL || 'user2@example.com';
const USER2_PASSWORD = process.env.USER2_PASSWORD || 'changeme';

app.post('/auth/login', rateLimitAuth, csrfProtection, (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const valid =
    (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) ||
    (email === USER2_EMAIL && password === USER2_PASSWORD);
  if (valid) {
    (req.session as any).user = { email };
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'invalid_credentials' });
});

app.post('/auth/logout', csrfProtection, (req, res) => {
  (req.session as any) = null;
  res.status(200).json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  const user = (req.session as any)?.user;
  if (!user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user });
});

// OAuth scaffolding
app.get('/oauth/:provider/start', requireAuth, requireOrg, oauthStart);
app.get('/oauth/:provider/callback', requireAuth, requireOrg, async (req: any, res) => {
  const provider = req.params.provider as string;
  // In production: exchange code for tokens. Here we persist a stub token payload encrypted
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const data = encryptJson({ accessToken: 'stub', refreshToken: 'stub', obtainedAt: Date.now() });
    await prisma.integration.upsert({ where: { orgId_provider: { orgId: req.orgId, provider } } as any, update: { data }, create: { orgId: req.orgId, provider, data } });
  }
  return res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

if (getQueueDriver() === 'bullmq') {
  initBull();
  const globalAny = global as any;
  if (!globalAny.__composrPublishWorkerStarted) {
    startBullWorker(async (payload) => {
      if (payload?.type === 'publish') {
        await publishDraft(String(payload.orgId), String(payload.draftId));
      }
    });
    globalAny.__composrPublishWorkerStarted = true;
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', message: 'ComposR WS ready' }));
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${PORT}`);
});
