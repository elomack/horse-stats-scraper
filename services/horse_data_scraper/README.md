# Horse Data Scraper Service

A Cloud Run–based Job that fetches horse‐racing data in ID‐based batches from an external API and writes the results as NDJSON files into a GCS bucket. This is the first step of our end-to-end pipeline.

---

## A. Directory Layout

```

services/horse\_data\_scraper/
├── src/
│   └── index.js         # Main scraper logic
├── Dockerfile           # Builds the container image
├── package.json         # Dependencies: axios, @google-cloud/storage, p-retry, etc.
└── scraper-job.yaml     # (Optional) Job spec for gcloud run jobs replace

````

---

## B. How It Works

1. **CLI args**  
   `index.js` reads:
   ```js
   const startId   = Number(process.argv[2]);
   const batchSize = Number(process.argv[3]);
````

Both must be positive integers.

2. **Fetch & normalize**

   * Calls the external API in parallel (with retry/back-off).
   * Flattens / normalizes the `career` and `races` arrays.

3. **Write NDJSON**
   Streams each record as JSON ➔ newline, and uploads to:

   ```
   gs://horse-racing-data-elomack/horse_data/
     master_horse_data_<timestamp>.ndjson
   ```

4. **Exit codes**

   * `0` on success
   * nonzero on any fetch or GCS error

---

## C. Configuration

* **Bucket name**
  Hard-coded in `src/index.js` as:

  ```js
  const BUCKET_NAME = 'horse-racing-data-elomack';
  ```

  To change, update that constant or replace with `process.env.BUCKET_NAME`.

* **Concurrency**
  Default is 10 parallel HTTP calls. Tweak `CONCURRENCY_LIMIT` in code.

* **Defaults**
  If you invoke without args, defaults in code are `startId=1`, `batchSize=1000`.

---

## D. Build & Push

### Windows PowerShell

```powershell
cd services/horse_data_scraper

# Build your image locally
docker build `
  --tag gcr.io/horse-racing-predictor-465217/horse-data-scraper:latest `
  .

# Push to GCR
docker push gcr.io/horse-racing-predictor-465217/horse-data-scraper:latest
```

### Cloud Shell / Linux

```bash
cd services/horse_data_scraper

docker build \
  --tag gcr.io/horse-racing-predictor-465217/horse-data-scraper:latest \
  .

docker push gcr.io/horse-racing-predictor-465217/horse-data-scraper:latest
```

*Or via Cloud Build:*

```bash
gcloud builds submit \
  --tag gcr.io/horse-racing-predictor-465217/horse-data-scraper:latest
```

---

## E. Deploy as Cloud Run Job

You can manage the Job via YAML (`scraper-job.yaml`) or `gcloud beta run jobs create`.

### Option 1: gcloud CLI

```bash
gcloud beta run jobs create horse-data-scraper-job \
  --region=europe-central2 \
  --image=gcr.io/horse-racing-predictor-465217/horse-data-scraper:latest \
  --command=node \
  --args=src/index.js,${startId},${batchSize} \
  --task-timeout=3600s \
  --memory=512Mi \
  --parallelism=1 --task-count=1
```

### Option 2: YAML (`scraper-job.yaml`)

```yaml
apiVersion: run.googleapis.com/v1
kind: Job
metadata:
  name: horse-data-scraper-job
spec:
  template:
    spec:
      parallelism: 1
      taskCount: 1
      template:
        spec:
          timeoutSeconds: 3600
          containers:
            - image: gcr.io/horse-racing-predictor-465217/horse-data-scraper:latest
              command: ["node","src/index.js"]
              args:
                - "1"     # placeholder for startId
                - "1000"  # placeholder for batchSize
```

```bash
gcloud run jobs replace scraper-job.yaml --region=europe-central2
```

---

## F. Execute a Batch

```bash
# Process IDs 1–1000
gcloud beta run jobs execute horse-data-scraper-job \
  --region=europe-central2 \
  --args=1,1000
```

For the next batch (1001–2000):

```bash
gcloud beta run jobs execute horse-data-scraper-job \
  --region=europe-central2 \
  --args=1001,1000
```

---

## G. Logs & Monitoring

### View Logs

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="horse-data-scraper-job"' \
  --limit=20 \
  --format="table(timestamp, textPayload)"
```

### Key Log Messages

* `➡️  Starting scrape batch: IDs X–Y`
* `✅  Fetched horse <ID>: <name>`
* `⚠️  Retrying <ID> after error…`
* `🚀  Batch upload complete: gs://…/master_horse_data_<timestamp>.ndjson`

Use these logs to trace network failures, retry behavior, and final file writes.

---