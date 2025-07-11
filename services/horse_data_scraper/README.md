# Horse Data Scraper Service

This service fetches horse data (including career and race details) from the external Homas API, normalizes it, and writes newline-delimited JSON (NDJSON) files into a Google Cloud Storage bucket.

## A. Features

— **Concurrent fetching** up to `CONCURRENCY_LIMIT` horses at a time
— **Automatic retries** with backoff on non-404 errors
— **404 handling:** skips missing IDs without failing the batch
— **Normalization:**
— merges partial career records when `raceYear` is null
— flattens race fields into a clean schema
— **Outputs NDJSON** to GCS under
`horse_data/horse_data_<start>_to_<end>_<timestamp>.ndjson`

## B. Prerequisites 

— **Node.js** v18+ and **npm**
— **Google Cloud SDK** (`gcloud`) authenticated to your project
— a **GCS bucket** (e.g. `horse-racing-data-elomack`) with write permissions
— a **service-account JSON key**, set via `GOOGLE_APPLICATION_CREDENTIALS`
— **Docker** (if you plan to containerize)

## C. Project Structure

```
data_scraper_service/
├── src/
│   └── index.js        # main scraper logic
├── Dockerfile
├── package.json
└── package-lock.json
```

## D. Configuration

— BUCKET\_NAME: GCS bucket to write NDJSON files (e.g. horse-racing-data-elomack) \[Required]
— CONCURRENCY\_LIMIT: Max parallel HTTP fetches \[Default: 10]
— GOOGLE\_APPLICATION\_CREDENTIALS: Path to your service-account JSON key \[Required]

You can override `CONCURRENCY_LIMIT` at runtime by exporting a different environment variable.

## E. Local Usage

a. install dependencies
cd services/data\_scraper\_service
npm install

b. export your credentials
set GOOGLE\_APPLICATION\_CREDENTIALS=path\to\horse-stats-scraper-sa.json

c. run a batch (IDs 1–1000)
node src\index.js 1 1000

After completion, check your bucket:
`gs://horse-racing-data-elomack/horse_data/horse_data_1_to_1000_<timestamp>.ndjson`

## F. Docker Usage

a. build the image
cd services/data\_scraper\_service
docker build -t horse-data-scraper\:latest .

b. run the container
docker run --rm ^
-e GOOGLE\_APPLICATION\_CREDENTIALS=/app/key.json ^
-v C:\local\path\to\key.json:/app/key.json ^
horse-data-scraper\:latest 1 1000

## G. Cloud Run Job Deployment

a. build & push your container
(to `gcr.io/your-project-id/horse-data-scraper:latest`)

b. create a Cloud Run job
gcloud beta run jobs create horse-data-scraper-job ^
\--image=gcr.io/your-project-id/horse-data-scraper\:latest ^
\--region=europe-central2 ^
\--set-env-vars=BUCKET\_NAME=horse-racing-data-elomack,CONCURRENCY\_LIMIT=10

c. execute for IDs 1–1000
gcloud beta run jobs execute horse-data-scraper-job ^
\--region=europe-central2 --args=1,1000

## H. Error Handling & Retries

— **404s:** API 404 responses are logged and skipped
— **Retries:** other HTTP errors trigger a 2 s delay and retry
— **Exit codes:**
— `0` — normal completion
— `2` — after 10 consecutive 404s (signals “end of data” to orchestrator)

## I. Contributing

— fork the repository
— create a feature branch
— submit a pull request with clear descriptions and tests

## J. License

MIT © Your Name
