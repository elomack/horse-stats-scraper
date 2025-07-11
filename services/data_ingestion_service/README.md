# Horse Data Ingestion Service

This service loads NDJSON horse-data files from Google Cloud Storage into BigQuery. It creates a transient staging table, imports the data, merges it into the main table (setting `updated_at`), and then cleans up the staging table.

## A. Prerequisites

— **Node.js** v18+ and **npm**
— **Google Cloud SDK** (`gcloud`) authenticated to your project
— A **BigQuery dataset** (`horse_racing_data`) and **main table** (`horse_records`) pre-created
— A **service-account JSON key**, set via `GOOGLE_APPLICATION_CREDENTIALS`
— **Docker** (if you plan to containerize)

## B. Project Structure

data\_ingestion\_service/
├── src/
│   ├── entrypoint.js   # parses CLI args & invokes ingestHorseData
│   └── index.js        # BigQuery load → merge → delete logic
├── Dockerfile
├── package.json
└── package-lock.json

## C. Configuration

— `GOOGLE_APPLICATION_CREDENTIALS`: Path to service-account JSON key \[Required]
— `PROJECT_ID`: GCP Project ID (`horse-racing-predictor-465217`) \[Set in code]
— `DATASET_ID`: BigQuery dataset (`horse_racing_data`) \[Set in code]
— `MAIN_TABLE`: Fully-qualified main table name \[Set in code]

## D. Local Usage

a. Install dependencies
cd services/data\_ingestion\_service
npm install

b. Export your credentials
set GOOGLE\_APPLICATION\_CREDENTIALS=path\to\horse-stats-scraper-sa.json

c. Run ingestion
node src\entrypoint.js horse-racing-data-elomack horse\_data/horse\_data\_1\_to\_1000\_<timestamp>.ndjson

## E. Docker Usage

a. Build the image
cd services/data\_ingestion\_service
docker build -t horse-data-ingestion\:latest .

b. Run the container
docker run --rm ^
-e GOOGLE\_APPLICATION\_CREDENTIALS=/app/key.json ^
-v C:\local\key.json:/app/key.json ^
horse-data-ingestion\:latest ^
horse-racing-data-elomack ^
horse\_data/horse\_data\_1\_to\_1000\_<timestamp>.ndjson

## F. Cloud Run Job Deployment

a. Build & push your container (to `gcr.io/your-project-id/horse-data-ingestion:latest`)

b. Create a Cloud Run job
gcloud beta run jobs create horse-data-ingestion-job ^
\--image=gcr.io/your-project-id/horse-data-ingestion\:latest ^
\--region=europe-central2

c. Execute the job
gcloud beta run jobs execute horse-data-ingestion-job ^
\--region=europe-central2 ^
\--args=horse-racing-data-elomack,horse\_data/horse\_data\_1\_to\_1000\_<timestamp>.ndjson

## G. How It Works

— Fetch main table metadata (schema & location)
— Build staging schema by dropping the `updated_at` field
— Create a transient staging table named `horse_records_staging_<timestamp>`
— Launch a BigQuery load job via `bigquery.createJob()`, await `job.promise()`
— Run a MERGE: upsert from staging into the main table, setting `updated_at = CURRENT_TIMESTAMP()`
— Delete the transient staging table

## H. Customizing

— **Persist staging tables:** comment out the `delete()` call in `src/index.js`
— **Use a permanent staging table:** replace the dynamic name with `horse_records_staging`, skip creation, and rely on `WRITE_TRUNCATE`
— **Schema changes:** update your BigQuery table schema or adjust the `stagingSchema` in code

## I. Contributing

— Fork the repository
— Create a feature branch
— Submit a pull request with clear descriptions and tests

## J. License

MIT © Your Name
