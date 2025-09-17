export type HistoryItem = {
  id: string;
  orgId: string;
  seedId: string;
  draftId: string;
  platform: string;
  postId: string;
  url?: string;
  originalText: string;
  editedText?: string;
  publishedAt: number;
  status: 'success' | 'failed' | 'cancelled';
  error?: string | null;
};

const historyByOrg: Record<string, HistoryItem[]> = {};

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function recordPublish(input: Omit<HistoryItem, 'id' | 'publishedAt'> & { status?: HistoryItem['status']; error?: string | null }) {
  const { status = 'success', error = null, ...rest } = input;
  const item: HistoryItem = {
    id: genId('hist'),
    publishedAt: Date.now(),
    status,
    error,
    ...rest,
  } as HistoryItem;
  (historyByOrg[input.orgId] ||= []).push(item);
  return item;
}

export function listHistory(orgId: string) {
  return (historyByOrg[orgId] ||= []).slice().sort((a, b) => b.publishedAt - a.publishedAt);
}
