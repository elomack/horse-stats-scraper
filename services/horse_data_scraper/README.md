# Horse Data Scraper Service

This service fetches horse racing data in ID-based batches from an external API and writes the results as NDJSON files into a Google Cloud Storage bucket.

## A. Structure

- **src/index.js**  
  Main scraper logic. Accepts `startId` and `batchSize` arguments, fetches horse records in parallel (with retry/back-off), normalizes career and race data, and writes a newline-delimited JSON file to GCS.

- **Dockerfile**  
  Defines the container image for Cloud Run Job execution.

- **package.json**  
  Lists Node.js dependencies (`axios`, `@google-cloud/storage`, etc.) and entrypoint scripts.

## B. Configuration

– Bucket name is set in `src/index.js` as `BUCKET_NAME`  
– Concurrency limit for HTTP calls: `CONCURRENCY_LIMIT` (default 10)  
– Default batch parameters:  
  - `startId` = 1  
  - `batchSize` = 1000  
  These can be overridden via command-line arguments.

## C. Build & Push

```powershell
cd services/horse_data_scraper

docker build `
  --tag gcr.io/<PROJECT_ID>/horse-data-scraper:latest `
  .

docker push gcr.io/<PROJECT_ID>/horse-data-scraper:latest
````

*or using Cloud Build*

```powershell
gcloud builds submit `
  --tag gcr.io/<PROJECT_ID>/horse-data-scraper:latest
```

## D. Deploy as Cloud Run Job

```powershell
gcloud beta run jobs create horse-data-scraper-job `
  --region=<REGION> `
  --image=gcr.io/<PROJECT_ID>/horse-data-scraper:latest `
  --command node `
  --args src/index.js,${startId},${batchSize} `
  --tasks=1 `
  --memory=512Mi `
  --task-timeout=3600s
```

– Replace `<PROJECT_ID>` and `<REGION>` with your values

## E. Trigger a Batch

```powershell
gcloud beta run jobs execute horse-data-scraper-job `
  --region=<REGION> `
  --args=1,1000
```

This starts processing IDs 1–1000. For subsequent batches, adjust the `--args` accordingly (e.g. `1001,1000`, etc.).

## F. Logs & Monitoring

– View batch logs in Cloud Run → Jobs → Executions.
– Key log messages:

* `Starting scrape batch: IDs X to Y`
* `Fetched horse <ID>: <name>`
* `Batch upload complete: gs://<bucket>/<fileName>`
* Warnings for 404s and retries

These logs allow you to trace each batch’s progress and diagnose any fetch failures.