/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Standalone scheduler worker.
 *
 * Deploy this alongside (or instead of) the web process when you want the job agent
 * to keep hunting in the background regardless of anyone's browser being open. It
 * shares the same SQLite database, so pause/resume/stop from the UI are honoured
 * immediately.
 *
 *   node server/src/worker.js          (or: npm run worker)
 */
import { initDatabase, closeDatabase } from './db/index.js';
import { log } from './lib/logger.js';
import { startScheduler, stopScheduler, schedulerStatus } from './services/scheduler.js';

async function main() {
  await initDatabase();
  startScheduler();
  log.info('worker started — campaigns will run on their schedules even with no browser open');
  setInterval(() => {
    const status = schedulerStatus();
    log.debug(`worker heartbeat: ${status.activeCampaigns.length} active run(s), ${status.campaigns.length} campaign(s) scheduled`);
  }, 300_000).unref();

  const shutdown = async () => {
    stopScheduler();
    await closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (err) => log.error(`unhandled rejection: ${err?.message || err}`));
}

main().catch((err) => {
  log.error(`worker failed: ${err.message}`);
  process.exit(1);
});
