# mergeHorseData Cloud Function

An HTTP‐triggered Cloud Function that consolidates all batch NDJSON files in GCS into a single master NDJSON file, then deletes the original batch files.

## A. Structure

- **index.js**  
  - Exports `exports.merge`.  
  - Reads GCS bucket name and optional output prefix from request.  
  - Lists all `horse_data_*.ndjson` files under `horse_data/` in the specified bucket.  
  - Concatenates them into one `master_horse_data_<timestamp>.ndjson` in GCS.  
  - Deletes the original per‐batch files.  
  - Logs each step with `console.log`.

- **package.json**  
  - Depends on `@google-cloud/storage`.

## B. Configuration

- **BUCKET_NAME** passed via HTTP request body or query string.  
- **GCS path** for batch files is hard‐coded to `horse_data/horse_data_*.ndjson`.  
- **Timestamp naming** ensures each master file is unique.

## C. Deployment

```powershell
cd functions/merge

npm install

gcloud functions deploy mergeHorseData `
  --runtime nodejs20 `
  --trigger-http `
  --region=<REGION> `
  --entry-point merge `
  --allow-unauthenticated
````

## D. Usage

* **Via cURL**:

  ```bash
  curl -X POST https://<REGION>-<PROJECT_ID>.cloudfunctions.net/mergeHorseData \
    -H "Content-Type: application/json" \
    -d '{"bucketName":"horse-racing-data-elomack"}'
  ```

* **Via gcloud**:

  ```powershell
  gcloud functions call mergeHorseData `
    --region=<REGION> `
    --data '{"bucketName":"horse-racing-data-elomack"}'
  ```

## E. Logs & Validation

* View logs in Cloud Console → Logging → Functions → mergeHorseData.
* Key log messages:

  * `Listing X batch files under horse_data/`
  * `Merging into master file: gs://…/master_horse_data_<timestamp>.ndjson`
  * `Deleted batch file: …`
  * `Merge complete.`