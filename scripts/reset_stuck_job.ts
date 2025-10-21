#!/usr/bin/env tsx
import prisma from '../lib/prisma';

async function main() {
  // Check stuck jobs
  const jobs = await prisma.$queryRaw<any[]>`
    SELECT id, type, status, started_at,
           EXTRACT(EPOCH FROM (NOW() - started_at)) / 60 as minutes_running
    FROM "JobQueue"
    WHERE type = 'ingest_reddit'
      AND status = 'running'
    ORDER BY created_at DESC
  `;

  console.log('Stuck ingest_reddit jobs:');
  jobs.forEach(job => {
    console.log(`  ${job.id} - ${job.status} for ${Math.round(job.minutes_running)} minutes`);
  });

  if (jobs.length > 0) {
    const stuckJob = jobs[0];
    console.log(`\nResetting job ${stuckJob.id} to 'queued' status...`);

    await prisma.$queryRaw`
      UPDATE "JobQueue"
      SET status = 'queued',
          started_at = NULL
      WHERE id = ${stuckJob.id}
    `;

    console.log('✓ Job reset. Worker should pick it up in the next poll cycle.');
  } else {
    console.log('\nNo stuck jobs found.');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
