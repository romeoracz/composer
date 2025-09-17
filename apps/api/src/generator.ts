import crypto from 'crypto';

export type SeedState = 'draft' | 'ready';

export type GenerationContext = {
  orgId: string;
  seedId: string;
  platform: string;
  promptVersionId?: string | null;
  promptContent: string;
  seedTitle: string;
  seedNotes?: string | null;
};

export type GenerationRecord = {
  runId: string;
  idempotencyKey: string;
  orgId: string;
  seedId: string;
  platform: string;
  promptVersionId?: string | null;
  promptHash: string;
  seedHash: string;
  status: 'pending' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  draftId?: string;
  startedAt: number;
  completedAt?: number;
  reused?: boolean;
};

export type GenerationOutcome = {
  reused: boolean;
  record: GenerationRecord;
  text?: string;
};

export type DraftMetadata = {
  draftId: string;
  orgId: string;
  seedId: string;
  platform: string;
  promptVersionId?: string | null;
  runId: string;
  generatedAt: number;
  reused: boolean;
};

const recordsByKey = new Map<string, GenerationRecord>();
const recordsByRunId = new Map<string, GenerationRecord>();
const metadataByDraftId = new Map<string, DraftMetadata>();

function sha(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function computeIdempotencyKey(ctx: GenerationContext): string {
  const promptHash = sha(ctx.promptContent);
  const seedHash = sha(`${ctx.seedTitle}\n${ctx.seedNotes ?? ''}`);
  return `${ctx.orgId}:${ctx.seedId}:${ctx.platform}:${ctx.promptVersionId ?? 'none'}:${promptHash}:${seedHash}`;
}

function createRecord(ctx: GenerationContext): GenerationRecord {
  const runId = `gen_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(6).toString('hex')}`;
  const promptHash = sha(ctx.promptContent);
  const seedHash = sha(`${ctx.seedTitle}\n${ctx.seedNotes ?? ''}`);
  const idempotencyKey = computeIdempotencyKey(ctx);
  const record: GenerationRecord = {
    runId,
    idempotencyKey,
    orgId: ctx.orgId,
    seedId: ctx.seedId,
    platform: ctx.platform,
    promptVersionId: ctx.promptVersionId,
    promptHash,
    seedHash,
    status: 'pending',
    attempts: 0,
    startedAt: Date.now(),
  };
  recordsByKey.set(idempotencyKey, record);
  recordsByRunId.set(runId, record);
  return record;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureGeneration(
  ctx: GenerationContext,
  generator: () => Promise<string>,
  options: { maxAttempts?: number; baseBackoffMs?: number } = {}
): Promise<GenerationOutcome> {
  const existing = recordsByKey.get(computeIdempotencyKey(ctx));
  if (existing && existing.status === 'completed' && existing.draftId) {
    return { reused: true, record: { ...existing, reused: true } };
  }

  const record = existing ?? createRecord(ctx);
  const maxAttempts = options.maxAttempts ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 150;

  for (let attempt = record.attempts; attempt < maxAttempts; attempt += 1) {
    record.attempts = attempt + 1;
    try {
      const text = await generator();
      record.status = 'completed';
      record.error = undefined;
      record.completedAt = Date.now();
      return { reused: false, record, text };
    } catch (err: any) {
      record.error = err?.message || 'generation_failed';
      if (attempt + 1 >= maxAttempts) {
        record.status = 'failed';
        record.completedAt = Date.now();
        break;
      }
      const backoff = baseBackoffMs * Math.pow(2, attempt);
      await delay(backoff);
    }
  }

  return { reused: false, record, text: undefined };
}

export function recordDraftMetadata(record: GenerationRecord, draftId: string, generatedAt: number, reused: boolean) {
  record.draftId = draftId;
  record.reused = reused;
  if (!record.completedAt) record.completedAt = generatedAt;
  recordsByKey.set(record.idempotencyKey, record);
  recordsByRunId.set(record.runId, record);
  metadataByDraftId.set(draftId, {
    draftId,
    orgId: record.orgId,
    seedId: record.seedId,
    platform: record.platform,
    promptVersionId: record.promptVersionId,
    runId: record.runId,
    generatedAt,
    reused,
  });
}

export function getDraftMetadata(draftId: string): DraftMetadata | undefined {
  return metadataByDraftId.get(draftId);
}

export function getGenerationRecordByKey(key: string): GenerationRecord | undefined {
  return recordsByKey.get(key);
}

export function getGenerationRecordsForSeed(orgId: string, seedId: string): GenerationRecord[] {
  return Array.from(recordsByKey.values()).filter((record) => record.orgId === orgId && record.seedId === seedId);
}

export function getAllDraftMetadata(orgId: string): DraftMetadata[] {
  return Array.from(metadataByDraftId.values()).filter((meta) => meta.orgId === orgId);
}

export function resetGenerationsForOrg(orgId: string) {
  for (const [key, record] of recordsByKey.entries()) {
    if (record.orgId === orgId) {
      recordsByKey.delete(key);
      recordsByRunId.delete(record.runId);
      if (record.draftId) metadataByDraftId.delete(record.draftId);
    }
  }
}
