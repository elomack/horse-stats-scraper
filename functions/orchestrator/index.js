// functions/orchestrator/index.js   (Node.js 20, 1st-gen Cloud Function)
// Orchestrates N scraper → merge → clean → ingest batches.

import express from 'express';
import { Storage } from '@google-cloud/storage';
import { JobsClient } from '@google-cloud/run';
import axios from 'axios';

const app = express();

// ──────────────────────────────────────
// Constants: project & region IDs, job/function names
// ──────────────────────────────────────
const PROJECT_ID      = 'horse-racing-predictor-465217';
const REGION          = 'europe-central2';
const SCRAPER_JOB     = `projects/${PROJECT_ID}/locations/${REGION}/jobs/horse-data-scraper-job`;
const CLEAN_JOB       = `projects/${PROJECT_ID}/locations/${REGION}/jobs/clean-master-job`;
const INGEST_JOB      = `projects/${PROJECT_ID}/locations/${REGION}/jobs/horse-ingestion-job`;
const MERGE_URL       = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/mergeHorseData`;
const BUCKET_NAME     = 'horse-racing-data-elomack';
const CLEANED_PREFIX  = 'horse_data/';
const CLEANED_PATTERN = '_cleaned_deduped_';

const storage    = new Storage();
const jobsClient = new JobsClient();

app.get('/', async (req, res) => {
  console.log('🔔  Orchestrator invoked');

  // ────────────────────────────────────
  // 1) Parse & validate query params (multi-batch)
  // ────────────────────────────────────
  const startId    = parseInt(req.query.startId,    10);
  const batchSize  = parseInt(req.query.batchSize,  10);
  const maxBatches = parseInt(req.query.maxBatches, 10);

  if ([startId, batchSize, maxBatches].some(n => !Number.isInteger(n) || n <= 0)) {
    return res
      .status(400)
      .send('startId, batchSize and maxBatches must all be positive integers');
  }
  console.log(`🛠  Params: startId=${startId} batchSize=${batchSize} maxBatches=${maxBatches}`);

  try {
    // ────────────────────────────────────
    // 2) Run scraper batches sequentially
    // ────────────────────────────────────
    let currentStart = startId;
    const scrapeOps  = [];

    for (let batchNum = 1; batchNum <= maxBatches; batchNum++) {
      const endId = currentStart + batchSize - 1;
      console.log(`➡️  Batch ${batchNum}: IDs ${currentStart}-${endId}`);

      const [scrapeOp] = await jobsClient.runJob({
        name: SCRAPER_JOB,
        overrides: {
          containerOverrides: [
            { args: [ String(currentStart), String(batchSize) ] }
          ]
        }
      });
      console.log(`   ↪️  Operation ${scrapeOp.name} started; waiting…`);
      await scrapeOp.promise();
      console.log(`✅  Batch ${batchNum} done`);

      scrapeOps.push(scrapeOp.name);
      currentStart += batchSize;
    }

    // ────────────────────────────────────
    // 3) Merge partial NDJSON shards
    // ────────────────────────────────────
    console.log('🔀  Invoking mergeHorseData Cloud Function');
    const mergeResp = await axios.post(MERGE_URL);
    if (!mergeResp.data?.masterFile) {
      throw new Error('mergeHorseData did not return masterFile');
    }
    const masterFile = mergeResp.data.masterFile;
    console.log(`✔️  Merge complete: ${masterFile}`);

    // ───────────────────────────────────────────────────
    // 4) Trigger clean-master-job and wait
    // ───────────────────────────────────────────────────
    console.log('🧹  Triggering clean-master-job');
    const [cleanOp] = await jobsClient.runJob({
      name: CLEAN_JOB,
      overrides: {
        containerOverrides: [
          {
            command: ["node", "src/cleanMaster.js"],
            env: [
              { name: "BUCKET_NAME", value: BUCKET_NAME },
              { name: "MASTER_FILE",  value: masterFile }
            ]
          }
        ]
      }
    });
    console.log(`   ↪️  Clean job ${cleanOp.name} started; waiting…`);
    await cleanOp.promise();
    console.log('✅  Clean job done');

    // ───────────────────────────────────────────────────
    // 5) List & pick the latest cleaned+deduped file
    // ───────────────────────────────────────────────────
    console.log(`📋  Listing cleaned files under ${CLEANED_PREFIX}`);
    const [files] = await storage.bucket(BUCKET_NAME)
      .getFiles({ prefix: CLEANED_PREFIX });

    const cleanedFiles = files
      .map(f => f.name)
      .filter(name => name.includes(CLEANED_PATTERN))
      .sort();
    if (cleanedFiles.length === 0) {
      throw new Error('No cleaned files found');
    }
    const cleanedFile = cleanedFiles.pop();
    console.log(`✔️  Picked cleaned file: ${cleanedFile}`);

    // ───────────────────────────────────────────────────
    // 6) Trigger ingestion-job and wait
    // ───────────────────────────────────────────────────
    console.log('📥  Triggering ingestion job');
    const [ingestOp] = await jobsClient.runJob({
      name: INGEST_JOB,
      overrides: {
        containerOverrides: [
          {
            command: ["node", "src/entrypoint.js"],
            args:    [ BUCKET_NAME, cleanedFile ]
          }
        ]
      }
    });
    console.log(`   ↪️  Ingest job ${ingestOp.name} started; waiting…`);
    await ingestOp.promise();
    console.log('✅  Ingestion job done');

    // ────────────────────────────────────
    // 7) Return consolidated summary
    // ────────────────────────────────────
    res.status(200).json({
      startId,
      batchSize,
      maxBatches,
      masterFile,
      cleanedFile,
      operations: {
        scrapeBatches: scrapeOps,
        clean:         cleanOp.name,
        ingest:        ingestOp.name
      }
    });

  } catch (err) {
    console.error('❌  Orchestration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Export for Cloud Functions (1st-gen)
export const orchestrator = app;
