import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config/env.js';
import { pingDatabase } from '../db/mysql.js';
import { BusyError } from '../services/schedulerService.js';
import { authRouter, requireAuth, requireSuperAdmin } from './auth.js';
import { accountRouter } from './routes/account.js';
import { adminRouter } from './routes/admin.js';
import { integrationsRouter, oauthCallbackRouter } from './routes/integrations.js';
import { pagesRouter } from './routes/pages.js';
import { asyncRoute } from './validation.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind nginx (and Docker's port mapping, which connects from a private bridge IP); lets req.ip be
  // the real client IP for the login limiter, and req.protocol https for the Facebook redirect URL.
  // Public addresses are never trusted as proxies.
  app.set('trust proxy', 'loopback, uniquelocal');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  // Image uploads (logo, sample banner) arrive as base64 data URLs and need a larger body limit.
  const smallJson = express.json({ limit: '1mb' });
  const uploadJson = express.json({ limit: '10mb' });
  app.use((req, res, next) => (/\/(logo|sample-design|background|from-sample)$/.test(req.path) ? uploadJson : smallJson)(req, res, next));

  app.use('/banners', express.static(config.paths.banners, { maxAge: '7d', index: false, fallthrough: false }));

  /* ---------------- API ---------------- */

  app.get('/api/health', asyncRoute(async (req, res) => {
    const db = await pingDatabase();
    res.status(db ? 200 : 503).json({ ok: db, db });
  }));

  app.use('/api', authRouter());
  app.use('/api', oauthCallbackRouter());
  app.use('/api/me', requireAuth, accountRouter());
  app.use('/api/integrations', requireAuth, integrationsRouter());
  app.use('/api/pages', requireAuth, pagesRouter());
  app.use('/api/admin', requireAuth, requireSuperAdmin, adminRouter());
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  /* ---------------- React dashboard (client/dist) ---------------- */

  const dashboardIndex = path.join(config.paths.dashboard, 'index.html');
  app.use('/assets', express.static(path.join(config.paths.dashboard, 'assets'), { maxAge: '1y', immutable: true, index: false }));
  app.use(express.static(config.paths.dashboard, { index: false, maxAge: '1d' }));
  // Every other GET is a dashboard route handled by React Router.
  app.get(/^\/(?!api\/|banners\/|assets\/).*/, (req, res) => {
    if (!fs.existsSync(dashboardIndex)) {
      return res.status(503).type('text').send('Dashboard is not built yet. Run "npm run build" and restart the app.');
    }
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(dashboardIndex);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof BusyError) return res.status(409).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.statusCode === 404 || error.status === 404) {
      return req.path.startsWith('/api') ? res.status(404).json({ error: error.message || 'Not found.' }) : res.status(404).send('Not found');
    }
    // Facebook/Gemini rejections are the user's configuration, not a server fault.
    const fallback = error.name === 'FacebookError' ? 400 : 500;
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : fallback;
    if (status === 500) console.error(`[web] ${req.method} ${req.path}:`, error.message);
    return res.status(status).json({ error: error.message || 'Something went wrong.', historyId: error.historyId ?? undefined });
  });

  return app;
}

export function startServer() {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, config.bindHost, () => {
      console.log(`[web] Dashboard running at http://${config.bindHost === '0.0.0.0' ? 'localhost' : config.bindHost}:${config.port}`);
      resolve(server);
    });
    server.on('error', reject);
    // Generating a post can take a minute or two; keep the connection open long enough.
    server.requestTimeout = 5 * 60 * 1000;
  });
}
