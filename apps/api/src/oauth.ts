import type { Request, Response } from 'express';

function getRedirectBase() {
  return process.env.REDIRECT_BASE_URL || 'http://localhost:4000';
}

function getProviderConfig(provider: string) {
  const map: Record<string, { authUrl: string; tokenUrl: string; scope: string[]; clientId?: string; clientSecret?: string; callbackPath: string }> = {
    linkedin: {
      authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      scope: ['w_member_social', 'r_liteprofile'],
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      callbackPath: '/oauth/linkedin/callback',
    },
    x: {
      authUrl: 'https://twitter.com/i/oauth2/authorize',
      tokenUrl: 'https://api.twitter.com/2/oauth2/token',
      scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
      callbackPath: '/oauth/x/callback',
    },
  };
  return map[provider];
}

export function oauthStart(req: Request, res: Response) {
  const provider = req.params.provider;
  const cfg = getProviderConfig(provider);
  if (!cfg || !cfg.clientId) return res.status(400).json({ error: 'provider_not_configured' });
  const redirectUri = getRedirectBase() + cfg.callbackPath;
  const state = Math.random().toString(36).slice(2);
  const url = new URL(cfg.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', cfg.scope.join(' '));
  url.searchParams.set('state', state);
  return res.json({ url: url.toString(), state });
}

export async function oauthCallback(req: Request, res: Response) {
  const provider = req.params.provider;
  const cfg = getProviderConfig(provider);
  if (!cfg || !cfg.clientId || !cfg.clientSecret) return res.status(400).json({ error: 'provider_not_configured' });
  const code = String(req.query.code || '');
  if (!code) return res.status(400).json({ error: 'missing_code' });
  // Stub: In production, exchange code for tokens via cfg.tokenUrl
  return res.json({ ok: true, provider, receivedCode: true });
}
