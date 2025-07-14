# Orchestrator Cloud Function

A **first-generation HTTP-triggered** Cloud Function that runs one full scrape → merge → clean → ingest **batch** in your pipeline.

---

## 1. What It Does

1. **Reads** `startId`, `batchSize` and `maxBatches` from the query string  
2. **Validates** they’re positive integers  
3. **Loops** (1…`maxBatches`):
   - Triggers the Cloud Run Job `horse-data-scraper-job` with `[startId, batchSize]`  
   - Waits for the job to finish  
   - Increments `startId += batchSize`
4. **Calls** the `mergeHorseData` Cloud Function (HTTP POST) to stitch shards into one master file  
5. **Triggers** the Cloud Run Job `clean-master-job` (via JobsClient) with env-vars:
   ```yaml
   BUCKET_NAME: horse-racing-data-elomack
   MASTER_FILE: <masterFile from merge>
````

6. **Lists** cleaned files in GCS, picks the newest one
7. **Triggers** the Cloud Run Job `horse-ingestion-job` with args `[BUCKET_NAME, cleanedFile]`
8. **Returns** a JSON summary:

```json
{
  "startId": 1,
  "batchSize": 1000,
  "maxBatches": 5,
  "masterFile": "horse_data/master_horse_data_2025-07-14T12_34_56_789Z.ndjson",
  "cleanedFile": "horse_data/master_horse_data_2025-07-14T12_35_10_123Z_cleaned_deduped.ndjson",
  "operations": {
    "scrape":  "projects/.../operations/abcd1234", 
    "merge":   "projects/.../locations/.../operations/efgh5678", 
    "clean":   "projects/.../operations/ijkl9012",
    "ingest":  "projects/.../operations/mnop3456"
  }
}
```

---

## 2. File Layout

```
functions/orchestrator/
├── index.js         # main Express app + orchestrator logic
├── package.json     # dependencies: @google-cloud/storage, @google-cloud/run, axios, express
└── README.md        # you are here
```

---

## 3. Configuration

* **No runtime env-vars**—all constants are hard-coded in `index.js`:

  * `PROJECT_ID`, `REGION`
  * Cloud Run Job names (`horse-data-scraper-job`, `clean-master-job`, `horse-ingestion-job`)
  * `MERGE_URL` → your `mergeHorseData` URL
  * `BUCKET_NAME = horse-racing-data-elomack`
  * GCS prefixes / patterns

* **Query parameters** (all **required**):

  * `startId` -- integer ≥ 1
  * `batchSize` -- integer ≥ 1
  * `maxBatches` -- integer ≥ 1

---

## 4. Deploying

```powershell
cd functions/orchestrator

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
# via curl
curl -X GET \
  "https://REGION-PROJECT.cloudfunctions.net/orchestrator?startId=1&batchSize=1000&maxBatches=5"

# via gcloud
gcloud functions call orchestrator \
  --region=europe-central2 \
  --data '{}' \
  --parameters=startId=1,batchSize=1000,maxBatches=5
```

---

## 6. Logs & Troubleshooting

### View Logs

```bash
gcloud logging read \
  'resource.type="cloud_function"
   AND resource.labels.function_name="orchestrator"' \
  --limit 20 \
  --format="table(timestamp,severity,textPayload)"
```

### Key Log Lines

* `🔔  Orchestrator invoked`
* `🛠  Params: startId=… batchSize=… maxBatches=…`
* `➡️  Batch N: IDs …` / `✅  Scraper batch done`
* `🔀  Invoking mergeHorseData Cloud Function`
* `✔️  Merge complete …`
* `🧹  Triggering clean-master-job` / `✅  Clean job done`
* `📋  Listing cleaned files …` / `✔️  Picked cleaned file …`
* `📥  Triggering ingestion job` / `✅  Ingestion job done`

If any step times out or throws, you’ll see a stack trace in these logs—inspect the specific Cloud Run job or function that failed next.