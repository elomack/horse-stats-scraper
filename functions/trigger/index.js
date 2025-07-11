// functions/trigger/index.js

/**
 * trigger()
 *
 * HTTP Cloud Function to trigger one batch of the scraper job.
 * 
 * Steps:
 *   1) Parse startId and batchSize from POST JSON body or GET query.
 *   2) Validate inputs and return 400 JSON on missing params.
 *   3) Call Cloud Run Jobs API to enqueue the batch.
 *   4) Return a JSON payload containing the LRO operationName immediately.
 *
 * This avoids waiting on the job to complete (to prevent function timeouts).
 */

const { JobsClient } = require('@google-cloud/run');

// Full resource name of your Cloud Run job
const JOB_NAME = 'projects/horse-racing-predictor-465217/locations/europe-central2/jobs/horse-data-scraper-job';

// Instantiate the Cloud Run Jobs client
const client = new JobsClient();

exports.trigger = async (req, res) => {
  console.log('🔔 trigger invoked');

  try {
    // 1) Extract parameters from JSON body (POST) or query (GET)
    const startId   = req.body?.startId   || req.query?.startId;
    const batchSize = req.body?.batchSize || req.query?.batchSize;

    // 2) Validate inputs
    if (!startId || !batchSize) {
      console.warn('⚠️ Missing startId or batchSize');
      res.status(400).json({ 
        error: 'Missing startId or batchSize. Use POST { "startId":…, "batchSize":… }'
      });
      return;
    }

    console.log(`🚀 Launching job for IDs ${startId} to ${parseInt(startId) + parseInt(batchSize) - 1}`);

    // 3) Enqueue the Cloud Run Job; returns a long-running operation
    const [operation] = await client.runJob({
      name: JOB_NAME,
      overrides: {
        containerOverrides: [
          { args: [ String(startId), String(batchSize) ] }
        ]
      }
    });

    // 4) Return the operation name in JSON so the workflow can poll it
    console.log(`✅ Job enqueued: ${operation.name}`);
    res.status(200).json({ operationName: operation.name });

  } catch (err) {
    // 5) Error handling
    console.error('❌ Error triggering job:', err);
    res.status(500).json({ error: err.message });
  }
};
