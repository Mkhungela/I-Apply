/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Application entry point.
 *
 * Runs the HTTP API *and* the campaign scheduler in one process by default — that is
 * the deployment model for "my phone can be off and the agent keeps working": put this
 * process on any always-on host (a small VPS, Fly.io, Railway, Render, a Raspberry Pi).
 *
 * Set SCHEDULER_ENABLED=false to run an API-only instance and run the scheduler
 * separately with `npm run worker`.
 */
import { initDatabase, closeDatabase } from './db/index.js';
import { config } from './config.js';
import { log } from './lib/logger.js';
import { startServer } from './app.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

const schedulerEnabled = String(process.env.SCHEDULER_ENABLED ?? 'true') !== 'false';

async function main() {
  await initDatabase();

  // Empty database in a non-production environment: create the demo account so the
  // app is explorable immediately. Disable with AUTO_SEED_DEMO=false.
  if (config.env !== 'production' && String(process.env.AUTO_SEED_DEMO ?? 'true') !== 'false') {
    const users = (await import('./db/index.js')).db().get('SELECT COUNT(*) AS c FROM users');
    if (!users?.c) {
      const { ensureDemoUser } = await import('./services/demoSeed.js');
      const { created } = await ensureDemoUser();
      if (created) log.info('created the demo account (demo@aijobhunter.local) — use “Explore with demo data” on the sign-in screen');
    }
  }

  const server = startServer();
  if (schedulerEnabled) {
    startScheduler();
  } else {
    log.warn('Scheduler disabled in this process (SCHEDULER_ENABLED=false) — run `npm run worker` for an always-on agent.');
  }

  const shutdown = async (signal) => {
    log.info(`${signal} received — shutting down gracefully`);
    stopScheduler();
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error(`unhandled rejection: ${err?.message || err}`, { stack: err?.stack }));
  process.on('uncaughtException', (err) => log.error(`uncaught exception: ${err?.message}`, { stack: err?.stack }));

  log.info('AI Job Hunter started', {
    env: config.env,
    port: config.port,
    scheduler: schedulerEnabled,
    dataDir: config.dataDir,
  });
}

main().catch((err) => {
  log.error(`failed to start: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
