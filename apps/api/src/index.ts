import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
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

const csrfProtection = csrf({ cookie: true });

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
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
