# Retrain Cloud Function

This folder contains a Google Cloud Function that, when invoked, triggers a Vertex AI AutoML Tabular retraining job using the latest BigQuery snapshot of your feature table.

## Files

- **main.py**  
  - Defines the `retrain(request)` entry point.  
  - Supports a dry-run mode via `?dry_run=true` query parameter to preview the BigQuery snapshot path without billing.  
  - Launches an asynchronous AutoML Tabular training job on the specified snapshot.

- **requirements.txt**  
  - Lists Python dependencies:
    - `google-cloud-aiplatform>=1.30.0`
  - (*Flask is provided by the Functions runtime.*)

---

## Manual Invocation

1. **Dry-Run** (no billing):  
   ```bash
   curl -X POST "https://<REGION>-<PROJECT>.cloudfunctions.net/retrain?dry_run=true"
````

**Response**:

```
[DRY RUN] Would launch training on bq://<PROJECT>.horse_racing_data.training_data_multiclass_snapshot_<YYYYMMDD>
```

2. **Real Training** (bills up to your budget):

   ```bash
   curl -X POST "https://<REGION>-<PROJECT>.cloudfunctions.net/retrain"
   ```

   **Response**:

   ```
   Launched training job for snapshot <YYYYMMDD>
   ```

---

## Deployment

From your repo root:

```powershell
gcloud functions deploy retrain `
  --region=europe-central2 `
  --runtime=python39 `
  --trigger-http `
  --entry-point=retrain `
  --source=functions/retrain `
  --timeout=540s `
  --memory=1Gi `
  --allow-unauthenticated
```

This creates an HTTP endpoint that you can invoke manually or via an automated scheduler.

---

## Automating with Cloud Scheduler

To have this run every Friday at 10:35 UTC without manual invocation, you can set up Cloud Scheduler → Pub/Sub → Cloud Function:

1. **Create a Pub/Sub topic** (if you haven’t already):

   ```powershell
   gcloud pubsub topics create retrain-trigger
   ```
2. **Redeploy** the function to trigger on that topic:

   ```powershell
   gcloud functions deploy retrain `
     --region=europe-central2 `
     --runtime=python39 `
     --trigger-topic=retrain-trigger `
     --entry-point=retrain `
     --source=functions/retrain `
     --timeout=540s `
     --memory=1Gi
   ```
3. **Create the Cloud Scheduler job**:

   ```powershell
   gcloud scheduler jobs create pubsub retrain-weekly-job `
     --project=horse-racing-predictor-465217 `
     --location=europe-central2 `
     --schedule="35 10 * * FRI" `
     --time-zone="UTC" `
     --topic=retrain-trigger `
     --message-body="{}"
   ```

Now Cloud Scheduler will publish to `retrain-trigger` at your chosen time, which in turn invokes your `retrain` function automatically each week.

---

## Notes

* **Function**: only runs when invoked (HTTP or Pub/Sub).
* **Scheduling**: must be configured separately with Cloud Scheduler (or another orchestrator).
* **Dry-Run**: use `?dry_run=true` to test without billing.
* **Model Versions**: every run creates a new model version in Vertex AI Model Registry, so you can roll back if needed.

```
