import { Queue, Worker, JobsOptions, Job } from 'bullmq';
import IORedis from 'ioredis';

export type QueueDriver = 'memory' | 'bullmq';

export function getQueueDriver(): QueueDriver {
  const d = (process.env.QUEUE_DRIVER || 'memory').toLowerCase();
  return d === 'bullmq' ? 'bullmq' : 'memory';
}

// In-memory fallbacks are already implemented in queue.ts

let bullQueue: Queue | undefined;
let bullWorker: Worker | undefined;

export function initBull(queueName: string = 'publishQueue'): Queue {
  if (bullQueue) return bullQueue;
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  bullQueue = new Queue(queueName, { connection });
  return bullQueue;
}

export async function addBullJob(payload: any, opts?: JobsOptions) {
  const queue = bullQueue ?? initBull();
  return queue.add('publish', payload, opts);
}

export function startBullWorker(handler: (payload: any) => Promise<void>, queueName: string = 'publishQueue') {
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  bullWorker = new Worker(
    queueName,
    async (job) => {
      await handler(job.data);
    },
    { connection }
  );
  return bullWorker;
}

export async function removeBullJob(jobId: string): Promise<boolean> {
  const queue = bullQueue ?? initBull();
  const job: Job | undefined = await queue.getJob(jobId);
  if (!job) return false;
  await job.remove();
  return true;
}
