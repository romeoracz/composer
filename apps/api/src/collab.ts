import { Role } from './tenancy';

export type SuggestionStatus = 'suggested' | 'approved';
export type Suggestion = {
  id: string;
  orgId: string;
  content: string;
  createdBy: string; // email
  status: SuggestionStatus;
  createdAt: number;
};

export type Comment = {
  id: string;
  suggestionId: string;
  orgId: string;
  text: string;
  author: string; // email
  createdAt: number;
};

export type Activity = {
  id: string;
  orgId: string;
  type: 'suggest' | 'comment' | 'approve' | 'invite';
  refId?: string;
  actor: string; // email
  at: number;
};

const suggestionsByOrg: Record<string, Suggestion[]> = {};
const commentsByOrg: Record<string, Comment[]> = {};
const activityByOrg: Record<string, Activity[]> = {};

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function recordActivity(orgId: string, entry: Omit<Activity, 'id' | 'at'>) {
  const list = (activityByOrg[orgId] ||= []);
  list.push({ id: genId('act'), at: Date.now(), orgId, ...entry });
}

export function createSuggestion(orgId: string, content: string, createdBy: string): Suggestion {
  const s: Suggestion = {
    id: genId('sug'),
    orgId,
    content,
    createdBy,
    status: 'suggested',
    createdAt: Date.now(),
  };
  (suggestionsByOrg[orgId] ||= []).push(s);
  recordActivity(orgId, { orgId, actor: createdBy, type: 'suggest', refId: s.id });
  return s;
}

export function listSuggestions(orgId: string): Suggestion[] {
  return (suggestionsByOrg[orgId] ||= []);
}

export function addComment(orgId: string, suggestionId: string, text: string, author: string): Comment {
  const c: Comment = { id: genId('cmt'), suggestionId, orgId, text, author, createdAt: Date.now() };
  (commentsByOrg[orgId] ||= []).push(c);
  recordActivity(orgId, { orgId, actor: author, type: 'comment', refId: suggestionId });
  return c;
}

export function listComments(orgId: string, suggestionId: string): Comment[] {
  return (commentsByOrg[orgId] || []).filter((c) => c.suggestionId === suggestionId);
}

export function approveSuggestion(orgId: string, suggestionId: string, approver: string) {
  const list = (suggestionsByOrg[orgId] ||= []);
  const s = list.find((x) => x.id === suggestionId);
  if (!s) throw new Error('not_found');
  s.status = 'approved';
  recordActivity(orgId, { orgId, actor: approver, type: 'approve', refId: suggestionId });
  return s;
}

export function listActivity(orgId: string): Activity[] {
  return (activityByOrg[orgId] ||= []);
}

export function canSuggest(role: Role | undefined): boolean {
  return role === 'owner' || role === 'editor' || role === 'viewer';
}

export function canComment(role: Role | undefined): boolean {
  return role === 'owner' || role === 'editor' || role === 'viewer';
}

export function canApprove(role: Role | undefined): boolean {
  return role === 'owner';
}
