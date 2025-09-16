import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import { getProvidersInfo } from './providers/registry';
import { addMetric, listMetrics } from './analytics';
import { generateCSV, generatePDF } from './exports';
import { createOrgForUser, getActiveOrgId, listMembershipsForUser, setActiveOrg, isUserMemberOfOrg } from './tenancy';

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

// Simple in-memory single admin user placeholder
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

app.post('/auth/login', csrfProtection, (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
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

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', message: 'ComposR WS ready' }));
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${PORT}`);
});
