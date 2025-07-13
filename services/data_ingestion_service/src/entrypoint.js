// services/data_ingestion_service/src/entrypoint.js

/**
 * entrypoint.js
 *
 * Bootstraps the ingestion:
 *   1) Reads CLI args for bucket & file path
 *   2) Calls ingestHorseData() exported from index.js
 *
 * NOTE: Using ES modules (per package.json "type": "module"), so we use `import`.
 */

// Log the raw args for debugging
console.log('Starting ingestion script with args:', process.argv.slice(2));

// ───────────────────────────────────────────────────────────────────────────────
// 1) Import the ingestion function (ES module syntax)
// ───────────────────────────────────────────────────────────────────────────────
import { ingestHorseData } from './index.js';

// ───────────────────────────────────────────────────────────────────────────────
// 2) Parse positional arguments
//   - bucketName: GCS bucket
//   - filePath:   cleaned NDJSON path within that bucket
// ───────────────────────────────────────────────────────────────────────────────
const [ bucketName, filePath ] = process.argv.slice(2);

if (!bucketName || !filePath) {
  console.error('❌ Usage: node src/entrypoint.js <bucketName> <filePath>');
  process.exit(1);
}

// ───────────────────────────────────────────────────────────────────────────────
// 3) Invoke the ingestion logic and handle success/failure
// ───────────────────────────────────────────────────────────────────────────────
try {
  await ingestHorseData(bucketName, filePath);
  console.log('🎉 Ingestion completed successfully');
  process.exit(0);
} catch (err) {
  console.error('❌ Fatal error during ingestion:', err);
  process.exit(1);
}
