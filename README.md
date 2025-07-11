# Horse Racing Data Pipeline

This repository contains a complete, serverless pipeline on GCP to scrape, clean, dedupe, and ingest horse racing data into BigQuery.

## Components

- **services/horse_data_scraper/**  
  Scraper service (Cloud Run Job) that fetches horse data in batches and writes NDJSON files to GCS.

- **services/data_ingestion_service/**  
  Ingestion service (Cloud Run Jobs) that:
  1. Merges batch files into one master NDJSON  
  2. Cleans & de-duplicates the master file  
  3. Stages and upserts into BigQuery via a MERGE

- **functions/**  
  - **trigger/** – HTTP Cloud Function to trigger a single scraper batch.  
  - **orchestrator/** – (optional) Cloud Run service or Function to launch the full pipeline.

- **workflows/**  
  Cloud Workflows definitions to orchestrate scrape → merge → clean → ingest steps end-to-end.

## Getting Started

1. Clone this repo  
2. Build & push all Docker images  
3. Deploy your Cloud Run Jobs & Functions  
4. Deploy Workflows YAML  
5. Trigger the root Workflow  

See each subfolder for detailed instructions.
