# mergeHorseData Cloud Function

A first-generation (Gen-1) HTTP-triggered Cloud Function that:

1. **Discovers** all per-batch NDJSON shards in GCS under a fixed prefix  
2. **Concatenates** them into a single `master_horse_data_<timestamp>.ndjson` file  
3. **Deletes** the original shard files  
4. **Returns** JSON containing the new master file path and the LRO operation name

---

## File Structure

- **index.js**  
  - Exports `merge` as the HTTP entry point  
  - Reads `BUCKET_NAME` from an environment variable  
  - Lists all `.ndjson` files under `horse_data/` (excluding any `_cleaned`/`_deduped` files)  
  - Merges them into one master file named `horse_data/master_horse_data_<ISO-timestamp>.ndjson`  
  - Deletes the originals  
  - Returns:
    ```json
    {
      "masterFile": "horse_data/master_horse_data_2025-07-14T12_34_56_789Z.ndjson",
      "operationName": "projects/.../locations/.../operations/..."
    }
    ```

- **package.json**  
  - Runtime dependencies:  
    ```json
    {
      "dependencies": {
        "@google-cloud/storage": "^7.16.0"
      }
    }
    ```

---

## Configuration

- **Environment Variable**  
  - `BUCKET_NAME` *(required)* – your GCS bucket, e.g. `horse-racing-data-elomack`  
- **Fixed settings in code**  
  - GCS prefix: `horse_data/`  
  - Shard glob: every `*.ndjson` in that folder **excluding** files containing `_cleaned` or `_deduped`  
  - Output master file format: `horse_data/master_horse_data_<timestamp>.ndjson`  

---

## Deployment

```powershell
cd functions/merge

# Install dependencies if you haven’t already
npm install

# Deploy to Cloud Functions
gcloud functions deploy mergeHorseData `
  --source . `
  --region europe-central2 `
  --runtime nodejs20 `
  --trigger-http `
  --entry-point merge `
  --timeout 300s `
  --set-env-vars BUCKET_NAME=horse-racing-data-elomack `
  --allow-unauthenticated
````

---

## Invocation / Usage

Because `BUCKET_NAME` is baked in via env var, you don’t need to pass any JSON body:

```bash
# cURL
curl -X POST \
  https://europe-central2-your-project.cloudfunctions.net/mergeHorseData

# or gcloud
gcloud functions call mergeHorseData \
  --region=europe-central2 \
  --data '{}'
```

---

## Response

```json
{
  "masterFile": "horse_data/master_horse_data_2025-07-14T12_34_56_789Z.ndjson",
  "operationName": "projects/your-project/locations/europe-central2/operations/abcdef1234567890"
}
```

* **`masterFile`** – GCS path (relative to bucket) of the newly-merged NDJSON
* **`operationName`** – the long-running-operation resource name you can poll if desired

---

## Logs & Validation

* **Cloud Logging**

  ```bash
  gcloud logging read \
    'resource.type="cloud_function" AND resource.labels.function_name="mergeHorseData"' \
    --limit 20 \
    --format="table(timestamp, severity, textPayload)"
  ```

  Key log messages to look for:

  * `Listing X shard files under horse_data/`
  * `Merging into master file: gs://<BUCKET_NAME>/horse_data/master_horse_data_<timestamp>.ndjson`
  * `Deleted shard file: <name>`
  * `✅ Merge complete`

* **GCS check**

  ```bash
  gsutil ls gs://horse-racing-data-elomack/horse_data/master_horse_data_*.ndjson
  ```

  You should see exactly one new `master_horse_data_<timestamp>.ndjson` per invocation.
