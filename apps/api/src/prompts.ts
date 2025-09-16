export type PromptVersion = {
  id: string;
  orgId: string;
  content: string;
  author: string;
  notes?: string;
  createdAt: number;
};

type OrgPrompts = {
  activeId?: string;
  versions: PromptVersion[];
};

const promptsByOrg: Record<string, OrgPrompts> = {};

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function listVersions(orgId: string): PromptVersion[] {
  return (promptsByOrg[orgId] ||= { versions: [] }).versions.slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function getActive(orgId: string): PromptVersion | undefined {
  const org = (promptsByOrg[orgId] ||= { versions: [] });
  if (!org.activeId) return undefined;
  return org.versions.find((v) => v.id === org.activeId);
}

export function createVersion(orgId: string, author: string, content: string, notes?: string): PromptVersion {
  const org = (promptsByOrg[orgId] ||= { versions: [] });
  const v: PromptVersion = { id: genId('prm'), orgId, content, author, notes, createdAt: Date.now() };
  org.versions.push(v);
  org.activeId = v.id;
  return v;
}

export function activate(orgId: string, id: string): PromptVersion | undefined {
  const org = (promptsByOrg[orgId] ||= { versions: [] });
  const found = org.versions.find((v) => v.id === id);
  if (found) org.activeId = id;
  return found;
}
