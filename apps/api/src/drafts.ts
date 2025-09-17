export type Draft = {
  id: string;
  orgId: string;
  seedId: string;
  platform: string;
  originalText: string;
  editedText?: string;
  createdAt: number;
  updatedAt: number;
  promptVersionId?: string | null;
  generatorRunId?: string;
  generatedAt?: number;
};

export type DraftAudit = {
  id: string;
  orgId: string;
  draftId: string;
  editor: string;
  editedText: string;
  createdAt: number;
};

const draftsByOrg: Record<string, Draft[]> = {};
const draftAuditsByOrg: Record<string, DraftAudit[]> = {};

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function listDrafts(orgId: string, seedId?: string): Draft[] {
  const list = (draftsByOrg[orgId] ||= []);
  return list
    .filter((d) => (seedId ? d.seedId === seedId : true))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createDraft(
  orgId: string,
  seedId: string,
  platform: string,
  text: string,
  metadata?: { promptVersionId?: string | null; generatorRunId?: string; generatedAt?: number }
): Draft {
  const d: Draft = {
    id: genId('drf'),
    orgId,
    seedId,
    platform,
    originalText: text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    promptVersionId: metadata?.promptVersionId ?? null,
    generatorRunId: metadata?.generatorRunId,
    generatedAt: metadata?.generatedAt ?? Date.now(),
  };
  (draftsByOrg[orgId] ||= []).push(d);
  return d;
}

export function editDraft(orgId: string, id: string, editedText: string, editor?: string): Draft | undefined {
  const list = (draftsByOrg[orgId] ||= []);
  const d = list.find((x) => x.id === id);
  if (!d) return undefined;
  d.editedText = editedText;
  d.updatedAt = Date.now();
  if (editor) {
    recordAudit(orgId, {
      id: genId('audit'),
      orgId,
      draftId: id,
      editor,
      editedText,
      createdAt: Date.now(),
    });
  }
  return d;
}

export function listDraftAudits(orgId: string, draftId: string): DraftAudit[] {
  return (draftAuditsByOrg[orgId] || []).filter((audit) => audit.draftId === draftId).slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function recordAudit(orgId: string, audit: DraftAudit) {
  const list = (draftAuditsByOrg[orgId] ||= []);
  list.push(audit);
}
