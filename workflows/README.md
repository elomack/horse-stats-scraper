# Workflows

This directory holds the Cloud Workflows definitions and (optionally) Run-Job manifests that drive your end-to-end scrape → merge → clean → ingest pipeline.

---

## A. Files

| Filename                       | Purpose                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| **job-full.yaml**              | (Optional) Cloud Run Job manifest for your `horse-data-scraper-job`—captures image, args, timeout, etc. |
| **horse-pipeline-full.yaml**   | The main Cloud Workflows definition that:  
1. Builds the orchestrator URL (startId, batchSize, maxBatches)  
2. Calls the Orchestrator Cloud Function with a 600 s timeout & OIDC auth  
3. Fails fast on non-200 responses  
4. Returns the orchestrator’s JSON result |
| **README.md**                  | This document.                                                                                   |

> **Note:** We no longer use a separate “scrape-and-merge.yaml”—we invoke the Orchestrator directly via **horse-pipeline-full.yaml**.

---

## B. Deploy & Execute

### 1. (Optional) Ensure your scraper Job matches `job-full.yaml`

```bash
gcloud run jobs replace job-full.yaml \
  --region=europe-central2
````

### 2. Deploy or update the workflow

```bash
gcloud workflows deploy horse-pipeline-full \
  --source=horse-pipeline-full.yaml \
  --location=europe-central2 \
  --description="End-to-end scrape → merge → clean → ingest orchestrator"
```

### 3. Kick off a run

Pass your desired parameters (`startId`, `batchSize`, `maxBatches`) as JSON. For example:

```bash
# From Cloud Shell (Linux syntax):
exec_id=$(gcloud workflows run horse-pipeline-full \
  --location=europe-central2 \
  --data='{"startId":1,"batchSize":1000,"maxBatches":50}' \
  --format="value(name)")

# Then watch its status:
gcloud workflows executions describe "$exec_id" \
  --location=europe-central2 \
  --format="yaml(state,result)"
```

---

## C. Parameters

* **startId** (int) – the first horse ID to fetch
* **batchSize** (int) – number of horses per scraper batch
* **maxBatches** (int) – how many scraper batches to run

*All three are now **required** (no defaults in the workflow itself), so always supply them in your `--data` payload.*

---

## D. How It Fits Together

```mermaid
flowchart LR
  A[Workflow: horse-pipeline-full] --> B[Orchestrator CF]
  B --> C[Scraper Cloud Run Job<br/>(horse-data-scraper-job)]
  C --> D[mergeHorseData CF]
  D --> E[clean-master-job Cloud Run Job]
  E --> F[horse-ingestion-job Cloud Run Job]
  F --> B
```

1. **Workflow** builds URL & calls **Orchestrator**.
2. **Orchestrator** runs N scraper batches sequentially.
3. After scraping, it calls **mergeHorseData** to stitch shards.
4. Next, it kicks off the **clean-master-job** to drop malformed/duplicate rows.
5. Finally, it triggers **horse-ingestion-job** to load into BigQuery.
6. The orchestrator returns a JSON summary of all operations.

---

## E. Lifecycle & Updates

* **Modify scraper job spec?**
  Edit `job-full.yaml` and `gcloud run jobs replace`.

* **Change orchestration logic?**
  Edit `horse-pipeline-full.yaml` and re-deploy with `gcloud workflows deploy`.

* **Roll back or retire?**
  You can disable or delete the workflow:

  ```bash
  gcloud workflows disable horse-pipeline-full --location=europe-central2
  gcloud workflows delete horse-pipeline-full --location=europe-central2
  ```

---
