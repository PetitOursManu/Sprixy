import { buildApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { recoverJobs } from './services/jobs.js';

const db = getDb();
const app = await buildApp();

if (config.masterKeySource === 'file') {
  app.log.warn('SPRIXY_MASTER_KEY is not set: using a generated key stored in the data directory. Set SPRIXY_MASTER_KEY in production and back it up.');
}

await recoverJobs((m) => app.log.info(m));

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`Sprixy listening on http://${config.host}:${config.port} — API docs at /api/docs`);
