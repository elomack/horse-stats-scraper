# Horse-Racing Data Pipeline

This repository implements a fully serverless, end-to-end data pipeline on Google Cloud Platform to:

- **Scrape** raw horse racing data in ID-based batches  
- **Merge** batch files into a single master NDJSON  
- **Clean & de-duplicate** the master file  
- **Ingest** cleaned data into BigQuery via MERGE upserts  
- **Orchestrate** all steps in sequence with Cloud Workflows

---

## SERVICES

— **services/horse_data_scraper**  
 Cloud Run Job that fetches horse records for a given ID range and writes NDJSON files to GCS.

— **services/data_ingestion_service**  
 Cloud Run Jobs to merge batch files, clean/dedupe the master NDJSON, then stage & MERGE into BigQuery.

---

## FUNCTIONS

— **functions/trigger**  
 HTTP Cloud Function to invoke one scraper batch without waiting for completion.

— **functions/merge**  
 HTTP Cloud Function that concatenates all batch files into one master NDJSON and deletes the batch files.

— **functions/orchestrator**  
 Cloud Run service that starts the Cloud Workflow for the entire pipeline in response to an HTTP request.

---

## WORKFLOWS

— **workflows/scrape-and-merge.yaml**  
 Cloud Workflows definition that sequentially runs each batch scrape, polls for completion, then invokes merge, clean, and ingestion steps.

— **workflows/dataflow-trigger.yaml** (optional)  
 Cloud Workflows definition to launch a Dataflow template for high-throughput cleaning & ingestion.

---

## GETTING STARTED

a. Clone this repository.  
b. Configure `PROJECT_ID` and `REGION` constants in each component.  
c. Build and push Docker images for scraper, ingestion and orchestrator services:  
   ```powershell
   cd services/horse_data_scraper
   docker build -t gcr.io/<PROJECT_ID>/horse-data-scraper:latest .
   docker push gcr.io/<PROJECT_ID>/horse-data-scraper:latest

   cd ../data_ingestion_service
   docker build -t gcr.io/<PROJECT_ID>/data-ingestion-service:latest .
   docker push gcr.io/<PROJECT_ID>/data-ingestion-service:latest

   cd ../../functions/orchestrator
   docker build -t gcr.io/<PROJECT_ID>/orchestrator:latest .
   docker push gcr.io/<PROJECT_ID>/orchestrator:latest
````

d. Deploy Cloud Run Jobs and Functions according to each README.
e. Deploy Cloud Workflows:

```bash
cd workflows
gcloud workflows deploy scrape-merge-clean \
  --source=scrape-merge-clean.yaml \
  --location=<REGION> \
  --description="Full scrape→merge→clean→ingest pipeline"
```

---

## RUNNING THE PIPELINE

Trigger the orchestrator service (or directly run the workflow):

```bash
curl -X POST https://<REGION>-<PROJECT_ID>.run.app/ \
  -H "Content-Type: application/json" \
  -d '{"startId":1,"batchSize":1000}'
```

or

```bash
gcloud workflows run scrape-merge-clean --location=<REGION>
```

Monitor execution in Cloud Workflows → Executions, and verify final row count in BigQuery:

```bash
bq query --nouse_legacy_sql \
  "SELECT COUNT(*) FROM \`<PROJECT_ID>.horse_racing_data.horse_records\`"
```

---

## OBSERVABILITY & ALERTING

• Cloud Run & Functions logs contain detailed `console.log` steps for each batch, merge, clean, and ingest.
• Cloud Workflows UI shows step-by-step status and any retries.
• Configure Cloud Monitoring alerts on Workflow failures or ingestion errors.

---

This structure and documentation ensure that each component can be deployed, tested, and maintained independently while fitting into the overall orchestrated pipeline.
