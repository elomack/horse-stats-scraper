// entrypoint.js
console.log('Starting ingestion script with args:', process.argv.slice(2));

// Import the ingestion function
import('./index.js').then(({ ingestHorseData }) => {
  // Extract bucketName and fileName from CLI args
  const args = process.argv.slice(2);
  const bucketName = args[0];
  const fileName = args[1];

  if (!bucketName || !fileName) {
    console.error('Usage: node entrypoint.js <bucketName> <fileName>');
    process.exit(1);
  }

  // Call the ingestion function with parsed arguments
  ingestHorseData(bucketName, fileName)
    .then(() => {
      console.log('Ingestion completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error during ingestion:', err);
      process.exit(1);
    });
});
