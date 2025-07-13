// services/data_ingestion_service/src/index.js

/**
 * index.js
 *
 * Ingestion service for horse‐racing data.
 *
 * Steps:
 *   1) Load NDJSON data from GCS into a BigQuery staging table
 *   2) Perform a MERGE (upsert) from the staging table into the main table
 *   3) Delete the transient staging table
 *
 * Usage:
 *   node src/index.js <bucketName> <filePath>
 */

import { BigQuery } from '@google-cloud/bigquery';
import { Storage  } from '@google-cloud/storage';

// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------
const PROJECT_ID = 'horse-racing-predictor-465217';
const DATASET_ID = 'horse_racing_data';
const MAIN_TABLE = `${PROJECT_ID}.${DATASET_ID}.horse_records`;

const bigquery = new BigQuery({ location: 'europe-central2' });
const storage  = new Storage();

/**
 * ingestHorseData
 *
 * @param {string} bucketName – GCS bucket (e.g. "horse-racing-data-elomack")
 * @param {string} filePath   – Path to the cleaned NDJSON file within that bucket
 */
export async function ingestHorseData(bucketName, filePath) {
  const gcsUri = `gs://${bucketName}/${filePath}`;
  console.log(`📥 Starting ingestion for ${gcsUri}`);

  // ──────────────────────────────────────────────────────────
  // STEP 1: Load NDJSON into staging table
  // ──────────────────────────────────────────────────────────
  const stagingTableId = `horse_records_staging_${Date.now()}`;
  console.log(`⏳ Creating staging table: ${DATASET_ID}.${stagingTableId}`);
  const dataset = bigquery.dataset(DATASET_ID);

  const gcsFile     = storage.bucket(bucketName).file(filePath);
  const loadOptions = {
    sourceFormat:    'NEWLINE_DELIMITED_JSON',
    writeDisposition:'WRITE_TRUNCATE', // overwrite existing
    autodetect:      true
  };

  console.log(`🚚 Loading data into staging table: ${stagingTableId}`);
  const [loadJobRes] = await dataset
    .table(stagingTableId)
    .load(gcsFile, loadOptions);
  const loadJobId = loadJobRes.jobReference.jobId;
  console.log(`   → Load job ${loadJobId} started`);
  await bigquery.job(loadJobId).getMetadata();
  console.log(`✅ Load job ${loadJobId} completed`);

  // ──────────────────────────────────────────────────────────
  // STEP 2: Merge into main table (no correlated subqueries)
  // ──────────────────────────────────────────────────────────
  console.log(`🔄 Merging staging into main table: ${MAIN_TABLE}`);

  const mergeSql = `
MERGE \`${MAIN_TABLE}\` T
USING (
  SELECT
    id, name, gender, color, mother, motherId, father, fatherId,
    trainer, breed, breeder, owner, dateOfBirth,

    -- Transform career array:
    ARRAY(
      SELECT STRUCT(
        elem.raceYear       AS raceYear,
        ''                  AS raceName,
        CAST(elem.prize AS STRING) AS prize,
        ''                  AS otherDetails,
        elem.horseAge       AS horseAge,
        elem.raceType       AS raceType,
        elem.raceCount      AS raceCount,
        elem.raceWonCount   AS raceWonCount,
        elem.racePrizeCount AS racePrizeCount
      )
      FROM UNNEST(career) AS elem
    ) AS career_mapped,

    -- Transform races array:
    ARRAY(
      SELECT STRUCT(
        elem.horseOrder       AS horseOrder,
        elem.horseFinalPlace  AS horseFinalPlace,
        CAST(elem.prizeAmount AS STRING) AS prizeAmount,
        elem.prizeCurrency    AS prizeCurrency,
        elem.jockeyFirstName  AS jockeyFirstName,
        elem.jockeyLastName   AS jockeyLastName,
        elem.jockeyWeight     AS jockeyWeight,
        CAST(elem.trackDistance AS FLOAT64) AS trackDistance,
        CAST(elem.temperature   AS FLOAT64) AS temperature,
        elem.weather           AS weather,
        elem.raceGroup         AS raceGroup,
        elem.raceSubtype       AS raceSubtype,
        elem.raceCategoryName  AS raceCategoryName,
        elem.cityName          AS cityName,
        elem.trackTypeName     AS trackTypeName
      )
      FROM UNNEST(races) AS elem
    ) AS races_mapped

  FROM \`${PROJECT_ID}.${DATASET_ID}.${stagingTableId}\`
) S
ON T.id = S.id
WHEN MATCHED THEN
  UPDATE SET
    name        = S.name,
    gender      = S.gender,
    color       = S.color,
    mother      = S.mother,
    motherId    = S.motherId,
    father      = S.father,
    fatherId    = S.fatherId,
    trainer     = S.trainer,
    breed       = S.breed,
    breeder     = S.breeder,
    owner       = S.owner,
    dateOfBirth = S.dateOfBirth,
    career      = S.career_mapped,
    races       = S.races_mapped,
    updated_at  = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN
  INSERT (
    id, name, gender, color, mother, motherId, father, fatherId,
    trainer, breed, breeder, owner, career, races, dateOfBirth, updated_at
  )
  VALUES (
    S.id, S.name, S.gender, S.color, S.mother, S.motherId,
    S.father, S.fatherId, S.trainer, S.breed, S.breeder, S.owner,
    S.career_mapped, S.races_mapped, S.dateOfBirth, CURRENT_TIMESTAMP()
  );
`;

  const [mergeJob] = await bigquery.createQueryJob({ query: mergeSql });
  console.log(`   → Merge job ${mergeJob.id} started`);
  await mergeJob.promise();
  console.log(`✅ Merge job ${mergeJob.id} completed`);

  // ──────────────────────────────────────────────────────────
  // STEP 3: Clean up staging table
  // ──────────────────────────────────────────────────────────
  console.log(`🗑️  Deleting staging table: ${stagingTableId}`);
  await dataset.table(stagingTableId).delete();
  console.log(`✅ Staging table ${stagingTableId} deleted`);

  console.log(`🎉 Ingestion for ${gcsUri} finished successfully`);
}

// ──────────────────────────────────────────────────────────
// CLI bootstrap for direct execution
// ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , bucketName, filePath] = process.argv;
  if (!bucketName || !filePath) {
    console.error('❌ Usage: node src/index.js <bucketName> <filePath>');
    process.exit(1);
  }
  ingestHorseData(bucketName, filePath)
    .catch(err => {
      console.error('❌ Fatal error during ingestion:', err);
      process.exit(1);
    });
}
