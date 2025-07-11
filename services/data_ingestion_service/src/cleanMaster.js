// src/cleanMaster.js

/**
 * Cleans and de-duplicates a master NDJSON file:
 *  - Drops malformed JSON rows
 *  - Keeps only the first record seen for each `id`
 *  - Uses streaming so it never loads the entire file into memory
 */

const { Storage } = require("@google-cloud/storage");
const readline = require("readline");

const storage = new Storage();

async function cleanAndDedupe(bucketName, inputPath) {
  const bucket = storage.bucket(bucketName);
  const inputFile = bucket.file(inputPath);

  // Build cleaned+deduped filename
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "_");
  const outputPath =
    inputPath.replace(".ndjson", "") + `_cleaned_deduped_${timestamp}.ndjson`;
  const outputFile = bucket.file(outputPath);

  console.log(
    `🔍 Cleaning & de-duping master file: gs://${bucketName}/${inputPath}`
  );
  console.log(`   → will write: gs://${bucketName}/${outputPath}`);

  // Create a read stream + line-by-line interface
  const readStream = inputFile.createReadStream();
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  // Create a GCS write stream for the cleaned output
  const writeStream = outputFile.createWriteStream({
    contentType: "application/x-ndjson",
  });

  // Track seen IDs
  const seen = new Set();
  let kept = 0,
    droppedMalformed = 0,
    droppedDupes = 0;

  // As each line comes in...
  for await (const line of rl) {
    if (!line.trim()) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      droppedMalformed++;
      continue;
    }

    const id = obj.id;
    if (seen.has(id)) {
      droppedDupes++;
      continue;
    }

    seen.add(id);
    // Write the JSON back as a single line
    writeStream.write(JSON.stringify(obj) + "\n");
    kept++;
  }

  // Close out the write stream and wait for it to finish
  await new Promise((resolve, reject) => {
    writeStream.end();
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  console.log(
    `✅ Clean & de-dupe complete. Kept ${kept} rows; dropped malformed: ${droppedMalformed}; duplicates: ${droppedDupes}`
  );
  console.log(`▶️  Output file: gs://${bucketName}/${outputPath}`);
  return outputPath;
}

// When run as standalone
if (require.main === module) {
  const [, , bucketName, filePath] = process.argv;
  if (!bucketName || !filePath) {
    console.error("Usage: node src/cleanMaster.js <bucketName> <filePath>");
    process.exit(1);
  }
  cleanAndDedupe(bucketName, filePath).catch((err) => {
    console.error("Fatal error cleaning master:", err);
    process.exit(1);
  });
}
