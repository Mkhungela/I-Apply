/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import configRoutes from './routes/config.js';
import huntRoutes from './routes/hunt.js';

const log = logger('http');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers. The SPA is same-origin only, so no CORS relaxation is needed.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Embedding policy. In production the app refuses to be framed by other sites;
    // in development it also allows being embedded in a preview pane, which is how
    // this app is commonly reviewed. EMBED_ORIGINS overrides both (space separated,
    // or "*" for any origin).
    if (!config.embed.allowAll && !config.embed.origins.length) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        // Tailwind is compiled at build time; inline styles are needed for dynamic widths.
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        `frame-ancestors ${config.embed.allowAll ? '*' : ["'self'", ...config.embed.origins].join(' ')}`,
      ].join('; ')
    );
    next();
  });

/** Which client bundle is currently on disk (used to detect a stale browser cache). */
function currentClientBundle() {
  try {
    const html = fs.readFileSync(path.join(config.clientDist, 'index.html'), 'utf8');
    const match = /src="[^"]*?\/(assets\/[^"]+?\.js)"/.exec(html) || /"\/(assets\/[^"]+?\.js)"/.exec(html);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  /**
   * API access log.
   *
   * Records the outcome of every API call together with which credentials the request
   * carried. That combination is what makes authentication problems diagnosable: a
   * "401 with no credentials" (the browser never sent anything) is a completely
   * different bug from a "401 with credentials" (the session is stale or the database
   * was reset), and without this line there is no way to tell them apart remotely.
   */
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) return next();
    const startedAt = Date.now();
    const apiPath = req.path.startsWith('/api') ? req.originalUrl.split('?')[0] : req.path;
    res.on('finish', () => {
      const credentials = [
        req.headers.authorization?.startsWith('Bearer ') ? 'bearer' : null,
        req.cookies?.ajh_session ? 'cookie' : null,
      ].filter(Boolean).join('+') || 'none';
      const message = `${req.method} ${apiPath} ${res.statusCode} creds=${credentials} ${Date.now() - startedAt}ms`;
      if (res.statusCode >= 500) log.error(message);
      else if (res.statusCode >= 400) log.warn(message);
      else log.info(message);
    });
    next();
  });

  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      env: config.env,
      time: new Date().toISOString(),
      network: config.networkEnabled,
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api', profileRoutes);
  app.use('/api', configRoutes);
  app.use('/api', huntRoutes);

  app.use('/api', notFoundHandler);

  // Serve the built SPA when it exists (single-port deployment; also what the
  // live preview uses). In development, Vite serves the client and proxies /api here.
  if (fs.existsSync(config.clientDist)) {
    // The client's assets are content-hashed, so they can be cached hard — but
    // index.html must never be, or a browser keeps loading an outdated app after a
    // deploy. `no-store` on the HTML and immutable hashed assets is the safe pair.
    app.use(
      express.static(config.clientDist, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || !/-[A-Za-z0-9_-]{8}\./.test(path.basename(filePath))) {
            res.setHeader('Cache-Control', 'no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) =>
      res
        .status(200)
        .type('html')
        .send(
          `<!doctype html><html><body style="font-family:system-ui;padding:2rem;max-width:44rem;margin:auto">
          <h1>AI Job Hunter API is running</h1>
          <p>The web client has not been built yet. Run <code>npm run build</code> to build the UI, then restart,
          or run <code>npm run dev</code> for the Vite development server.</p>
          <p>API health: <a href="/api/health">/api/health</a></p>
          </body></html>`
        )
    );
  }

  app.use(errorHandler);
  return app;
}

export function startServer() {
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info(`AI Job Hunter listening on http://${config.host}:${config.port} (${config.env})`);
    if (!config.networkEnabled) log.warn('Outbound job-source network access is disabled (CONNECTOR_NETWORK_ENABLED=false).');
  });

  // Node closes idle keep-alive connections after 5 seconds by default. When the app
  // sits behind a reverse proxy or a tunnel (which pool their upstream connections),
  // the proxy can send a request down a connection the origin is closing at that exact
  // moment — the browser then sees an intermittent "502 Bad Gateway" on some API calls
  // while others succeed. Keeping the origin's timeout comfortably longer than the
  // proxy's avoids the race entirely.
  server.keepAliveTimeout = 76_000;
  server.headersTimeout = 77_000;
  server.requestTimeout = 0;

  return server;
}
