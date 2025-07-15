// functions/orchestrator/index.js
// (Node.js 20 – 1st-gen Cloud Function)
// Now only: trigger one scraper batch & return its GCS path.

import express from 'express';
import { JobsClient } from '@google-cloud/run';

const app = express();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG: your GCP identifiers
// ─────────────────────────────────────────────────────────────────────────────
const PROJECT_ID  = 'horse-racing-predictor-465217';
const REGION      = 'europe-central2';
const SCRAPER_JOB = `projects/${PROJECT_ID}/locations/${REGION}/jobs/horse-data-scraper-job`;
const GCS_PREFIX  = 'horse_data/';  // where your scraper writes shards

const jobsClient = new JobsClient();

app.get('/', async (req, res) => {
  console.log('🔔  Scraper-only orchestrator invoked');

  // ───────────────────────────────────────────────────────────────────────────
  // 1) Validate query params
  // ───────────────────────────────────────────────────────────────────────────
  const rawStart   = req.query.startId;
  const rawBatch   = req.query.batchSize;
  if (!rawStart || !rawBatch) {
    return res
      .status(400)
      .send('Missing required query parameters: startId and batchSize');
  }
  const startId   = parseInt(rawStart, 10);
  const batchSize = parseInt(rawBatch, 10);
  if ([startId, batchSize].some(n => !Number.isInteger(n) || n <= 0)) {
    return res
      .status(400)
      .send('startId and batchSize must be positive integers');
  }
  const endId = startId + batchSize - 1;
  console.log(`➡️  Scraper batch: IDs ${startId}–${endId}`);

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // 2) Run the scraper job with the two args
    // ─────────────────────────────────────────────────────────────────────────
    const [op] = await jobsClient.runJob({
      name: SCRAPER_JOB,
      overrides: {
        containerOverrides: [
          { args: [ String(startId), String(batchSize) ] }
        ]
      }
    });
    console.log(`   ↪️  Operation ${op.name} started; waiting…`);
    await op.promise();
    console.log('✅  Scraper batch done');

    // ─────────────────────────────────────────────────────────────────────────
    // 3) Compute the expected shard filename and return it
    //    (Your scraper must write to: gs://<BUCKET>/<GCS_PREFIX>/shard_<start>_<end>.ndjson)
    // ─────────────────────────────────────────────────────────────────────────
    const shardPath = `${GCS_PREFIX}shard_${startId}_${endId}.ndjson`;
    console.log(`✔️  Returning shard path: ${shardPath}`);

    return res.status(200).json({ shardFile: shardPath });

  } catch (err) {
    console.error('❌  Scraper error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Export for Cloud Functions (1st-gen)
export const orchestrator = app;
