export type Metric = {
  postId: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  impressions?: number;
  at: number; // epoch ms
  orgId: string; // tenant scope
};

const metricsByOrg: Record<string, Metric[]> = {};

export function addMetric(m: Metric) {
  if (!metricsByOrg[m.orgId]) metricsByOrg[m.orgId] = [];
  metricsByOrg[m.orgId].push(m);
}

export function listMetrics(filter: { orgId: string; platform?: string; from?: number; to?: number }) {
  const collection = metricsByOrg[filter.orgId] || [];
  return collection.filter((m) => {
    if (filter.platform && m.platform !== filter.platform) return false;
    if (typeof filter.from === 'number' && m.at < filter.from) return false;
    if (typeof filter.to === 'number' && m.at > filter.to) return false;
    return true;
  });
}
