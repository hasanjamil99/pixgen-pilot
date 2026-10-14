import express from 'express';
import * as repo from '../../db/repository.js';
import { config } from '../../config/env.js';
import { maskSecret } from '../../services/cryptoService.js';
import { getFacebookApp } from '../../services/facebookAppService.js';
import { FB_SCOPES } from '../../services/facebookService.js';
import { getPexelsKey, testPexelsKey } from '../../services/photoService.js';
import { asyncRoute, httpError } from '../validation.js';
import { oauthRedirectUri } from './integrations.js';

/** Super admin: platform-wide settings (Facebook App, Pexels). */
export function adminRouter() {
  const router = express.Router();

  /* ---------------- Platform Facebook App ---------------- */

  async function facebookAppStatus(req) {
    const app = await getFacebookApp();
    return {
      configured: Boolean(app),
      source: app?.source || null,
      appId: app?.appId || '',
      maskedSecret: maskSecret(app?.appSecret),
      configId: app?.configId || '',
      redirectUri: oauthRedirectUri(req),
      siteUrl: config.publicUrl || `${req.protocol}://${req.get('host')}`,
      scopes: FB_SCOPES,
    };
  }

  router.get('/facebook-app', asyncRoute(async (req, res) => {
    res.json(await facebookAppStatus(req));
  }));

  router.put('/facebook-app', asyncRoute(async (req, res) => {
    const appId = String(req.body?.appId ?? '').trim();
    if (!/^\d{5,30}$/.test(appId)) throw httpError('The App ID is a number (Meta for Developers → your app → App settings → Basic).');
    const appSecret = String(req.body?.appSecret ?? '').trim();
    if (appSecret && !/^[A-Za-z0-9]{16,64}$/.test(appSecret)) throw httpError('The App Secret looks wrong (letters and numbers, from App settings → Basic → Show).');
    const configId = String(req.body?.configId ?? '').trim();
    if (configId && !/^\d{5,30}$/.test(configId)) throw httpError('The login configuration ID is a number.');
    const current = await repo.getPlatformSettings();
    if (!appSecret && !current.fb_app_secret) throw httpError('Enter the App Secret too.');
    await repo.setPlatformSettings({ fb_app_id: appId, fb_app_secret: appSecret || undefined, fb_login_config_id: configId || null });
    res.json(await facebookAppStatus(req));
  }));

  /* ---------------- Pexels (free stock photos) ---------------- */

  router.get('/pexels', asyncRoute(async (req, res) => {
    const key = await getPexelsKey();
    res.json({ configured: Boolean(key), masked: maskSecret(key) });
  }));

  router.put('/pexels', asyncRoute(async (req, res) => {
    const key = String(req.body?.apiKey ?? '').trim();
    if (!/^[A-Za-z0-9]{20,100}$/.test(key)) throw httpError('Paste the Pexels API key (letters and numbers).');
    await testPexelsKey(key);
    await repo.setPlatformSettings({ pexels_api_key: key });
    res.json({ configured: true, masked: maskSecret(key) });
  }));

  router.delete('/pexels', asyncRoute(async (req, res) => {
    await repo.setPlatformSettings({ pexels_api_key: null });
    const key = await getPexelsKey();
    res.json({ configured: Boolean(key), masked: maskSecret(key) });
  }));

  router.delete('/facebook-app', asyncRoute(async (req, res) => {
    await repo.setPlatformSettings({ fb_app_id: null, fb_app_secret: null, fb_login_config_id: null });
    res.json(await facebookAppStatus(req));
  }));

  return router;
}
