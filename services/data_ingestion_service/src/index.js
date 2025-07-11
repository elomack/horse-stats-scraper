// src/cleanMaster.cjs

/**
 * Cleans and de-duplicates a master NDJSON file:
 *  - Drops malformed JSON rows
 *  - Keeps only the first record seen for each `id`
 */

const { Storage } = require("@google-cloud/storage");   // GCS client
const readline = require("readline");                  // line-by-line reader
const { Readable } = require("stream");                // to turn a string into a stream

// instantiate storage client
const storage = new Storage();

async function cleanAndDedupe(bucketName, inputPath) {
  // ── 1) Locate bucket & file
  const bucket = storage.bucket(bucketName);
  const inputFile = bucket.file(inputPath);

  // ── 2) Build output path with timestamp suffix
  const timestamp = new Date().toISOString().replace(/[:.]/g, "_");
  const outputPath = inputPath
    .replace(".ndjson", "")
    + `_cleaned_deduped_${timestamp}.ndjson`;
  const outputFile = bucket.file(outputPath);

  console.log(`🔍 Cleaning & de-duping master file: gs://${bucketName}/${inputPath}`);
  console.log(`   → will write: gs://${bucketName}/${outputPath}`);

  // ── 3) Download entire NDJSON, split into lines
  const [buffer] = await inputFile.download();
  const lines = buffer.toString().split("\n");
  const rl = readline.createInterface({
    input: Readable.from(lines)
  });

  // ── 4) Iterate, parse JSON, drop bad or duplicate records
  const seen = new Set();
  let kept = 0, droppedMalformed = 0, droppedDupes = 0;
  const outLines = [];

  for await (const line of rl) {
    if (!line.trim()) continue;                   // skip empty lines

    let obj;
    try {
      obj = JSON.parse(line);                     // parse JSON
    } catch {
      droppedMalformed++;                         // count malformed
      continue;
    }

    const id = obj.id;
    if (seen.has(id)) {
      droppedDupes++;                             // count duplicate
      continue;
    }

    seen.add(id);
    outLines.push(JSON.stringify(obj));           // keep the record
    kept++;
  }

  // ── 5) Save cleaned NDJSON back to GCS
  await outputFile.save(outLines.join("\n"), {
    contentType: "application/x-ndjson"
  });

  console.log(`✅ Clean & de-dupe complete. Kept ${kept} rows`);
  console.log(`   Dropped malformed: ${droppedMalformed}; duplicates: ${droppedDupes}`);
  console.log(`▶️  Output file: gs://${bucketName}/${outputPath}`);

  return outputPath;
}

// ───────────────────────────────────────────────────
// If invoked directly (not as a module), parse args and run:
if (require.main === module) {
  const [ , , bucketName, filePath ] = process.argv;

  // Usage check
  if (!bucketName || !filePath) {
    console.error("Usage: node src/cleanMaster.cjs <bucketName> <filePath>");
    process.exit(1);
  }

  // Run and handle errors
  cleanAndDedupe(bucketName, filePath)
    .catch(err => {
      console.error("Fatal error cleaning master:", err);
      process.exit(1);
    });
}
