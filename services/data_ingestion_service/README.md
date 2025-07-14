# Data Ingestion Service

A Cloud Run–based service providing two Jobs that take a cleaned NDJSON “master file” in GCS and load it into BigQuery:

1. **clean-master-job**  
   - Streams & filters a raw NDJSON in GCS, dropping malformed lines and duplicate IDs  
   - Writes out a cleaned, deduped NDJSON back to GCS with a timestamp suffix  

2. **horse-ingestion-job**  
   - Loads the cleaned NDJSON into a transient BigQuery staging table  
   - MERGEs (upserts) staging into the production `horse_records` table  
   - Deletes the staging table  

---

## A. Repository Layout

```

services/data\_ingestion\_service/
├── Dockerfile
├── package.json        # "type": "module"; deps: @google-cloud/storage, @google-cloud/bigquery
├── src/
│   ├── cleanMaster.js  # Download→stream→filter→upload
│   ├── entrypoint.js   # CLI wrapper for ingestion
│   └── index.js        # ingestHorseData(bucket, filePath)
├── cleaning-job.yaml   # Cloud Run Job spec for clean-master-job
└── ingestion-job.yaml  # Cloud Run Job spec for horse-ingestion-job

````

---

## B. cleanMaster.js

- **Inputs:**  
  - `BUCKET_NAME` (env var) – GCS bucket  
  - `MASTER_FILE` (env var) – path to the raw NDJSON  

- **Process:**  
  1. Download `gs://BUCKET_NAME/MASTER_FILE` to a local temp file  
  2. Stream it line by line:  
     - skip blank lines  
     - drop malformed JSON  
     - drop duplicate `id` values  
  3. Write cleaned lines to `…_cleaned_deduped_<timestamp>.ndjson` in temp  
  4. Upload back to `gs://BUCKET_NAME/<same-folder>/…_cleaned_deduped_<timestamp>.ndjson`  

- **Exit codes:**  
  - `0` on success  
  - nonzero on missing env or any I/O error  

---

## C. index.js + entrypoint.js

- **`index.js`** exports `async function ingestHorseData(bucketName, filePath)` that:
  1. Loads NDJSON from GCS (`NEWLINE_DELIMITED_JSON`) into a new staging table  
  2. Runs a BigQuery `MERGE` to upsert into `horse_records`  
  3. Deletes the staging table  
- **`entrypoint.js`** handles `process.argv`, calls `ingestHorseData(...)`, and exits with code `0`/`1`.  

---

## D. Build & Push

```powershell
cd services/data_ingestion_service

# Build local Docker image
docker build `
  --tag gcr.io/horse-racing-predictor-465217/data-ingestion-service:latest `
  .

# Push to Container Registry
docker push gcr.io/horse-racing-predictor-465217/data-ingestion-service:latest

# (Or use Cloud Build)
gcloud builds submit `
  --tag gcr.io/horse-racing-predictor-465217/data-ingestion-service:latest
````

---

## E. Deploy Jobs

### 1. clean-master-job

Make sure `cleaning-job.yaml` contains:

```yaml
apiVersion: run.googleapis.com/v1
kind: Job
metadata:
  name: clean-master-job
spec:
  template:
    spec:
      parallelism: 1
      taskCount: 1
      template:
        spec:
          maxRetries: 3
          timeoutSeconds: 600
          containers:
            - image: gcr.io/horse-racing-predictor-465217/data-ingestion-service:latest
              command: ["node","src/cleanMaster.js"]
              env:
                - name: BUCKET_NAME
                  value: horse-racing-data-elomack
                - name: MASTER_FILE
                  value: "<PLACEHOLDER_MASTER_FILE>"
```

```bash
# Replace the Job definition
gcloud run jobs replace services/data_ingestion_service/cleaning-job.yaml \
  --region=europe-central2
```

### 2. horse-ingestion-job

Edit `ingestion-job.yaml` so its container spec reads:

```yaml
          containers:
            - image: gcr.io/horse-racing-predictor-465217/data-ingestion-service:latest
              command: ["node","src/entrypoint.js"]
              args:
                - horse-racing-data-elomack
                - "<PLACEHOLDER_CLEANED_FILE>"
```

```bash
# Replace the Job definition
gcloud run jobs replace services/data_ingestion_service/ingestion-job.yaml \
  --region=europe-central2
```

---

## F. Execute Jobs

Once your YAMLs refer to the correct `<PLACEHOLDER_*>` values, you can execute:

```bash
# Clean & dedupe
gcloud run jobs execute clean-master-job --region=europe-central2

# Ingest into BigQuery
gcloud run jobs execute horse-ingestion-job --region=europe-central2
```

---

## G. Logs & Validation

### Cloud Run Job logs

```bash
gcloud logging read \
  'resource.type="cloud_run_job"
   AND resource.labels.job_name="clean-master-job"' \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```

and similarly for `horse-ingestion-job`.

### BigQuery row count

```bash
bq query --nouse_legacy_sql \
  'SELECT COUNT(*) AS cnt 
   FROM `horse-racing-predictor-465217.horse_racing_data.horse_records`'
```

This should match the number of lines in your cleaned NDJSON.

---