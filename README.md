# Horse-Racing Data Pipeline

A fully serverless, end-to-end GCP pipeline that:

1. **Scrapes** horse racing records in ID-based batches via Cloud Run Jobs
2. **Merges** all batch NDJSON files into one master NDJSON via a Cloud Function invoked from Workflows
3. **Cleans & de-duplicates** the master file via a Cloud Run Job
4. **Ingests** the cleaned NDJSON into BigQuery with MERGE upserts via another Cloud Run Job
5. **Retrains** an AI model on the updated data via Vertex AI AutoML *Tabular*
6. **Orchestrates** every step in sequence using Cloud Workflows

---

## Architecture

```mermaid
flowchart LR
  subgraph Workflow Orchestrator
    W[Cloud Workflows<br/>horse-pipeline-full] --> A[Orchestrator CF<br/>(scraper-only)]
    A --> SR[Cloud Run Job<br/>horse-data-scraper-job]
    SR --> B[Collect Shards in Workflows]
    B --> MF[Cloud Function<br/>mergeHorseData]
    MF --> CL[Cloud Run Job<br/>clean-master-job]
    CL --> IG[Cloud Run Job<br/>horse-ingestion-job]
  end

  subgraph Model Retraining
    IG --> TF[Cloud Function<br/>retrain]
    TF --> VA[Vertex AI AutoML Tabular]
  end
```

1. **Workflow**: defines constants, loops through `maxBatches`, calls the **Orchestrator CF** to run one scraper batch and accumulate its shard path.
2. After looping, the **Workflow** POSTs the list of shards to **mergeHorseData** to create a single master file.
3. **Workflow** invokes **clean-master-job** to drop malformed/duplicate rows.
4. **Workflow** invokes **horse-ingestion-job** to load cleaned data into BigQuery.
5. **Workflow** (optionally) calls the **retrain** Cloud Function to launch a Vertex AI AutoML Tabular retraining job.

---

## Components

### 1. services/horse\_data\_scraper

* **Cloud Run Job** `horse-data-scraper-job`
* Fetches records in `[startId, startId+batchSize-1]` from the external API
* Writes individual NDJSON shards to GCS under `horse_data/`

### 2. functions/merge

* **Cloud Function** `mergeHorseData` (Node.js 20)
* HTTP-triggered: accepts a JSON array of shard paths, concatenates them into `master_horse_data_<timestamp>.ndjson`, deletes per-batch shards

### 3. services/data\_ingestion\_service

* **Cloud Run Jobs** on a single container image:

  1. **clean-master-job**: streams the merged NDJSON, filters out malformed rows & duplicates, writes cleaned file
  2. **horse-ingestion-job**: stages cleaned NDJSON into a transient BigQuery table, MERGEs into `horse_records`, then cleans up

### 4. functions/orchestrator

* **Cloud Function** `orchestrator` (Node.js 20, 1st-gen)
* HTTP-triggered: runs a *single* scraper batch (`horse-data-scraper-job`) and returns its GCS shard path

### 5. workflows

* **horse-pipeline-full.yaml**: Cloud Workflows definition that implements the loop, fan-in merge/clean/ingest, and optional retrain call

### 6. functions/retrain

* **Cloud Function** `retrain` (Python 3.9)
* HTTP- or Pub/Sub-triggered: takes an optional `dry_run=true`, snapshots a BigQuery feature table, and launches a Vertex AI AutoML Tabular job

---

## Prerequisites

* GCP project with APIs enabled: Cloud Run, Cloud Functions, Workflows, BigQuery, Cloud Storage, Vertex AI
* `gcloud` CLI authenticated and targeting your project
* Service accounts with appropriate IAM roles: Run Jobs, Functions, Workflows invoker, Storage Admin, BigQuery Admin, AI Platform Admin

---

## Getting Started

### A. Build & Push Docker Images

```powershell
# Horse Data Scraper
cd services\horse_data_scraper
docker build -t gcr.io/<PROJECT_ID>/horse-data-scraper:latest .
docker push gcr.io/<PROJECT_ID>/horse-data-scraper:latest

# Data Ingestion Service (clean + ingest)
cd ../data_ingestion_service
docker build -t gcr.io/<PROJECT_ID>/data-ingestion-service:latest .
docker push gcr.io/<PROJECT_ID>/data-ingestion-service:latest
```

---

### B. Deploy Cloud Run Jobs

```powershell
# Scraper Job
gcloud run jobs replace services/horse_data_scraper/job-full.yaml `
  --region=<REGION>

# Clean Job
gcloud run jobs replace services/data_ingestion_service/cleaning-job.yaml `
  --region=<REGION>

# Ingestion Job
gcloud run jobs replace services/data_ingestion_service/ingestion-job.yaml `
  --region=<REGION>
```

---

### C. Deploy Cloud Functions

```powershell
# Merge Function
cd functions\merge
npm install
gcloud functions deploy mergeHorseData `
  --entry-point=merge `
  --runtime=nodejs20 `
  --trigger-http `
  --region=<REGION> `
  --allow-unauthenticated

# Orchestrator Function
cd ../orchestrator
npm install
gcloud functions deploy orchestrator `
  --entry-point=orchestrator `
  --runtime=nodejs20 `
  --trigger-http `
  --timeout=300s `
  --region=<REGION> `
  --allow-unauthenticated

# Retrain Function (HTTP)
cd ../retrain
pip install -r requirements.txt
gcloud functions deploy retrain `
  --entry-point=retrain `
  --runtime=python39 `
  --trigger-http `
  --timeout=540s `
  --memory=1Gi `
  --region=<REGION> `
  --allow-unauthenticated
```

---

### D. Deploy Cloud Workflow

```powershell
cd workflows
gcloud workflows deploy horse-pipeline-full `
  --source=horse-pipeline-full.yaml `
  --location=<REGION> `
  --description="Full scrape→merge→clean→ingest→retrain pipeline"
```

---

## Running the Pipeline & Retraining

### Trigger a workflow run

```powershell
$execId = gcloud workflows run horse-pipeline-full `
  --location=<REGION> `
  --data='{"startId":1,"batchSize":1000,"maxBatches":50}' `
  --format="value(name)"

gcloud workflows executions describe $execId `
  --location=<REGION> `
  --format="yaml(state,result)"
```

### Manually invoke retraining

```bash
# Dry run (no billing)
curl -X POST "https://<REGION>-<PROJECT>.cloudfunctions.net/retrain?dry_run=true"

# Real training
curl -X POST "https://<REGION>-<PROJECT>.cloudfunctions.net/retrain"
```

---

## Observability & Alerts

* **Cloud Workflows UI** – view each step and retries.
* **Cloud Logging** – functions and run jobs logs.
* **Vertex AI** – check training job status in AI Platform UI.
* **BigQuery** – verify row counts with:

  ```bash
  bq query --nouse_legacy_sql 'SELECT COUNT(*) FROM `<PROJECT_ID>.horse_racing_data.horse_records`'
  ```
* **Monitoring** – set alerts on Workflow failures or training job errors.

---
