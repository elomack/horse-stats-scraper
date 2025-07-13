// services/data_ingestion_service/src/cleanMaster.js

/**
 * cleanMaster.js
 *
 * Cleans and de-duplicates a GCS-hosted NDJSON:
 *  - Drops malformed JSON lines
 *  - Drops duplicate records by `id`
 *  - Streams everything so it never holds the full file in memory
 *
 * Expects two ENV vars:
 *   BUCKET_NAME – the GCS bucket name
 *   MASTER_FILE – path to the NDJSON within that bucket
 */

import { Storage } from "@google-cloud/storage"; // GCS client
import readline          from "readline";       // line-by-line reader
import fs                from "fs";             // local file I/O
import os                from "os";             // temp directory
import path              from "path";           // file path utilities

// ───────────────────────────────────────────────────
// 1) Read & validate inputs from ENV
// ───────────────────────────────────────────────────
const bucketName = process.env.BUCKET_NAME;
const inputPath  = process.env.MASTER_FILE;

if (!bucketName || !inputPath) {
  console.error(
    "❌ Missing required env vars. Please set both:\n" +
    `  BUCKET_NAME=${bucketName}\n` +
    `  MASTER_FILE=${inputPath}`
  );
  process.exit(1);
}

console.log(`✅ Env vars OK:\n  BUCKET_NAME=${bucketName}\n  MASTER_FILE=${inputPath}`);

// ───────────────────────────────────────────────────
// 2) Instantiate GCS client
// ───────────────────────────────────────────────────
const storage = new Storage();

/**
 * downloadAndClean()
 *
 * 1) Downloads the GCS file to local temp
 * 2) Streams & filters it
 * 3) Uploads cleaned result back to GCS under
 *    the same folder, with `_cleaned_deduped_<timestamp>` suffix
 */
async function downloadAndClean() {
  // A) Prepare local temp paths
  const tmpDir       = os.tmpdir();
  const localSource  = path.join(tmpDir, path.basename(inputPath));
  const timestamp    = new Date().toISOString().replace(/[:.]/g, "_");
  const baseName     = path.basename(inputPath, ".ndjson");
  const cleanedName  = `${baseName}_cleaned_deduped_${timestamp}.ndjson`;
  const localCleaned = path.join(tmpDir, cleanedName);

  // B) Download from GCS
  console.log(`⬇️  Downloading gs://${bucketName}/${inputPath} → ${localSource}`);
  await storage.bucket(bucketName).file(inputPath)
    .download({ destination: localSource });

  // C) Stream & clean
  console.log(`🔄 Streaming & cleaning…`);
  const rl = readline.createInterface({
    input: fs.createReadStream(localSource),
    crlfDelay: Infinity
  });

  const seenIds   = new Set();
  let total=0, kept=0, malformed=0, dupes=0;
  const outStream = fs.createWriteStream(localCleaned);

  for await (const line of rl) {
    total++;
    if (!line.trim()) continue;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      malformed++;
      continue;
    }

    if (!rec.id) {
      // skip records without an `id`
      continue;
    }
    if (seenIds.has(rec.id)) {
      dupes++;
      continue;
    }

    seenIds.add(rec.id);
    outStream.write(JSON.stringify(rec) + os.EOL);
    kept++;
  }

  // D) Finish write
  await new Promise((resolve, reject) => {
    outStream.end();
    outStream.on("finish", resolve);
    outStream.on("error", reject);
  });

  console.log(
    `✅ Done. Processed ${total} lines: kept ${kept}; ` +
    `malformed ${malformed}; duplicates ${dupes}`
  );

  // E) Upload cleaned back to GCS
  const remoteCleanedPath = path.join(path.dirname(inputPath), cleanedName);
  console.log(`⬆️  Uploading cleaned file → gs://${bucketName}/${remoteCleanedPath}`);
  await storage.bucket(bucketName)
    .upload(localCleaned, { destination: remoteCleanedPath });

  console.log(`🎉 Cleaning pipeline complete.`);
}

// ───────────────────────────────────────────────────
// 3) Execute and handle errors
// ───────────────────────────────────────────────────
downloadAndClean().catch(err => {
  console.error("❌ cleanMaster.js failed:", err);
  process.exit(1);
});
