export type Org = { id: string; name: string };
export type Role = 'owner' | 'editor' | 'viewer';
export type Membership = { orgId: string; userEmail: string; role: Role };

const orgs: Org[] = [];
const memberships: Membership[] = [];

function generateId(prefix: string = 'org'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createOrgForUser(userEmail: string, name: string): Org {
  const org: Org = { id: generateId(), name };
  orgs.push(org);
  memberships.push({ orgId: org.id, userEmail, role: 'owner' });
  return org;
}

export function listMembershipsForUser(userEmail: string): (Membership & { org: Org })[] {
  const ms = memberships.filter((m) => m.userEmail === userEmail);
  return ms.map((m) => ({ ...m, org: orgs.find((o) => o.id === m.orgId)! }));
}

export function isUserMemberOfOrg(userEmail: string, orgId: string): boolean {
  return memberships.some((m) => m.userEmail === userEmail && m.orgId === orgId);
}

export function setActiveOrg(session: any, orgId: string) {
  session.orgId = orgId;
}

export function getActiveOrgId(session: any): string | undefined {
  return session?.orgId;
}
