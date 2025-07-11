# Orchestrator Service

An HTTP‐triggered Cloud Run service that kicks off the full scrape → merge → clean → ingest pipeline by invoking the central Cloud Workflow.

## A. Structure

- **entrypoint.js**  
  Reads `startId`/`batchSize` (optional) from HTTP request, then calls the Cloud Workflow execution REST API to start `scrape-merge-clean` (or whatever your workflow is named). Returns immediately with the new workflow execution ID.

- **package.json**  
  Depends on `@google-cloud/workflows` (or uses `axios`/`node-fetch`), and sets `type: "module"` or `commonjs` as appropriate.

- **Dockerfile**  
  Builds the container for Cloud Run.

## B. Configuration

- **WORKFLOW_NAME** in `entrypoint.js` points to your deployed workflow:
```

projects/\<PROJECT\_ID>/locations/<REGION>/workflows/scrape-merge-clean

````
- Optional: default `startId` = 1, `batchSize` = 1000.

## C. Build & Push

```powershell
cd functions/orchestrator

docker build `
--tag gcr.io/<PROJECT_ID>/orchestrator:latest `
.

docker push gcr.io/<PROJECT_ID>/orchestrator:latest
````

*or using Cloud Build*

```powershell
gcloud builds submit `
  --tag gcr.io/<PROJECT_ID>/orchestrator:latest
```

## D. Deploy to Cloud Run

```powershell
gcloud run deploy orchestrator `
  --image=gcr.io/<PROJECT_ID>/orchestrator:latest `
  --region=<REGION> `
  --platform=managed `
  --allow-unauthenticated `
  --memory=256Mi `
  --timeout=300s
```

## E. Usage

* **Via cURL**:

  ```bash
  curl -X POST https://<REGION>-<PROJECT_ID>.run.app/ \
    -H "Content-Type: application/json" \
    -d '{"startId":1,"batchSize":1000}'
  ```
* **Via gcloud**:

  ```powershell
  gcloud run services invoke orchestrator `
    --region=<REGION> `
    --data '{"startId":1,"batchSize":1000}'
  ```

## F. Logs & Monitoring

* View Cloud Run logs in Cloud Console → Run → Services → orchestrator.
* Key log lines:

  * `Invoking workflow: scrape-merge-clean`
  * `Workflow execution started: projects/.../executions/<ID>`
  * Any immediate errors (invalid payload, auth issues).

Once invoked, you can track the pipeline in Cloud Workflows → Executions for end-to-end progress.