// =============================================================================
// functions/orchestrator/index.js   (Node.js 20, 1st-gen Cloud Function)
// Orchestrates a single scraper→merge→clean→ingest batch.
// =============================================================================

import express from 'express';
import { Storage } from '@google-cloud/storage';
import { JobsClient } from '@google-cloud/run';
import axios from 'axios';

const app = express();

// ──────────────────────────────────────
// Constants
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
  // 1) Parse & validate query params (single batch)
  // ────────────────────────────────────
  const startId   = parseInt(req.query.startId  ?? '1',    10);
  const batchSize = parseInt(req.query.batchSize?? '1000', 10);

  if ([startId, batchSize].some(n => !Number.isInteger(n) || n <= 0)) {
    return res
      .status(400)
      .send('startId and batchSize must be positive integers');
  }
  console.log(`🛠  Params: startId=${startId} batchSize=${batchSize}`);

  try {
    // ────────────────────────────────────
    // 2) Run one scraper batch
    // ────────────────────────────────────
    const endId = startId + batchSize - 1;
    console.log(`➡️  Batch: IDs ${startId}-${endId}`);

    const [scrapeOp] = await jobsClient.runJob({
      name: SCRAPER_JOB,
      overrides: {
        containerOverrides: [
          { args: [ String(startId), String(batchSize) ] }
        ]
      }
    });
    console.log(`   ↪️  Operation ${scrapeOp.name} started; waiting…`);
    await scrapeOp.promise();
    console.log('✅  Scraper batch done');

    // ────────────────────────────────────
    // 3) Merge partial shards into master file
    // ────────────────────────────────────
    console.log('🔀  Invoking mergeHorseData Cloud Function');
    const mergeResp = await axios.post(MERGE_URL);
    if (!mergeResp.data?.masterFile) {
      throw new Error('mergeHorseData did not return masterFile');
    }
    const masterFile = mergeResp.data.masterFile;
    console.log(`✔️  Merge complete: ${masterFile}`);

    // ────────────────────────────────────────────────
    // 4) Trigger clean-master-job and wait for it
    // ────────────────────────────────────────────────
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
      .sort();  // lexicographic = timestamp order
    if (cleanedFiles.length === 0) {
      throw new Error('No cleaned files found');
    }
    const cleanedFile = cleanedFiles.pop();
    console.log(`✔️  Picked cleaned file: ${cleanedFile}`);

    // ───────────────────────────────────────────────────
    // 6) Trigger ingestion job and wait for it
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
    // 7) Return a consolidated summary
    // ────────────────────────────────────
    res.status(200).json({
      startId,
      batchSize,
      masterFile,
      cleanedFile,
      operations: {
        scrape:  scrapeOp.name,
        clean:   cleanOp.name,
        ingest:  ingestOp.name
      }
    });

  } catch (err) {
    console.error('❌  Orchestration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Export for Cloud Functions (1st-gen)
export const orchestrator = app;
