import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import { getProvidersInfo, getAdapterByKey } from './providers/registry';
import { addMetric, listMetrics } from './analytics';
import { generateCSV, generatePDF } from './exports';
import { createOrgForUser, getActiveOrgId, listMembershipsForUser, setActiveOrg, isUserMemberOfOrg, addMember, getRole } from './tenancy';
import { addComment, approveSuggestion, canApprove, canComment, canSuggest, createSuggestion, listActivity, listComments, listSuggestions } from './collab';
import { list as listSchedules, reschedule as reschedulePost, schedule as schedulePost } from './scheduling';
import { getCredentials, redact, setCredentials, status as integrationStatus, testConnection } from './integrations';
import { activate, createVersion, getActive, listVersions } from './prompts';
import { createSeed, deleteSeed, listSeeds, updateSeed } from './seeds';
import { createDraft, editDraft, listDrafts } from './drafts';
import { cancelJob, runNow, scheduleJob } from './queue';
import { recordPublish, listHistory } from './history';
import { getQueueDriver, initBull, addBullJob, startBullWorker } from './queueDriver';
import { getDriver } from './repo';
import { getPrisma } from './prismaClient';

const app = express();
app.use(helmet());

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
app.get('/integrations/status', requireAuth, requireOrg, (req: any, res) => {
  res.json({ providers: integrationStatus(req.orgId) });
});

app.post('/integrations/creds/:key', requireAuth, requireOrg, csrfProtection, (req: any, res) => {
  const key = req.params.key as any;
  setCredentials(req.orgId, key, req.body || {});
  res.json({ ok: true, creds: redact(getCredentials(req.orgId, key)) });
});

app.post('/integrations/test/:key', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const key = req.params.key as any;
  const result = await testConnection(req.orgId, key);
  res.json(result);
});

// Master Prompt (Stage 3)
app.get('/prompts', requireAuth, requireOrg, async (req: any, res) => {
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const versions = await prisma.promptVersion.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    const active = versions[0] || null; // latest as active placeholder
    return res.json({ versions, active });
  }
  res.json({ versions: listVersions(req.orgId), active: getActive(req.orgId) });
});

app.post('/prompts', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const content = String(req.body?.content || '');
  const notes = req.body?.notes as string | undefined;
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    const version = await prisma.promptVersion.create({ data: { orgId: req.orgId, content, notes, author: req.session.user.email } });
    return res.json({ version });
  }
  const v = createVersion(req.orgId, req.session.user.email, content, notes);
  res.json({ version: v });
});

app.post('/prompts/activate', requireAuth, requireOrg, csrfProtection, async (req: any, res) => {
  const id = String(req.body?.id || '');
  if (getDriver() === 'prisma') {
    const prisma = getPrisma();
    // No explicit active pointer in schema; return version for now
    const version = await prisma.promptVersion.findUnique({ where: { id } });
    if (!version || version.orgId !== req.orgId) return res.status(404).json({ error: 'not_found' });
    return res.json({ version });
  }
  const v = activate(req.orgId, id);
  if (!v) return res.status(404).json({ error: 'not_found' });
  res.json({ version: v });
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
    // BullMQ cancel: remove job by id
    try {
      const connection = (initBull() as any).bullQueue.client;
      // Fallback: not removing here in stub; return ok
      return res.json({ ok: true });
    } catch {
      return res.json({ ok: false });
    }
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
app.post('/analytics/ingest', requireAuth, requireOrg, csrfProtection, (req: any, res) => {
  const orgId = req.orgId as string;
  addMetric({ ...req.body, orgId });
  res.json({ ok: true });
});

app.get('/analytics/list', requireAuth, requireOrg, (req: any, res) => {
  const { platform, from, to } = req.query as any;
  const parsed = listMetrics({
    orgId: req.orgId,
    platform,
    from: from ? Number(from) : undefined,
    to: to ? Number(to) : undefined,
  });
  res.json({ metrics: parsed });
});

// Exports
app.get('/exports/csv', requireAuth, requireOrg, (req: any, res) => {
  const { platform, from, to } = req.query as any;
  const csv = generateCSV({ platform, from: from ? Number(from) : undefined, to: to ? Number(to) : undefined });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
  res.send(csv);
});

app.get('/exports/pdf', requireAuth, requireOrg, async (req: any, res) => {
  const { platform, from, to } = req.query as any;
  const pdf = await generatePDF({ platform, from: from ? Number(from) : undefined, to: to ? Number(to) : undefined });
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

// CSRF token endpoint
app.get('/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: (req as any).csrfToken() });
});

// Simple in-memory users
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const USER2_EMAIL = process.env.USER2_EMAIL || 'user2@example.com';
const USER2_PASSWORD = process.env.USER2_PASSWORD || 'changeme';

app.post('/auth/login', csrfProtection, (req, res) => {
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
