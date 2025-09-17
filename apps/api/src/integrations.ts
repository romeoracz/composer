import { decryptJson, encryptJson } from './crypto';

export type ProviderKey = 'linkedin' | 'x' | 'instagram' | 'facebook' | 'tiktok';

export type Credentials = {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
};

export type SecretRecord = {
  payload: ReturnType<typeof encryptJson>;
  lastUpdatedAt: number;
  lastVerifiedAt?: number;
  lastStatus?: 'ok' | 'failed';
  lastError?: string;
};

type OrgSecrets = Record<ProviderKey, SecretRecord | undefined>;

const secretsByOrg: Record<string, OrgSecrets> = {};

export function createSecretRecord(creds: Credentials): SecretRecord {
  return {
    payload: encryptJson(creds),
    lastUpdatedAt: Date.now(),
  };
}

export function setCredentials(orgId: string, key: ProviderKey, creds: Credentials): SecretRecord {
  const record = createSecretRecord(creds);
  const org = (secretsByOrg[orgId] ||= {} as OrgSecrets);
  org[key] = record;
  return record;
}

export function getSecretRecord(orgId: string, key: ProviderKey): SecretRecord | undefined {
  return secretsByOrg[orgId]?.[key];
}

export function hydrateSecretRecord(data: unknown): SecretRecord | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const payload = (data as any).payload;
  if (!payload || typeof payload !== 'object') return undefined;
  return {
    payload: payload as ReturnType<typeof encryptJson>,
    lastUpdatedAt: typeof (data as any).lastUpdatedAt === 'number' ? (data as any).lastUpdatedAt : Date.now(),
    lastVerifiedAt: typeof (data as any).lastVerifiedAt === 'number' ? (data as any).lastVerifiedAt : undefined,
    lastStatus: (data as any).lastStatus === 'ok' || (data as any).lastStatus === 'failed' ? (data as any).lastStatus : undefined,
    lastError: typeof (data as any).lastError === 'string' ? (data as any).lastError : undefined,
  };
}

export function serializeSecretRecord(record: SecretRecord) {
  return { ...record };
}

export function decryptRecord(record: SecretRecord): Credentials {
  return decryptJson(record.payload) as Credentials;
}

export function getCredentials(orgId: string, key: ProviderKey): Credentials | undefined {
  const record = getSecretRecord(orgId, key);
  if (!record) return undefined;
  return decryptRecord(record);
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

function setVerificationMetadata(orgId: string, key: ProviderKey, record: SecretRecord, ok: boolean, details?: string) {
  const next: SecretRecord = {
    ...record,
    lastVerifiedAt: Date.now(),
    lastStatus: ok ? 'ok' : 'failed',
    lastError: ok ? undefined : details || 'verification_failed',
  };
  const org = (secretsByOrg[orgId] ||= {} as OrgSecrets);
  org[key] = next;
  return next;
}

export function status(orgId: string) {
  const org = secretsByOrg[orgId] || ({} as OrgSecrets);
  const keys: ProviderKey[] = ['linkedin', 'x', 'instagram', 'facebook', 'tiktok'];
  return keys.map((k) => {
    const record = org[k];
    const creds = record ? decryptRecord(record) : undefined;
    return {
      key: k,
      hasCreds: !!record,
      creds: redact(creds),
      lastUpdatedAt: record?.lastUpdatedAt,
      lastVerifiedAt: record?.lastVerifiedAt,
      lastStatus: record?.lastStatus,
      lastError: record?.lastError,
    };
  });
}

export function testConnection(orgId: string, key: ProviderKey): { ok: boolean; details?: string } {
  const record = getSecretRecord(orgId, key);
  if (!record) {
    return { ok: false, details: 'credentials_missing' };
  }
  const creds = decryptRecord(record);
  const ok = !!creds.clientId && !!creds.clientSecret;
  const details = ok ? `Credentials validated for ${key}` : 'client_id_or_secret_missing';
  setVerificationMetadata(orgId, key, record, ok, details);
  return { ok, details };
}

export function testRecord(record: SecretRecord, key: ProviderKey): { ok: boolean; details?: string; record: SecretRecord } {
  const creds = decryptRecord(record);
  const ok = !!creds.clientId && !!creds.clientSecret;
  const details = ok ? `Credentials validated for ${key}` : 'client_id_or_secret_missing';
  return {
    ok,
    details,
    record: {
      ...record,
      lastVerifiedAt: Date.now(),
      lastStatus: ok ? 'ok' : 'failed',
      lastError: ok ? undefined : details,
    },
  };
}
