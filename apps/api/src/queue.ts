type JobStatus = 'pending' | 'cancelled' | 'completed' | 'failed';

type Job = {
  id: string;
  orgId: string;
  payload: any;
  runAt: number;
  createdAt: number;
  status: JobStatus;
};

const jobs: Job[] = [];
const jobsById: Map<string, Job> = new Map();
const jobsByOrg: Map<string, Set<string>> = new Map();

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function trackJob(job: Job) {
  jobs.push(job);
  jobsById.set(job.id, job);
  if (!jobsByOrg.has(job.orgId)) jobsByOrg.set(job.orgId, new Set());
  jobsByOrg.get(job.orgId)!.add(job.id);
}

export function scheduleJob(orgId: string, payload: any, delayMs: number): Job {
  const job: Job = { id: genId('job'), orgId, payload, runAt: Date.now() + delayMs, createdAt: Date.now(), status: 'pending' };
  trackJob(job);
  return job;
}

export function cancelJob(id: string): boolean {
  const job = jobsById.get(id);
  if (!job || job.status !== 'pending') return false;
  job.status = 'cancelled';
  return true;
}

export function rescheduleJob(id: string, delayMs: number): Job | undefined {
  const job = jobsById.get(id);
  if (!job || job.status !== 'pending') return undefined;
  job.runAt = Date.now() + delayMs;
  return job;
}

export function markCompleted(id: string): Job | undefined {
  const job = jobsById.get(id);
  if (!job) return undefined;
  job.status = 'completed';
  return job;
}

export function markFailed(id: string): Job | undefined {
  const job = jobsById.get(id);
  if (!job) return undefined;
  job.status = 'failed';
  return job;
}

export function dueJobs(now: number = Date.now()): Job[] {
  return jobs.filter((j) => j.status === 'pending' && j.runAt <= now);
}

export function runNow(id: string): Job | undefined {
  const job = jobsById.get(id);
  if (!job || job.status !== 'pending') return undefined;
  job.runAt = Date.now();
  return job;
}

export function getJobsForOrg(orgId: string): Job[] {
  const ids = jobsByOrg.get(orgId);
  if (!ids) return [];
  return Array.from(ids)
    .map((id) => jobsById.get(id))
    .filter((job): job is Job => !!job && job.status === 'pending')
    .sort((a, b) => a.runAt - b.runAt);
}

export function getJobForDraft(orgId: string, draftId: string): Job | undefined {
  const ids = jobsByOrg.get(orgId);
  if (!ids) return undefined;
  for (const id of ids) {
    const job = jobsById.get(id);
    if (job && job.status === 'pending' && job.payload?.draftId === draftId) return job;
  }
  return undefined;
}
