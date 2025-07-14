# triggerScraperBatch Cloud Function

A **first-generation HTTP-triggered** Cloud Function that kicks off a **single** scraper batch by invoking the Cloud Run Job `horse-data-scraper-job` and immediately returns the operation name. This avoids long-running function timeouts when you just need to fire off one batch.

---

## A. What It Does

1. **Parses** two required parameters from the request:
   - `startId`  – the first horse ID in this batch  
   - `batchSize` – how many IDs to fetch  
2. **Validates** they’re positive integers  
3. **Calls** the Cloud Run Job:
   ```js
   await jobsClient.runJob({
     name: JOB_NAME,
     overrides: {
       containerOverrides: [
         { args: [ String(startId), String(batchSize) ] }
       ]
     }
   });
````

4. **Returns** JSON with the long-running Operation name, e.g.:

   ```json
   {
     "operationName": "projects/horse-racing-predictor-465217/locations/europe-central2/operations/abcd1234..."
   }
   ```

---

## B. File Layout

```
functions/trigger/
├── index.js         # main function logic
├── package.json     # dependencies: @google-cloud/run, express (if used)
└── README.md        # this file
```

---

## C. Configuration

* **Constants in code** (edit `index.js` if you rename):

  ```js
  const PROJECT_ID = 'horse-racing-predictor-465217';
  const REGION     = 'europe-central2';
  const JOB_NAME   = `projects/${PROJECT_ID}/locations/${REGION}/jobs/horse-data-scraper-job`;
  ```
* No external env-vars are required.

---

## D. Deploy

```bash
cd functions/trigger

npm install

gcloud functions deploy triggerScraperBatch \
  --region=europe-central2 \
  --runtime=nodejs20 \
  --trigger-http \
  --entry-point trigger \
  --timeout=60s \
  --allow-unauthenticated
```

---

## E. Invoke

### cURL

```bash
curl -X POST \
  "https://europe-central2-your-project.cloudfunctions.net/triggerScraperBatch" \
  -H "Content-Type: application/json" \
  -d '{"startId":1,"batchSize":1000}'
```

> You can also supply parameters as query strings for GET:
>
> ```
> https://…/triggerScraperBatch?startId=1&batchSize=1000
> ```

### gcloud

```bash
gcloud functions call triggerScraperBatch \
  --region=europe-central2 \
  --data '{"startId":1,"batchSize":1000}'
```

---

## F. Response

```json
{
  "operationName": "projects/horse-racing-predictor-465217/locations/europe-central2/operations/abcdef1234567890"
}
```

Use `operationName` to poll or inspect the status of that Cloud Run Job.

---

## G. Logs & Troubleshooting

### View logs

```bash
gcloud logging read \
  'resource.type="cloud_function" AND resource.labels.function_name="triggerScraperBatch"' \
  --limit=20 \
  --format="table(timestamp, severity, textPayload)"
```

### Key log lines

* `✅  Batch job triggered: <operationName>`
* Errors if the job invocation fails (bad params, permission issues, etc.).