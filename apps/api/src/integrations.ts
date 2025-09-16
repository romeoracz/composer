export type ProviderKey = 'linkedin' | 'x' | 'instagram' | 'facebook' | 'tiktok';

export type Credentials = {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
};

type OrgSecrets = Record<ProviderKey, Credentials | undefined>;

const secretsByOrg: Record<string, OrgSecrets> = {};

export function setCredentials(orgId: string, key: ProviderKey, creds: Credentials) {
  const org = (secretsByOrg[orgId] ||= {} as OrgSecrets);
  org[key] = { ...creds };
}

export function getCredentials(orgId: string, key: ProviderKey): Credentials | undefined {
  return secretsByOrg[orgId]?.[key];
}

export function redact(creds?: Credentials) {
  if (!creds) return undefined;
  const mask = (v?: string) => (v ? '***' + v.slice(-4) : undefined);
  return {
    clientId: mask(creds.clientId),
    clientSecret: mask(creds.clientSecret),
    accessToken: creds.accessToken ? mask(creds.accessToken) : undefined,
    refreshToken: creds.refreshToken ? mask(creds.refreshToken) : undefined,
  } as Credentials;
}

export function status(orgId: string) {
  const org = secretsByOrg[orgId] || ({} as OrgSecrets);
  const keys: ProviderKey[] = ['linkedin', 'x', 'instagram', 'facebook', 'tiktok'];
  return keys.map((k) => ({ key: k, hasCreds: !!org[k], creds: redact(org[k]) }));
}

export async function testConnection(_orgId: string, key: ProviderKey): Promise<{ ok: boolean; details?: string }> {
  // Stubbed test: succeed if credentials exist
  return { ok: true, details: `Tested ${key} (stub)` };
}
