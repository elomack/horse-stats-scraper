# Workflows

This directory holds the Cloud Workflows definition that drives your end-to-end scrape → merge → clean → ingest pipeline, plus (optionally) any Run-Job manifests you need.

---

## A. Files

| Filename                     | Purpose                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **job-full.yaml**            | (Optional) Cloud Run Job manifest for your `horse-data-scraper-job`—captures image, args, timeout, etc.     |
| **horse-pipeline-full.yaml** | The Cloud Workflows definition that:  
1. Defines `projectId` & `region` constants  
2. Loops `i = 1…maxBatches`, calling the **Orchestrator** CF to fire one scraper batch and collect its shard path  
3. Once loop completes, HTTP-POSTs the list of shards to `mergeHorseData` CF  
4. Invokes `clean-master-job` via the Cloud Run Admin API to drop bad JSON & de-dupe  
5. Invokes `horse-ingestion-job` via Run Admin API to load into BigQuery  
6. Returns a summary of the shards, merge info, clean job, and ingest job |
| **README.md**                | This document.                                                                                               |

---

## B. Deploy & Execute

### 1. (Optional) Ensure your scraper job manifest is applied

```powershell
gcloud run jobs replace job-full.yaml `
  --region=europe-central2
````

### 2. Deploy or update the workflow

```powershell
gcloud workflows deploy horse-pipeline-full `
  --source="horse-pipeline-full.yaml" `
  --location=europe-central2 `
  --description="End-to-end scrape → merge → clean → ingest orchestrator"
```

### 3. Kick off a run

Pass **all** three required parameters (`startId`, `batchSize`, `maxBatches`) as JSON. For example:

```powershell
# From PowerShell:
$execId = gcloud workflows run horse-pipeline-full `
  --location=europe-central2 `
  --data='{"startId":1,"batchSize":1000,"maxBatches":50}' `
  --format="value(name)"

# Then watch its status:
gcloud workflows executions describe $execId `
  --location=europe-central2 `
  --format="yaml(state,result)"
```

---

## C. Parameters

| Name           | Type | Description                                                 |
| -------------- | ---- | ----------------------------------------------------------- |
| **startId**    | int  | First horse ID to fetch                                     |
| **batchSize**  | int  | Number of horses per scraper batch                          |
| **maxBatches** | int  | Total scraper batches to run (collects `maxBatches` shards) |

*All three are **required**—the workflow will error if any are omitted.*

---

## D. How It Works

```mermaid
flowchart LR
  subgraph Workflow
    A[init_vars: projectId, region] --> B[init_shards: []]
    B --> C[batch_loop ⟳ N times]
    C -->|http.get orchestrator CF| D[Orchestrator CF → scraper-only]
    D -->|returns shardFile| E[append_shard → shards array]
    E --> C
    E --> F[merge_step → mergeHorseData CF (POST shards)]
    F --> G[clean_step → clean-master-job Run Job]
    G --> H[ingest_step → horse-ingestion-job Run Job]
  end
```

1. **init\_vars** — set `projectId` & `region`.
2. **init\_shards** — start with empty `shards` list.
3. **batch\_loop** — for each batch `i`:

   * Compute `start = startId + (i-1)*batchSize` and `end = start + batchSize - 1`
   * Build the Orchestrator CF URL `?startId=…&batchSize=…`
   * `http.get` the CF (which runs one scraper batch and returns `shardFile`)
   * Append that path to `shards` via `list.concat()`
4. **merge\_step** — `http.post` to `mergeHorseData` CF with `{ "shards": [...] }`
5. **clean\_step** — invoke `clean-master-job` via Cloud Run Admin API with `BUCKET_NAME` & `MASTER_FILE` env-vars
6. **ingest\_step** — invoke `horse-ingestion-job` via Cloud Run Admin API with `args: [ BUCKET_NAME, MASTER_FILE ]`
7. **finish** — return an object containing:

   * `shards`: array of all shard paths
   * `mergeInfo`: response body from merge CF (includes `masterFile`)
   * `cleanJob`: the Run Job execution resource
   * `ingestJob`: the Run Job execution resource

---

## E. Updating & Lifecycle

* **Change scraper image & args?**
  Update `job-full.yaml` and re-run `gcloud run jobs replace`.

* **Change orchestration logic?**
  Edit `horse-pipeline-full.yaml`, then re-deploy with `gcloud workflows deploy`.

* **Disable or delete the workflow**:

  ```powershell
  gcloud workflows disable horse-pipeline-full --location=europe-central2
  gcloud workflows delete  horse-pipeline-full --location=europe-central2
  ```
