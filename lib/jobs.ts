/**
 * Job queue management for async tasks
 * Handles bootstrap, ingestion, aggregation, and MV refresh jobs
 */

import prisma from './prisma';
import tuning from '../config/tuning.json';

export type JobType =
  | 'bootstrap_city'
  | 'ingest_reddit'
  | 'compute_aggregations'
  | 'refresh_mvs';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, any>;
  status: JobStatus;
  attempts: number;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * Enqueue a new job (idempotent based on type + payload hash)
 */
export async function enqueueJob(
  type: JobType,
  payload: Record<string, any>
): Promise<Job> {
  // Create idempotency key from type + payload
  const payloadHash = hashPayload(payload);
  const idempotencyKey = `${type}:${payloadHash}`;

  // Check if job already exists and is queued/running
  const existing = await prisma.$queryRaw<Job[]>`
    SELECT *
    FROM "JobQueue"
    WHERE type = ${type}
      AND payload = ${JSON.stringify(payload)}::jsonb
      AND status IN ('queued', 'running')
    LIMIT 1
  `;

  if (existing.length > 0) {
    console.log(`[jobs] Job already exists: ${existing[0].id}`);
    return existing[0];
  }

  // Create new job
  const job = await prisma.$queryRaw<Job[]>`
    INSERT INTO "JobQueue" (type, payload, status, attempts, created_at, updated_at)
    VALUES (
      ${type},
      ${JSON.stringify(payload)}::jsonb,
      'queued',
      0,
      NOW(),
      NOW()
    )
    RETURNING *
  `;

  console.log(`[jobs] Enqueued job: ${job[0].id} (${type})`);
  return job[0];
}

/**
 * Claim next available job (atomic)
 */
export async function claimNextJob(types?: JobType[]): Promise<Job | null> {
  // Type-safe filtering - use separate queries for with/without type filter
  const jobs = types && types.length > 0
    ? await prisma.$queryRaw<Job[]>`
        UPDATE "JobQueue"
        SET
          status = 'running',
          started_at = NOW(),
          updated_at = NOW()
        WHERE id = (
          SELECT id
          FROM "JobQueue"
          WHERE status = 'queued'
            AND type = ANY(${types}::text[])
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `
    : await prisma.$queryRaw<Job[]>`
        UPDATE "JobQueue"
        SET
          status = 'running',
          started_at = NOW(),
          updated_at = NOW()
        WHERE id = (
          SELECT id
          FROM "JobQueue"
          WHERE status = 'queued'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `;

  if (jobs.length === 0) {
    return null;
  }

  console.log(`[jobs] Claimed job: ${jobs[0].id} (${jobs[0].type})`);
  return jobs[0];
}

/**
 * Mark job as completed
 */
export async function completeJob(jobId: string): Promise<void> {
  await prisma.$queryRaw`
    UPDATE "JobQueue"
    SET
      status = 'done',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${jobId}
  `;

  console.log(`[jobs] Completed job: ${jobId}`);
}

/**
 * Mark job as failed (with retry logic)
 */
export async function failJob(
  jobId: string,
  error: string,
  retry: boolean = true
): Promise<void> {
  const maxAttempts = tuning.jobs.max_attempts;

  if (!retry) {
    // Hard fail - don't retry
    await prisma.$queryRaw`
      UPDATE "JobQueue"
      SET
        status = 'error',
        error = ${error},
        updated_at = NOW()
      WHERE id = ${jobId}
    `;

    console.error(`[jobs] Failed job (no retry): ${jobId} - ${error}`);
    return;
  }

  // Increment attempts
  const jobs = await prisma.$queryRaw<Job[]>`
    UPDATE "JobQueue"
    SET
      attempts = attempts + 1,
      error = ${error},
      updated_at = NOW()
    WHERE id = ${jobId}
    RETURNING *
  `;

  const job = jobs[0];

  if (job.attempts >= maxAttempts) {
    // Max attempts reached - mark as error
    await prisma.$queryRaw`
      UPDATE "JobQueue"
      SET status = 'error'
      WHERE id = ${jobId}
    `;

    console.error(`[jobs] Failed job (max attempts): ${jobId} - ${error}`);
  } else {
    // Requeue for retry with exponential backoff
    const backoffSeconds = tuning.jobs.retry_backoff_seconds[job.attempts - 1] || 3600;

    await prisma.$queryRaw`
      UPDATE "JobQueue"
      SET
        status = 'queued',
        started_at = NULL,
        updated_at = NOW() + (${backoffSeconds} || ' seconds')::interval
      WHERE id = ${jobId}
    `;

    console.log(`[jobs] Requeued job for retry (${job.attempts}/${maxAttempts}): ${jobId}`);
  }
}

/**
 * Get job status
 */
export async function getJob(jobId: string): Promise<Job | null> {
  const jobs = await prisma.$queryRaw<Job[]>`
    SELECT * FROM "JobQueue" WHERE id = ${jobId} LIMIT 1
  `;

  return jobs.length > 0 ? jobs[0] : null;
}

/**
 * Get all jobs (with optional filters)
 */
export async function getJobs(
  status?: JobStatus,
  type?: JobType,
  limit: number = 100
): Promise<Job[]> {
  // Build type-safe query based on filters
  if (status && type) {
    return await prisma.$queryRaw<Job[]>`
      SELECT * FROM "JobQueue"
      WHERE status = ${status} AND type = ${type}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  if (status) {
    return await prisma.$queryRaw<Job[]>`
      SELECT * FROM "JobQueue"
      WHERE status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  if (type) {
    return await prisma.$queryRaw<Job[]>`
      SELECT * FROM "JobQueue"
      WHERE type = ${type}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  return await prisma.$queryRaw<Job[]>`
    SELECT * FROM "JobQueue"
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

/**
 * Clean up old completed/failed jobs (retention policy)
 */
export async function cleanupOldJobs(retentionDays: number = 7): Promise<number> {
  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    DELETE FROM "JobQueue"
    WHERE status IN ('done', 'error')
      AND updated_at < NOW() - (${retentionDays} || ' days')::interval
    RETURNING id
  `;

  const count = result.length;
  console.log(`[jobs] Cleaned up ${count} old jobs`);

  return count;
}

/**
 * Simple hash function for payload (deterministic)
 */
function hashPayload(payload: Record<string, any>): string {
  // Sort keys for deterministic output
  const sorted = Object.keys(payload)
    .sort()
    .reduce((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {} as Record<string, any>);

  // Simple hash (for real production, use crypto.createHash)
  const str = JSON.stringify(sorted);
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return hash.toString(36);
}

/**
 * Job processor - polls queue and executes jobs
 */
export async function processJobs(
  handlers: Partial<Record<JobType, (payload: any) => Promise<void>>>,
  pollInterval: number = 5000
): Promise<void> {
  console.log('[jobs] Starting job processor...');

  while (true) {
    try {
      // Claim next job
      const job = await claimNextJob(Object.keys(handlers) as JobType[]);

      if (!job) {
        // No jobs available, wait and retry
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }

      // Execute job handler
      const handler = handlers[job.type];

      if (!handler) {
        await failJob(job.id, `No handler for job type: ${job.type}`, false);
        continue;
      }

      try {
        console.log(`[jobs] Processing job: ${job.id} (${job.type})`);
        await handler(job.payload);
        await completeJob(job.id);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await failJob(job.id, errorMsg);
      }

    } catch (error) {
      console.error('[jobs] Job processor error:', error);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
}
