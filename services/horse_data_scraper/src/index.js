import { Storage } from '@google-cloud/storage';
import axios from 'axios';
import pLimit from 'p-limit';

// CONFIG: Your GCP bucket name
const BUCKET_NAME = 'horse-racing-data-elomack';

// Max concurrency of parallel fetches
const CONCURRENCY_LIMIT = 10;

// Initialize Google Cloud Storage client
const storage = new Storage();

// Helper to delay execution by ms milliseconds (used for retry delays)
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Normalize career data safely (merge prizes when raceYear is null)
function normalizeCareerData(raw) {
  if (!Array.isArray(raw)) {
    console.warn('Warning: career data is not iterable:', raw);
    return [];
  }
  const merged = [];
  let lastReal = null;

  for (const rec of raw) {
    if (rec.raceYear !== null) {
      lastReal = { ...rec };
      // Removed horseAge assignment here
    } else if (lastReal && rec.prize) {
      lastReal.prize = lastReal.prize
        ? `${lastReal.prize} + ${rec.prize}`
        : rec.prize;
    }
    if (rec.raceYear !== null) {
      merged.push(lastReal);
    }
  }
  return merged;
}

// Normalize races data safely
function normalizeRacesData(raw) {
  if (!Array.isArray(raw)) {
    console.warn('Warning: races data is not iterable:', raw);
    return [];
  }
  return raw.map(r => ({
    horseOrder: r.order,
    horseFinalPlace: r.place,
    prizeAmount: r.prize,
    prizeCurrency: r.race?.currency?.code || null,
    jockeyFirstName: r.jockey?.firstName || null,
    jockeyLastName: r.jockey?.lastName || null,
    jockeyWeight: r.jockeyWeight,
    trackDistance: r.race?.trackDistance,
    temperature: r.race?.temperature,
    weather: r.race?.weather,
    raceGroup: r.race?.group,
    raceSubtype: r.race?.subType,
    raceCategoryName: r.race?.category?.name,
    cityName: r.race?.city?.name,
    trackTypeName: r.race?.trackType?.name,
  }));
}

// Fetch data for one horse by id
async function fetchHorseData(id) {
  try {
    const res = await axios.get(`https://homas.pkwk.org/homas/race/search/horse/${id}`);
    const horse = res.data;

    const careerRes = await axios.get(`https://homas.pkwk.org/homas/race/search/horse/${id}/career`);
    const careerData = normalizeCareerData(careerRes.data.data); // removed horseAge param

    const racesRes = await axios.get(`https://homas.pkwk.org/homas/race/search/horse/${id}/races`);
    const racesData = normalizeRacesData(racesRes.data);

    // Return full horse object, including dateOfBirth from API
    return {
      id,
      name: horse.name,
      gender: horse.sex,
      color: horse.color?.polishName || null,
      mother: horse.mother?.name || null,
      motherId: horse.mother?.id || null,
      father: horse.father?.name || null,
      fatherId: horse.father?.id || null,
      trainer: horse.trainer?.lastName || null,
      breed: horse.breed,
      breeder: horse.breeders?.[0]?.name || null,
      owner: horse.raceOwners?.[0]?.name || null,
      dateOfBirth: horse.dateOfBirth || null,
      career: careerData,
      races: racesData,
    };
  } catch (err) {
    if (err.response?.status === 404) {
      return null; // horse not found, skip it
    }
    throw err; // propagate other errors
  }
}

// Main batch scraping function with concurrency control
async function scrapeBatch(startId, batchSize) {
  if (startId <= 0 || batchSize <= 0) {
    throw new Error('startId and batchSize must be positive integers');
  }

  console.log(`Starting scrape batch: IDs ${startId} to ${startId + batchSize - 1}`);

  const horses = [];
  const limit = pLimit(CONCURRENCY_LIMIT);

  const fetchPromises = [];
  for (let id = startId; id < startId + batchSize; id++) {
    fetchPromises.push(
      limit(async () => {
        try {
          const data = await fetchHorseData(id);
          if (data === null) {
            console.log(`Horse ${id} not found (404)`);
            return null;
          }
          console.log(`Fetched horse ${id}: ${data.name}`);
          return data;
        } catch (error) {
          console.error(`Error fetching horse ${id}:`, error.message);
          await delay(2000); // retry delay
          return null;
        }
      })
    );
  }

  const results = await Promise.all(fetchPromises);

  results.forEach(r => {
    if (r !== null) {
      horses.push(r);
    }
  });

  const bucket = storage.bucket(BUCKET_NAME);
  const fileName = `horse_data/horse_data_${startId}_to_${startId + batchSize - 1}_${Date.now()}.ndjson`;
  const file = bucket.file(fileName);

  // Serialize array of horse objects into NDJSON (newline-delimited JSON)
  const ndjson = horses.map(horse => JSON.stringify(horse)).join('\n');

  await file.save(ndjson, { contentType: 'application/x-ndjson' });

  console.log(`Batch upload complete: gs://${BUCKET_NAME}/${fileName}`);
}

// Accept batch parameters from command line, defaults to 1 to 1000
const startId = parseInt(process.argv[2], 10) || 1;
const batchSize = parseInt(process.argv[3], 10) || 1000;

// Run the scraping batch
scrapeBatch(startId, batchSize).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
