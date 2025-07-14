# Horse-Racing Data Pipeline

A fully serverless, end-to-end GCP pipeline that:

1. **Scrapes** horse racing records in ID-based batches via Cloud Run Jobs  
2. **Merges** all batch NDJSON files into one master NDJSON via a Cloud Function  
3. **Cleans & de-duplicates** the master file via a Cloud Run Job  
4. **Ingests** the cleaned NDJSON into BigQuery with MERGE upserts via another Cloud Run Job  
5. **Orchestrates** every step in sequence using Cloud Workflows  

---

## Architecture

```mermaid
flowchart LR
  W[Cloud Workflows<br/>horse-pipeline-full] --> CF[Cloud Function<br/>orchestrator]
  CF --> SR[Cloud Run Job<br/>horse-data-scraper-job]
  SR --> MF[Cloud Function<br/>mergeHorseData]
  MF --> CL[Cloud Run Job<br/>clean-master-job]
  CL --> IG[Cloud Run Job<br/>horse-ingestion-job]
  IG --> CF
````

1. **Workflow** builds the orchestrator URL (with `startId`, `batchSize`, `maxBatches`) and calls the **orchestrator** CF.
2. **orchestrator** CF runs N scraper batches sequentially (`horse-data-scraper-job`).
3. It POSTs to **mergeHorseData** CF to stitch shards.
4. It triggers **clean-master-job** to drop bad JSON & duplicates.
5. It picks the latest cleaned file and invokes **horse-ingestion-job** to load into BigQuery.
6. Returns a JSON summary of all operations.

---

## Components

### 1. services/horse\_data\_scraper

* **Cloud Run Job** `horse-data-scraper-job`
* Fetches records in `[startId, startId+batchSize-1]` from external API
* Writes NDJSON shard to GCS

### 2. functions/merge

* **Cloud Function** `mergeHorseData` (Node.js 20)
* HTTP-triggered: concatenates all GCS shards under `horse_data/` → `master_horse_data_<timestamp>.ndjson`
* Deletes original per-batch files

### 3. services/data\_ingestion\_service

* **Cloud Run Jobs** on the same container image:

  1. **clean-master-job**: streams master NDJSON from GCS, drops malformed/duplicate rows, writes cleaned file back
  2. **horse-ingestion-job**: stages cleaned NDJSON into a transient BigQuery table, MERGEs into `horse_records`, then deletes staging

### 4. functions/trigger

* **Cloud Function** `triggerScraperBatch`
* HTTP-triggered: invokes one `horse-data-scraper-job` batch and returns immediately

### 5. functions/orchestrator

* **Cloud Function** `orchestrator` (Node.js 20, 1st-gen)
* HTTP-triggered: implements the core orchestrator logic for one batch or, in earlier versions, kicked off multiple batches

### 6. workflows

* **horse-pipeline-full.yaml**: Cloud Workflows definition driving the full pipeline

---

## Prerequisites

* GCP project with APIs enabled:

  * Cloud Run, Cloud Functions, Workflows, BigQuery, Cloud Storage
* `gcloud` CLI authenticated and pointing at your project
* Service accounts with appropriate IAM roles for Run Jobs, Functions, Workflows, BigQuery, Storage

---

## Getting Started

### A. Build & Push Docker Images

```powershell
# Horse Data Scraper
cd services/horse_data_scraper
docker build -t gcr.io/<PROJECT_ID>/horse-data-scraper:latest .
docker push gcr.io/<PROJECT_ID>/horse-data-scraper:latest

# Data Ingestion Service (merge, clean, ingest)
cd ../data_ingestion_service
docker build -t gcr.io/<PROJECT_ID>/data-ingestion-service:latest .
docker push gcr.io/<PROJECT_ID>/data-ingestion-service:latest
```

---

### B. Deploy Cloud Run Jobs

```bash
# Scraper Job
gcloud run jobs replace services/horse_data_scraper/job-full.yaml \
  --region=<REGION>

# Clean Job
gcloud run jobs replace services/data_ingestion_service/cleaning-job.yaml \
  --region=<REGION>

# Ingestion Job
gcloud run jobs replace services/data_ingestion_service/ingestion-job.yaml \
  --region=<REGION>
```

---

### C. Deploy Cloud Functions

```bash
# Merge Function
cd functions/merge
npm install
gcloud functions deploy mergeHorseData \
  --entry-point merge \
  --runtime nodejs20 \
  --trigger-http \
  --region=<REGION> \
  --allow-unauthenticated

# Trigger Function
cd ../trigger
npm install
gcloud functions deploy triggerScraperBatch \
  --entry-point trigger \
  --runtime nodejs20 \
  --trigger-http \
  --region=<REGION> \
  --allow-unauthenticated

# Orchestrator Function
cd ../orchestrator
npm install
gcloud functions deploy orchestrator \
  --entry-point orchestrator \
  --runtime nodejs20 \
  --trigger-http \
  --timeout=300s \
  --region=<REGION> \
  --allow-unauthenticated
```

---

### D. Deploy Cloud Workflow

```bash
cd workflows
gcloud workflows deploy horse-pipeline-full \
  --source=horse-pipeline-full.yaml \
  --location=<REGION> \
  --description="Full scrape→merge→clean→ingest pipeline"
```

---

## Running the Pipeline

Trigger the end-to-end flow by executing the workflow with your desired parameters:

```bash
exec_id=$(gcloud workflows run horse-pipeline-full \
  --location=<REGION> \
  --data='{"startId":1,"batchSize":1000,"maxBatches":50}' \
  --format="value(name)")

# Monitor status
gcloud workflows executions describe "$exec_id" \
  --location=<REGION> \
  --format="yaml(state,result)"
```

Alternatively, invoke the `orchestrator` function or call it directly via cURL:

```bash
curl -X GET "https://<REGION>-<PROJECT_ID>.cloudfunctions.net/orchestrator?startId=1&batchSize=1000&maxBatches=50"
```

---

## Validation & Observability

* **Cloud Workflows UI** shows each step’s status, timings, and any retries.
* **Cloud Logging**:

  * Functions: look for log lines like `🔔 Orchestrator invoked`, `🔀 Invoking mergeHorseData`, etc.
  * Run Jobs: check each execution’s stdout/stderr.
* **BigQuery** row-count check:

  ```bash
  bq query --nouse_legacy_sql \
    'SELECT COUNT(*) FROM `<PROJECT_ID>.horse_racing_data.horse_records`'
  ```
* **Alerts**: Configure Monitoring alerts on Workflow failures or ingestion errors.

---
