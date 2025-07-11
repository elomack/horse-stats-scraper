# Data Ingestion Service

This service merges, cleans, de-duplicates, and ingests newline-delimited JSON (NDJSON) horse data into BigQuery via three Cloud Run Jobs.

## A. Structure

— **src/index.js**  
 Loads a cleaned master NDJSON from GCS into BigQuery:  
 ∙ stages into a transient table  
 ∙ performs a MERGE upsert into `horse_records`  
 ∙ sets `updated_at = CURRENT_TIMESTAMP()`  

— **src/cleanMaster.js**  
 Streams the master NDJSON from GCS, drops malformed JSON lines, removes duplicate `id` entries, and writes a cleaned/​deduped file back to GCS  

— **src/mergeMaster.js** (if separate)  
 Gathers all batch NDJSON files under `horse_data/`, concatenates them into a single `master_…ndjson`, and deletes the original batch files  

— **Dockerfile**  
 Builds a container image for all three jobs  

— **package.json**  
 CommonJS mode; dependencies on `@google-cloud/storage` and `@google-cloud/bigquery`

## B. Jobs & Usage

— **Merge Job**  
```powershell
gcloud beta run jobs create merge-job `
  --region=<REGION> `
  --image=gcr.io/<PROJECT_ID>/data-ingestion-service:latest `
  --command node `
  --args=src/mergeMaster.js,horse-racing-data-<PROJECT_ID> `
  --tasks=1 --memory=256Mi --task-timeout=600s
````

— **Clean & Dedupe Job**

```powershell
gcloud beta run jobs create clean-master-job `
  --region=<REGION> `
  --image=gcr.io/<PROJECT_ID>/data-ingestion-service:latest `
  --command node `
  --args=src/cleanMaster.js,horse-racing-data-<PROJECT_ID>,horse_data/master_*.ndjson `
  --tasks=1 --memory=512Mi --task-timeout=600s
```

— **Ingestion Job**

```powershell
gcloud beta run jobs create horse-ingestion-job `
  --region=<REGION> `
  --image=gcr.io/<PROJECT_ID>/data-ingestion-service:latest `
  --command node `
  --args=src/index.js,horse-racing-data-<PROJECT_ID>,horse_data/*.ndjson `
  --tasks=1 --memory=512Mi --task-timeout=600s
```

Replace `<PROJECT_ID>` and `<REGION>` as needed. Each job’s `--args` are comma-separated:
• Merge takes only the GCS bucket
• Clean takes bucket + master file pattern
• Ingest takes bucket + cleaned master file path

## C. Build & Push

```powershell
cd services/data_ingestion_service

docker build `
  --tag gcr.io/<PROJECT_ID>/data-ingestion-service:latest `
  .

docker push gcr.io/<PROJECT_ID>/data-ingestion-service:latest
```

*or via Cloud Build*

```powershell
gcloud builds submit `
  --tag gcr.io/<PROJECT_ID>/data-ingestion-service:latest
```

## D. Execution

— **Merge**

```powershell
gcloud beta run jobs execute merge-job --region=<REGION>
```

— **Clean**

```powershell
gcloud beta run jobs execute clean-master-job --region=<REGION>
```

— **Ingest**

```powershell
gcloud beta run jobs execute horse-ingestion-job --region=<REGION>
```

## E. Logs & Validation

— **Cloud Run Jobs → Executions** shows each task’s stdout/stderr
— Key log entries:
 🔍 “Cleaning & de-duping master file: gs\://…”
 ✅ “Clean & de-dupe complete. Kept X rows”
 “Started load job…”
 “MERGE completed successfully.”

— **BigQuery row count**:

```bash
bq query --nouse_legacy_sql \
  'SELECT COUNT(*) FROM `horse-racing-predictor-<PROJECT_ID>.horse_racing_data.horse_records`'
```

Ensures final table matches your cleaned master file’s line count.