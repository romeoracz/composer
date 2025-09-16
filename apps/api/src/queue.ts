type Job = {
  id: string;
  orgId: string;
  payload: any;
  runAt: number;
  cancelled?: boolean;
};

const jobs: Job[] = [];

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function scheduleJob(orgId: string, payload: any, delayMs: number): Job {
  const job: Job = { id: genId('job'), orgId, payload, runAt: Date.now() + delayMs };
  jobs.push(job);
  return job;
}

export function cancelJob(id: string): boolean {
  const j = jobs.find((x) => x.id === id);
  if (!j) return false;
  j.cancelled = true;
  return true;
}

export function dueJobs(now: number = Date.now()): Job[] {
  return jobs.filter((j) => !j.cancelled && j.runAt <= now);
}

export function runNow(id: string): Job | undefined {
  const j = jobs.find((x) => x.id === id);
  if (!j) return undefined;
  j.runAt = Date.now();
  return j;
}
