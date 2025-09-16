export type ScheduledPost = {
  id: string;
  orgId: string;
  platform: string;
  postId: string; // internal draft id reference
  runAt: number; // epoch ms UTC
};

const scheduledByOrg: Record<string, ScheduledPost[]> = {};

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function schedule(orgId: string, input: Omit<ScheduledPost, 'id'>): ScheduledPost {
  const s: ScheduledPost = { id: genId('sch'), ...input } as any;
  const list = (scheduledByOrg[orgId] ||= []);
  // Conflict: same platform within 5 minutes
  const conflict = list.find((x) => x.platform === s.platform && Math.abs(x.runAt - s.runAt) < 5 * 60 * 1000);
  if (conflict) {
    throw new Error('conflict');
  }
  list.push(s);
  return s;
}

export function reschedule(orgId: string, id: string, runAt: number): ScheduledPost {
  const list = (scheduledByOrg[orgId] ||= []);
  const s = list.find((x) => x.id === id);
  if (!s) throw new Error('not_found');
  // Check conflict
  const conflict = list.find((x) => x.id !== id && x.platform === s.platform && Math.abs(x.runAt - runAt) < 5 * 60 * 1000);
  if (conflict) throw new Error('conflict');
  s.runAt = runAt;
  return s;
}

export function list(orgId: string): ScheduledPost[] {
  return (scheduledByOrg[orgId] ||= []).slice().sort((a, b) => a.runAt - b.runAt);
}
