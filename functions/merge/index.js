// functions/merge/index.js

/**
 * mergeHorseData()
 *
 * HTTP Cloud Function to:
 *   1) List and filter partial NDJSONs in GCS under horse_data/
 *   2) Concatenate them in lex order into a new master file with "master_" prefix
 *   3) Log each major step for observability
 *   4) Delete the partial files after successfully writing the master
 */

const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

// Your bucket and folder configuration
const BUCKET_NAME = 'horse-racing-data-elomack';
const PREFIX = 'horse_data/';
const PARTIAL_REGEX = /^horse_data_\d+_to_\d+_.*\.ndjson$/;

/**
 * Format a Date as YYYY-MM-DD_HH:mm:ss
 */
function formatTimestamp(date) {
  const pad = n => String(n).padStart(2, '0');
  const YYYY = date.getUTCFullYear();
  const MM   = pad(date.getUTCMonth() + 1);
  const DD   = pad(date.getUTCDate());
  const hh   = pad(date.getUTCHours());
  const mm   = pad(date.getUTCMinutes());
  const ss   = pad(date.getUTCSeconds());
  return `${YYYY}-${MM}-${DD}_${hh}:${mm}:${ss}`;
}

exports.mergeHorseData = async (req, res) => {
  console.log('🔔 mergeHorseData invoked');

  try {
    const bucket = storage.bucket(BUCKET_NAME);

    // 1) List all files under PREFIX
    console.log(`📋 Listing objects with prefix ${PREFIX}`);
    const [files] = await bucket.getFiles({ prefix: PREFIX });

    // 2) Filter partial files
    const partialNames = files
      .map(f => f.name.replace(PREFIX, ''))
      .filter(name => PARTIAL_REGEX.test(name))
      .sort();

    console.log(`✅ Found ${partialNames.length} partial file(s) to merge`);

    if (partialNames.length === 0) {
      console.warn('⚠️ No partial files found; nothing to merge');
      res.status(404).send('No partial files to merge');
      return;
    }

    // 3) Prepare master file name with "master_" prefix
    const timestamp = formatTimestamp(new Date());
    const masterName = `${PREFIX}master_horse_data_${timestamp}.ndjson`;
    console.log(`🖊️  Creating master file: ${masterName}`);
    const masterFile = bucket.file(masterName);

    // 4) Concatenate partials into master
    const writeStream = masterFile.createWriteStream({
      contentType: 'application/x-ndjson',
    });

    for (const name of partialNames) {
      console.log(`➡️  Appending partial: ${name}`);
      const srcFile = bucket.file(`${PREFIX}${name}`);
      await new Promise((resolve, reject) => {
        srcFile.createReadStream()
          .on('error', err => {
            console.error(`❌ Error reading ${name}:`, err);
            reject(err);
          })
          .on('end', () => {
            console.log(`📝 Finished appending ${name}`);
            resolve();
          })
          .pipe(writeStream, { end: false });
      });

      // Ensure newline separation
      writeStream.write('\n');
    }

    // Finalize the master file
    await new Promise((resolve, reject) => {
      writeStream.end(() => {
        console.log('✋ Finished writing master file');
        resolve();
      });
      writeStream.on('error', err => {
        console.error('❌ Error writing master file:', err);
        reject(err);
      });
    });

    // 5) Delete partial files
    console.log('🗑️  Deleting partial files');
    await Promise.all(
      partialNames.map(name =>
        bucket.file(`${PREFIX}${name}`)
          .delete()
          .then(() => console.log(`🗑️  Deleted ${name}`))
          .catch(err => console.warn(`⚠️ Failed to delete ${name}:`, err))
      )
    );

    console.log(`🎉 mergeHorseData completed: ${masterName}`);
    res.status(200).send(`Merged ${partialNames.length} files into ${masterName}`);
  } catch (err) {
    console.error('❌ mergeHorseData failed:', err);
    res.status(500).send('Merge failed: ' + err.message);
  }
};
