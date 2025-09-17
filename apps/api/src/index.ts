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
import { createDraft, editDraft, listDrafts } from './drafts';
import { cancelJob, runNow, scheduleJob } from './queue';
import { recordPublish, listHistory } from './history';
import { getQueueDriver, initBull, addBullJob, startBullWorker, removeBullJob } from './queueDriver';
import { getDriver } from './repo';
import { getPrisma } from './prismaClient';
import { encryptJson } from './crypto';
import { withRequestId } from './logging';
import { oauthStart, oauthCallback } from './oauth';
import { diffLines, type DiffSegment } from './diff';

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
    await prisma.integration.upsert({ where: { orgId_provider: { orgId: req.orgId, provider: key } }, update: { data: serializeSecretRecord(record) }, create: { orgId: req.orgId, provider: key, data: serializeSecretRecord(record) } });
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
    const row = await prisma.integration.findUnique({ where: { orgId_provider: { orgId: req.orgId, provider: key } } });
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
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.seed.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    return res.json({ items });
  }
  res.json({ items: listSeeds(req.orgId) });
});

app.post('/seeds', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const payload = {
    title: String(req.body?.title || ''),
    notes: req.body?.notes,
    tags: (req.body?.tags || []) as string[],
    state: 'draft' as const,
  };
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const seed = await prisma.seed.create({ data: { orgId: req.orgId, ...payload } });
    return res.json({ seed });
  }
  const s = createSeed(req.orgId, payload);
  res.json({ seed: s });
});

app.post('/seeds/:id', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const seed = await prisma.seed.update({ where: { id: req.params.id }, data: req.body || {} });
    return res.json({ seed });
  }
  const s = updateSeed(req.orgId, req.params.id, req.body || {});
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ seed: s });
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
function generateTextFromSeed(seedTitle: string, prompt?: string, platform?: string) {
  const base = prompt ? `[${platform}] ${prompt}: ${seedTitle}` : `[${platform}] ${seedTitle}`;
  return base.slice(0, 1000);
}

app.post('/drafts/generate', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { seedId, platforms } = req.body as { seedId: string; platforms: string[] };
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const seed = await prisma.seed.findUnique({ where: { id: seedId } });
    if (!seed || seed.orgId !== req.orgId) return res.status(404).json({ error: 'seed_not_found' });
    const latestPrompt = await prisma.promptVersion.findFirst({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    const drafts = [] as any[];
    for (const p of platforms || []) {
      const text = generateTextFromSeed(seed.title, latestPrompt?.content, p);
      const d = await prisma.draft.create({ data: { orgId: req.orgId, seedId, platform: p, originalText: text } });
      drafts.push(d);
    }
    return res.json({ drafts });
  }
  const seed = listSeeds(req.orgId).find((s) => s.id === seedId);
  const prompt = getActive(req.orgId)?.content;
  if (!seed) return res.status(404).json({ error: 'seed_not_found' });
  const drafts = (platforms || []).map((p) => createDraft(req.orgId, seedId, p, generateTextFromSeed(seed.title, prompt, p)));
  res.json({ drafts });
});

app.get('/drafts', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const items = await prisma.draft.findMany({ where: { orgId: req.orgId, ...(req.query.seedId ? { seedId: String(req.query.seedId) } : {}) }, orderBy: { createdAt: 'desc' } });
    return res.json({ items });
  }
  res.json({ items: listDrafts(req.orgId, req.query.seedId as string | undefined) });
});

app.post('/drafts/:id/edit', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const text = String(req.body?.text || '');
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const draft = await prisma.draft.update({ where: { id: req.params.id }, data: { editedText: text } });
    return res.json({ draft });
  }
  const d = editDraft(req.orgId, req.params.id, text);
  if (!d) return res.status(404).json({ error: 'not_found' });
  res.json({ draft: d });
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
  const draft = listDrafts(orgId).find((d) => d.id === draftId);
  if (!draft) return res.status(404).json({ error: 'draft_not_found' });
  if (getQueueDriver() === 'bullmq') {
    const ms = delayMs ?? 7 * 60 * 1000;
    const job = await addBullJob({ type: 'publish', orgId, draftId }, { delay: ms, attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    return res.json({ job: { id: job.id } });
  }
  const job = scheduleJob(orgId, { type: 'publish', draftId }, delayMs ?? 7 * 60 * 1000);
  res.json({ job });
});

app.post('/approve/cancel', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { jobId } = req.body as { jobId: string };
  if (getQueueDriver() === 'bullmq') {
    const ok = await removeBullJob(jobId);
    return res.json({ ok });
  }
  res.json({ ok: cancelJob(jobId) });
});

// Publish and History (Stage 8)
app.post('/publish/run-now', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const { jobId } = req.body as { jobId: string };
  if (getQueueDriver() === 'bullmq') {
    const orgId = req.orgId as string;
    const draftId = String(req.body?.draftId || '');
    if (getDriver() === 'prisma') {
      const prisma = getPrisma();
      const draft = await prisma.draft.findUnique({ where: { id: draftId } });
      if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: 'draft_not_found' });
      const published = await prisma.history.create({ data: { orgId, seedId: draft.seedId, draftId: draft.id, platform: draft.platform, postId: 'post_' + draft.id, originalText: draft.originalText, editedText: draft.editedText || null } });
      return res.json({ published });
    }
    const draft = listDrafts(orgId).find((d) => d.id === draftId);
    if (!draft) return res.status(404).json({ error: 'draft_not_found' });
    const hist = recordPublish({
      orgId,
      seedId: draft.seedId,
      draftId: draft.id,
      platform: draft.platform,
      postId: 'post_' + draft.id,
      originalText: draft.originalText,
      editedText: draft.editedText,
    });
    return res.json({ published: hist });
  }
  const job = runNow(jobId);
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  const orgId = req.orgId as string;
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const draft = await prisma.draft.findUnique({ where: { id: String(job.payload?.draftId) } });
    if (!draft || draft.orgId !== orgId) return res.status(404).json({ error: 'draft_not_found' });
    const published = await prisma.history.create({ data: { orgId, seedId: draft.seedId, draftId: draft.id, platform: draft.platform, postId: 'post_' + draft.id, originalText: draft.originalText, editedText: draft.editedText || null } });
    return res.json({ published });
  }
  const draft = listDrafts(orgId).find((d) => d.id === job.payload?.draftId);
  if (!draft) return res.status(404).json({ error: 'draft_not_found' });
  const hist = recordPublish({
    orgId,
    seedId: draft.seedId,
    draftId: draft.id,
    platform: draft.platform,
    postId: 'post_' + draft.id,
    originalText: draft.originalText,
    editedText: draft.editedText,
  });
  res.json({ published: hist });
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
    await prisma.integration.upsert({ where: { orgId_provider: { orgId: req.orgId, provider } }, update: { data }, create: { orgId: req.orgId, provider, data } });
  }
  return res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

if (getQueueDriver() === 'bullmq') {
  initBull();
  startBullWorker(async (payload) => {
    if (payload?.type === 'publish') {
      const orgId = payload.orgId as string;
      const draftId = payload.draftId as string;
      if (getDriver() === 'prisma') {
        const prisma = getPrisma();
        const draft = await prisma.draft.findUnique({ where: { id: draftId } });
        if (draft && draft.orgId === orgId) {
          await prisma.history.create({ data: { orgId, seedId: draft.seedId, draftId: draft.id, platform: draft.platform, postId: 'post_' + draft.id, originalText: draft.originalText, editedText: draft.editedText || null } });
        }
        return;
      }
      const draft = listDrafts(orgId).find((d) => d.id === draftId);
      if (draft) {
        recordPublish({
          orgId,
          seedId: draft.seedId,
          draftId: draft.id,
          platform: draft.platform,
          postId: 'post_' + draft.id,
          originalText: draft.originalText,
          editedText: draft.editedText,
        });
      }
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', message: 'ComposR WS ready' }));
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${PORT}`);
});
