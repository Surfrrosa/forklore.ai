#!/usr/bin/env tsx
/**
 * Job queue status viewer
 *
 * Shows:
 * - Pending jobs by type
 * - Running jobs with duration
 * - Recently completed jobs
 * - Failed jobs with errors
 */

import prisma from '../lib/prisma';

interface JobSummary {
  type: string;
  status: string;
  count: bigint;
}

interface JobDetails {
  id: string;
  type: string;
  status: string;
  attempts: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error: string | null;
  payload: any;
}

async function main() {
  console.log('\n=== Job Queue Status ===\n');

  // Summary by type and status
  const summary = await prisma.$queryRaw<JobSummary[]>`
    SELECT type, status, COUNT(*) as count
    FROM "JobQueue"
    GROUP BY type, status
    ORDER BY type, status
  `;

  if (summary.length === 0) {
    console.log('No jobs in queue\n');
  } else {
    console.log('Summary:');
    console.log('');

    const grouped = new Map<string, Map<string, bigint>>();
    for (const row of summary) {
      if (!grouped.has(row.type)) {
        grouped.set(row.type, new Map());
      }
      grouped.get(row.type)!.set(row.status, row.count);
    }

    for (const [type, statuses] of grouped) {
      console.log(`  ${type}:`);
      for (const [status, count] of statuses) {
        console.log(`    ${status}: ${count}`);
      }
    }
    console.log('');
  }

  // Queued jobs
  const queued = await prisma.$queryRaw<JobDetails[]>`
    SELECT id, type, status, attempts, created_at, payload
    FROM "JobQueue"
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 10
  `;

  if (queued.length > 0) {
    console.log('Queued Jobs (next 10):');
    console.log('');

    for (const job of queued) {
      const age = Math.floor((Date.now() - new Date(job.created_at).getTime()) / 1000);
      console.log(`  [${job.type}] ${job.id.substring(0, 8)}`);
      console.log(`    Created: ${age}s ago`);
      console.log(`    Payload: ${JSON.stringify(job.payload)}`);
    }
    console.log('');
  }

  // Running jobs
  const running = await prisma.$queryRaw<JobDetails[]>`
    SELECT id, type, status, attempts, started_at, payload
    FROM "JobQueue"
    WHERE status = 'running'
    ORDER BY started_at ASC
  `;

  if (running.length > 0) {
    console.log('Running Jobs:');
    console.log('');

    for (const job of running) {
      const duration = job.started_at
        ? Math.floor((Date.now() - new Date(job.started_at).getTime()) / 1000)
        : 0;

      console.log(`  [${job.type}] ${job.id.substring(0, 8)}`);
      console.log(`    Running for: ${duration}s`);
      console.log(`    Attempts: ${job.attempts}`);
      console.log(`    Payload: ${JSON.stringify(job.payload)}`);
    }
    console.log('');
  }

  // Recently completed
  const completed = await prisma.$queryRaw<JobDetails[]>`
    SELECT id, type, status, completed_at, payload
    FROM "JobQueue"
    WHERE status = 'done'
    ORDER BY completed_at DESC
    LIMIT 5
  `;

  if (completed.length > 0) {
    console.log('Recently Completed (last 5):');
    console.log('');

    for (const job of completed) {
      const completedAt = job.completed_at
        ? new Date(job.completed_at).toISOString().replace('T', ' ').split('.')[0]
        : 'unknown';

      console.log(`  [${job.type}] ${job.id.substring(0, 8)}`);
      console.log(`    Completed: ${completedAt}`);
    }
    console.log('');
  }

  // Failed jobs
  const failed = await prisma.$queryRaw<JobDetails[]>`
    SELECT id, type, status, attempts, error, payload
    FROM "JobQueue"
    WHERE status = 'error'
    ORDER BY created_at DESC
    LIMIT 5
  `;

  if (failed.length > 0) {
    console.log('Failed Jobs (last 5):');
    console.log('');

    for (const job of failed) {
      console.log(`  [${job.type}] ${job.id.substring(0, 8)}`);
      console.log(`    Attempts: ${job.attempts}`);
      console.log(`    Error: ${job.error?.substring(0, 100)}...`);
      console.log(`    Payload: ${JSON.stringify(job.payload)}`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
