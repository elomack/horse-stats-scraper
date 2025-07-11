# Workflows

This folder contains the IaC definitions and orchestration logic for your scraping pipeline.

## A. Files

- **job-full.yaml**  
  A Kubernetes-style resource manifest for your Cloud Run Job `horse-data-scraper-job`.  
  It captures the full spec (image, resources, retries, timeout) as deployed via `gcloud run jobs replace`.  
  > **Note:** You only need this file if you want to manage your scraper job entirely via YAML and `kubectl`/`gcloud` apply. Otherwise the job is already configured and running in GCP.  

- **scrape-and-merge.yaml**  
  A Cloud Workflows definition that, in its current form:
  1. Invokes the **Orchestrator** service (which in turn drives the full scrape → merge → clean → ingest pipeline)
  2. Returns the Orchestrator’s HTTP response body to the caller  
  > **Note:** This is a lightweight “trigger” workflow. If you have moved to calling the workflow directly from your Orchestrator function, you may not need this file any longer.

## B. When & How to Use

1. **Deploy or update the scraper job via YAML** (optional):  
   ```bash
   gcloud run jobs replace job-full.yaml --region=europe-central2
````

This ensures the Run Job matches the spec in `job-full.yaml`.

2. **Deploy the Workflows definition**:

   ```bash
   gcloud workflows deploy scrape-and-merge \
     --source=scrape-and-merge.yaml \
     --location=europe-central2 \
     --description="Trigger the orchestrator service"
   ```

3. **Execute the workflow**:

   ```bash
   gcloud workflows run scrape-and-merge --location=europe-central2
   ```

   This will call your Orchestrator service endpoint and return its result.

## C. Lifecycle

* If you **modify** your Cloud Run Job spec, update `job-full.yaml` and re-apply.
* If you **change** orchestration logic (e.g. add polling, error-handling), edit `scrape-and-merge.yaml` and re-deploy the workflow.
* You can remove `scrape-and-merge.yaml` entirely and invoke your Orchestrator function directly once you’re confident the end-to-end flow is stable.