# Orchestrator Cloud Function

A **first-generation HTTP-triggered** Cloud Function that runs a single **scraper** batch in your pipeline and returns its GCS shard path. It no longer handles merge, clean, or ingest steps, which are orchestrated centrally in Cloud Workflows.

---

## 1. What It Does

1. **Reads** `startId` and `batchSize` from the query string  
2. **Validates** they’re positive integers  
3. **Triggers** the Cloud Run Job `horse-data-scraper-job` with arguments `[startId, batchSize]`  
4. **Waits** for the job to complete  
5. **Computes** the expected shard file path (e.g., `horse_data/shard_<start>_<end>.ndjson`)  
6. **Returns** a JSON payload with the shard path:

   ```json
   {
     "shardFile": "horse_data/shard_1_1000.ndjson"
   }
````

---

## 2. File Layout

```
functions/orchestrator/
├── index.js         # main Express app + scraper-only logic
├── package.json     # dependencies: @google-cloud/run, express
└── README.md        # you are here
```

---

## 3. Configuration

* **No runtime env-vars**—all constants are set in `index.js`:

  * `PROJECT_ID`, `REGION`
  * Cloud Run Job name: `horse-data-scraper-job`
  * GCS prefix where shards are written: `horse_data/`

* **Query parameters** (both **required**):

  * `startId` -- integer ≥ 1
  * `batchSize` -- integer ≥ 1

---

## 4. Deploying

```powershell
cd functions\orchestrator

npm install

gcloud functions deploy orchestrator `
  --source . `
  --region europe-central2 `
  --runtime nodejs20 `
  --trigger-http `
  --entry-point orchestrator `
  --timeout 300s `
  --allow-unauthenticated
```

---

## 5. Invocation

```bash
# via HTTP GET
curl -X GET \
  "https://REGION-PROJECT.cloudfunctions.net/orchestrator?startId=1&batchSize=1000"

# via gcloud
gcloud functions call orchestrator \
  --region=europe-central2 \
  --data '{}' \
  --parameters=startId=1,batchSize=1000
```

---

## 6. Logs & Troubleshooting

```bash
gcloud logging read \
  'resource.type="cloud_function" \
   AND resource.labels.function_name="orchestrator"' \
  --limit 20 \
  --format="table(timestamp,severity,textPayload)"
```

Key log lines:

* `🔔  Scraper-only orchestrator invoked`
* `➡️  Scraper batch: IDs <start>–<end>`
* `✅  Scraper batch done`
* `✔️  Returning shard path: <path>`

If the function errors, inspect the Cloud Run job logs for details on the scraper execution.

```
