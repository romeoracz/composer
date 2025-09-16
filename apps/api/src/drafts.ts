export type Draft = {
  id: string;
  orgId: string;
  seedId: string;
  platform: string;
  originalText: string;
  editedText?: string;
  createdAt: number;
  updatedAt: number;
};

const draftsByOrg: Record<string, Draft[]> = {};

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

export function createDraft(orgId: string, seedId: string, platform: string, text: string): Draft {
  const d: Draft = {
    id: genId('drf'),
    orgId,
    seedId,
    platform,
    originalText: text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  (draftsByOrg[orgId] ||= []).push(d);
  return d;
}

export function editDraft(orgId: string, id: string, editedText: string): Draft | undefined {
  const list = (draftsByOrg[orgId] ||= []);
  const d = list.find((x) => x.id === id);
  if (!d) return undefined;
  d.editedText = editedText;
  d.updatedAt = Date.now();
  return d;
}
