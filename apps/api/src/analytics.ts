export type Metric = {
  postId: string;
  platform: string;
  likes: number;
  comments: number;
  shares: number;
  impressions?: number;
  at: number; // epoch ms
};

const metrics: Metric[] = [];

export function addMetric(m: Metric) {
  metrics.push(m);
}

export function listMetrics(filter?: { platform?: string; from?: number; to?: number }) {
  return metrics.filter((m) => {
    if (filter?.platform && m.platform !== filter.platform) return false;
    if (typeof filter?.from === 'number' && m.at < filter.from) return false;
    if (typeof filter?.to === 'number' && m.at > filter.to) return false;
    return true;
  });
}
