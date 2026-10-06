/**
 * In-process job queue with a BullMQ-style status surface (§14.4).
 *
 * Redis-backed BullMQ cannot run in this environment, so this module provides
 * the same observable contract — jobs with ids and a status the UI can poll —
 * with an in-process FIFO worker (concurrency 1 per IP). The UI state machine
 * maps `queued` -> `fetching` -> `downloading` -> `done`/`failed`.
 */

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed';

export interface Job<T = unknown> {
  id: string;
  ip: string;
  status: JobStatus;
  data: T;
  createdAt: number;
  error?: string;
}

export interface Queue {
  add: (ip: string, data: Record<string, unknown>) => Job;
  status: (id: string) => Job | undefined;
  /** Pull the next queued job for an IP, if its worker is idle. */
  take: (ip: string) => Job | undefined;
  complete: (id: string) => void;
  fail: (id: string, error: string) => void;
  size: () => number;
  prune: (olderThanMs: number) => void;
}

export function createQueue(): Queue {
  const jobs = new Map<string, Job>();
  const activeByIp = new Map<string, number>(); // ip -> active job count
  let counter = 0;

  const add = (ip: string, data: Record<string, unknown>): Job => {
    const job: Job = {
      id: `job-${++counter}-${Date.now().toString(36)}`,
      ip,
      status: 'queued',
      data,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    return job;
  };

  const take = (ip: string): Job | undefined => {
    if ((activeByIp.get(ip) ?? 0) >= 1) return undefined; // concurrency 1 per IP
    for (const job of jobs.values()) {
      if (job.ip === ip && job.status === 'queued') {
        job.status = 'active';
        activeByIp.set(ip, (activeByIp.get(ip) ?? 0) + 1);
        return job;
      }
    }
    return undefined;
  };

  const release = (job: Job): void => {
    const n = (activeByIp.get(job.ip) ?? 1) - 1;
    if (n <= 0) activeByIp.delete(job.ip);
    else activeByIp.set(job.ip, n);
  };

  const complete = (id: string): void => {
    const job = jobs.get(id);
    if (!job) return;
    job.status = 'completed';
    release(job);
  };

  const fail = (id: string, error: string): void => {
    const job = jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    release(job);
  };

  const prune = (olderThanMs: number): void => {
    const cutoff = Date.now() - olderThanMs;
    for (const [id, job] of jobs) {
      if ((job.status === 'completed' || job.status === 'failed') && job.createdAt < cutoff) {
        jobs.delete(id);
      }
    }
  };

  return {
    add,
    status: (id) => jobs.get(id),
    take,
    complete,
    fail,
    size: () => jobs.size,
    prune,
  };
}
