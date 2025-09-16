export type Seed = {
  id: string;
  orgId: string;
  title: string;
  notes?: string;
  tags?: string[];
  state: 'draft' | 'ready';
  createdAt: number;
};

const seedsByOrg: Record<string, Seed[]> = {};

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function listSeeds(orgId: string): Seed[] {
  return (seedsByOrg[orgId] ||= []).slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function createSeed(orgId: string, input: Omit<Seed, 'id' | 'createdAt' | 'orgId'>): Seed {
  const seed: Seed = { id: genId('seed'), orgId, createdAt: Date.now(), ...input } as Seed;
  (seedsByOrg[orgId] ||= []).push(seed);
  return seed;
}

export function updateSeed(orgId: string, id: string, patch: Partial<Omit<Seed, 'id' | 'orgId' | 'createdAt'>>): Seed | undefined {
  const list = (seedsByOrg[orgId] ||= []);
  const s = list.find((x) => x.id === id);
  if (!s) return undefined;
  Object.assign(s, patch);
  return s;
}

export function deleteSeed(orgId: string, id: string): boolean {
  const list = (seedsByOrg[orgId] ||= []);
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) {
    list.splice(idx, 1);
    return true;
  }
  return false;
}
