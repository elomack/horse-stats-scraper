// functions/orchestrator/index.js

/**
 * Orchestrator Service (Express)
 *
 * - Listens on PORT (default 8080) for a single GET /
 * - When hit, runs batches sequentially, then triggers merge
 */

import express from 'express'
import { JobsClient } from '@google-cloud/run'
import axios from 'axios'

const app = express()
const port = process.env.PORT || 8080

const JOB_NAME = 'projects/horse-racing-predictor-465217/locations/europe-central2/jobs/horse-data-scraper-job'
const MERGE_URL = 'https://europe-central2-horse-racing-predictor-465217.cloudfunctions.net/mergeHorseData'

app.get('/', async (req, res) => {
  console.log('🔔 Orchestration endpoint hit')
  const client = new JobsClient()
  let startId = 1
  const batchSize = 1000
  const maxId = 50000

  try {
    while (startId <= maxId) {
      const endId = startId + batchSize - 1
      console.log(`➡️  Triggering batch: IDs ${startId} to ${endId}`)

      const [operation] = await client.runJob({
        name: JOB_NAME,
        overrides: {
          containerOverrides: [
            { args: [String(startId), String(batchSize)] }
          ]
        }
      })
      console.log(`   ↪️  Operation started: ${operation.name}`)

      console.log(`⏳ Waiting for batch ${startId}-${endId} to complete…`)
      await operation.promise()
      console.log(`✅ Batch ${startId}-${endId} completed`)

      startId += batchSize
    }

    console.log('🔀 All batches done; invoking merge function')
    const mergeResp = await axios.post(MERGE_URL)
    console.log('   ↪️  Merge function response status:', mergeResp.status)

    console.log('🎉 Orchestration complete')
    res.status(200).send('Orchestration finished successfully')
  } catch (err) {
    console.error('❌ Orchestration failed:', err)
    res.status(500).send('Orchestration error: ' + err.message)
  }
})

app.listen(port, () => {
  console.log(`🚀 Express server listening on port ${port}`)
})
