# triggerScraperBatch Cloud Function

An HTTP‐triggered Cloud Function that starts a single scraper batch Run Job and returns immediately, avoiding long‐running timeouts.

## A. Structure

- **index.js**  
  Entry point exporting `exports.trigger`. Reads `startId` and `batchSize` from JSON POST body or URL query parameters, then uses `@google-cloud/run`’s `JobsClient` to invoke the Cloud Run Job `horse-data-scraper-job`.

- **package.json**  
  Lists dependency on `@google-cloud/run`.

## B. Configuration

- **JOB_NAME** in `index.js` must match your Cloud Run Job resource:
```

projects/\<PROJECT\_ID>/locations/<REGION>/jobs/horse-data-scraper-job

````

## C. Deployment

```powershell
cd functions/trigger

npm install

gcloud functions deploy triggerScraperBatch `
--runtime nodejs20 `
--trigger-http `
--region=<REGION> `
--entry-point trigger `
--allow-unauthenticated
````

## D. Usage

* **Via cURL** (replace URL with your function’s endpoint):

  ```bash
  curl -X POST https://<REGION>-<PROJECT_ID>.cloudfunctions.net/triggerScraperBatch \
    -H "Content-Type: application/json" \
    -d '{"startId":1,"batchSize":1000}'
  ```

* **Via gcloud**:

  ```powershell
  gcloud functions call triggerScraperBatch `
    --region=<REGION> `
    --data '{"startId":1,"batchSize":1000}'
  ```

## E. Logs & Monitoring

* View function logs in the Cloud Console → Logging → Functions.
* Key log messages:

  * `Batch job triggered: <operation.name>`
  * Any errors if the Cloud Run Job invocation fails.