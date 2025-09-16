import { Queue, Worker, QueueScheduler, JobsOptions, QueueEvents, Job } from 'bullmq';
import IORedis from 'ioredis';

export type QueueDriver = 'memory' | 'bullmq';

export function getQueueDriver(): QueueDriver {
  const d = (process.env.QUEUE_DRIVER || 'memory').toLowerCase();
  return d === 'bullmq' ? 'bullmq' : 'memory';
}

// In-memory fallbacks are already implemented in queue.ts

let bullQueue: Queue | undefined;
let bullWorker: Worker | undefined;
let bullScheduler: QueueScheduler | undefined;
let bullEvents: QueueEvents | undefined;

export function initBull(queueName: string = 'publishQueue') {
  if (bullQueue) return { bullQueue, bullWorker, bullScheduler, bullEvents };
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  bullQueue = new Queue(queueName, { connection });
  bullScheduler = new QueueScheduler(queueName, { connection });
  bullEvents = new QueueEvents(queueName, { connection });
  return { bullQueue, bullWorker, bullScheduler, bullEvents };
}

export async function addBullJob(payload: any, opts?: JobsOptions) {
  if (!bullQueue) initBull();
  if (!bullQueue) throw new Error('bull not initialized');
  return bullQueue.add('publish', payload, opts);
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
  if (!bullQueue) initBull();
  if (!bullQueue) return false;
  const job: Job | null = await bullQueue.getJob(jobId);
  if (!job) return false;
  await job.remove();
  return true;
}
