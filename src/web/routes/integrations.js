import express from 'express';
import { config } from '../../config/env.js';
import * as repo from '../../db/repository.js';
import { createOAuthState, readOAuthState } from '../../services/authService.js';
import { maskSecret } from '../../services/cryptoService.js';
import { getFacebookApp } from '../../services/facebookAppService.js';
import { getPexelsKey } from '../../services/photoService.js';
import { buildOAuthUrl, exchangeCodeForToken, exchangeForLongLivedToken, listManagedPages } from '../../services/facebookService.js';
import { testGeminiKey } from '../../services/geminiService.js';
import { refreshPageSchedule } from '../../services/schedulerService.js';
import { asyncRoute, cleanGeminiModel, httpError, parseId } from '../validation.js';
import { connectFromUserToken, saveConnection } from './pages.js';

const OAUTH_CALLBACK_PATH = '/api/facebook/oauth/callback';

export function oauthRedirectUri(req) {
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}${OAUTH_CALLBACK_PATH}`;
}

function cleanSecretInput(value, label, max = 500) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /\s/.test(text)) throw httpError(`Enter a valid ${label}.`);
  return text;
}

async function integrationStatus(req) {
  const s = await repo.getUserSettings(req.user.id);
  const app = await getFacebookApp();
  return {
    gemini: {
      configured: Boolean(s.gemini_api_key),
      masked: maskSecret(s.gemini_api_key),
      model: s.gemini_model,
    },
    photos: { available: Boolean(await getPexelsKey()) },
    facebook: {
      // "Continue with Facebook" works once the super admin has set up the platform app.
      loginAvailable: Boolean(app),
      userConnected: Boolean(s.fb_user_token),
      userTokenExpiresAt: s.fb_user_token_expires_at || null,
    },
  };
}

/** Stores a long-lived user token for the user (the platform app is used for the exchange when available). */
export async function saveUserToken(userId, token) {
  const app = await getFacebookApp();
  if (!app) {
    await repo.updateUserSettings(userId, { fb_user_token: token, fb_user_token_expires_at: null });
    return { token, longLived: false };
  }
  const exchanged = await exchangeForLongLivedToken({ appId: app.appId, appSecret: app.appSecret, token });
  await repo.updateUserSettings(userId, {
    fb_user_token: exchanged.token,
    fb_user_token_expires_at: exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null,
  });
  return { token: exchanged.token, longLived: true };
}

export function integrationsRouter() {
  const router = express.Router();

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await integrationStatus(req));
  }));

  /* ---------------- Gemini ---------------- */

  router.put('/gemini', asyncRoute(async (req, res) => {
    const fields = {};
    if (req.body?.apiKey !== undefined && req.body.apiKey !== '') fields.gemini_api_key = cleanSecretInput(req.body.apiKey, 'Gemini API key');
    if (req.body?.model !== undefined) fields.gemini_model = cleanGeminiModel(req.body.model);
    if (Object.keys(fields).length === 0) throw httpError('Nothing to save.');
    await repo.updateUserSettings(req.user.id, fields);
    res.json(await integrationStatus(req));
  }));

  /** Tests the key in the request (before saving) or the saved key. */
  router.post('/gemini/test', asyncRoute(async (req, res) => {
    const saved = await repo.getUserSettings(req.user.id);
    const apiKey = req.body?.apiKey ? cleanSecretInput(req.body.apiKey, 'Gemini API key') : saved.gemini_api_key;
    if (!apiKey) throw httpError('Enter a Gemini API key first.');
    const model = req.body?.model ? cleanGeminiModel(req.body.model) : saved.gemini_model;
    res.json({ ok: true, ...(await testGeminiKey({ apiKey, model })) });
  }));

  router.delete('/gemini', asyncRoute(async (req, res) => {
    await repo.updateUserSettings(req.user.id, { gemini_api_key: null });
    res.json(await integrationStatus(req));
  }));

  /* ---------------- Facebook login ---------------- */

  /** Forgets the saved Facebook login (connected pages keep working with their own tokens). */
  router.delete('/facebook-user', asyncRoute(async (req, res) => {
    await repo.updateUserSettings(req.user.id, { fb_user_token: null, fb_user_token_expires_at: null });
    res.json(await integrationStatus(req));
  }));

  /**
   * Starts "Continue with Facebook". With a pageId the chosen Facebook Page is connected to that page;
   * with target "import" the user comes back to the multi-page import screen.
   */
  router.post('/facebook/oauth/start', asyncRoute(async (req, res) => {
    let stateData;
    if (req.body?.target === 'import') {
      stateData = { uid: req.user.id, target: 'import' };
    } else {
      const pageId = parseId(req.body?.pageId);
      const page = await repo.getPageForUser(req.user.id, pageId);
      if (!page) throw httpError('Page not found.', 404);
      stateData = { uid: req.user.id, pageId };
    }
    const app = await getFacebookApp();
    if (!app) {
      throw httpError(req.user.role === 'super_admin'
        ? 'Set up the Facebook App first: Admin → Platform settings.'
        : 'Facebook login is not set up yet. Ask the administrator.');
    }
    const state = createOAuthState(stateData);
    res.json({ url: buildOAuthUrl({ appId: app.appId, redirectUri: oauthRedirectUri(req), state, configId: app.configId }) });
  }));

  /** Facebook Pages from the saved Facebook login, marked with the PixGen Pilot page they are connected to. */
  router.get('/facebook/pages', asyncRoute(async (req, res) => {
    const s = await repo.getUserSettings(req.user.id);
    if (!s.fb_user_token) return res.json({ loggedIn: false, pages: [] });
    const [fbPages, ownPages] = await Promise.all([listManagedPages(s.fb_user_token), repo.listPages(req.user.id)]);
    const byFbId = new Map(ownPages.filter((page) => page.fb_page_id).map((page) => [page.fb_page_id, page]));
    return res.json({
      loggedIn: true,
      pages: fbPages.map(({ accessToken, ...page }) => {
        const linked = byFbId.get(page.id);
        return { ...page, connectedTo: linked ? { id: linked.id, name: linked.name } : null };
      }),
    });
  }));

  /** Creates and connects one PixGen Pilot page per selected Facebook Page. */
  router.post('/facebook/import', asyncRoute(async (req, res) => {
    const ids = Array.isArray(req.body?.fbPageIds) ? [...new Set(req.body.fbPageIds.map(String))].filter((id) => /^\d{3,30}$/.test(id)) : [];
    if (ids.length === 0) throw httpError('Pick at least one Facebook Page.');
    if (ids.length > 50) throw httpError('You can import up to 50 pages at a time.');
    const s = await repo.getUserSettings(req.user.id);
    if (!s.fb_user_token) throw httpError('Continue with Facebook first.');
    const fbPages = new Map((await listManagedPages(s.fb_user_token)).map((page) => [page.id, page]));
    const existingCount = await repo.countPages(req.user.id);
    if (existingCount + ids.length > 50) throw httpError('You can have up to 50 pages.');

    const created = [];
    const skipped = [];
    for (const id of ids) {
      const fb = fbPages.get(id);
      if (!fb || !fb.accessToken) {
        skipped.push({ id, reason: fb ? 'no posting access' : 'not found' });
        continue;
      }
      if (await repo.findPageByFacebookId(req.user.id, id)) {
        skipped.push({ id, name: fb.name, reason: 'already connected' });
        continue;
      }
      const page = await repo.createPage(req.user.id, { name: fb.name.slice(0, 150), brand_name: fb.name.slice(0, 100) });
      await saveConnection(page, { fbPageId: fb.id, fbPageName: fb.name, token: fb.accessToken });
      await refreshPageSchedule(page.id);
      created.push({ id: page.id, name: page.name });
    }
    res.status(201).json({ created, skipped });
  }));

  return router;
}

/** Public: Facebook sends the browser back here after login. */
export function oauthCallbackRouter() {
  const router = express.Router();

  router.get('/facebook/oauth/callback', async (req, res) => {
    const state = readOAuthState(String(req.query.state || ''));
    const back = (pageId, params) => res.redirect(`${state?.target === 'import' ? '/pages/import' : `/pages/${pageId}/facebook`}?${new URLSearchParams(params)}`);
    if (!state) return res.redirect('/?fb_error=' + encodeURIComponent('Facebook login expired. Try again.'));

    try {
      if (req.query.error) throw new Error(String(req.query.error_description || req.query.error_reason || 'Facebook login was cancelled.'));
      const user = await repo.getUserById(state.uid);
      if (!user || user.status !== 'active') throw new Error('Account not found.');
      const page = state.target === 'import' ? null : await repo.getPageForUser(user.id, state.pageId);
      if (state.target !== 'import' && !page) throw new Error('Page not found.');
      const app = await getFacebookApp();
      if (!app) throw new Error('Facebook login is not set up.');

      const shortToken = await exchangeCodeForToken({ appId: app.appId, appSecret: app.appSecret, redirectUri: oauthRedirectUri(req), code: String(req.query.code || '') });
      const { token } = await saveUserToken(user.id, shortToken);

      const pages = await listManagedPages(token);
      if (pages.length === 0) throw new Error('No pages were shared. Log in again and tick the page(s) you want to use.');
      if (state.target === 'import') return back(null, { fb: 'connected' });
      if (pages.length === 1) {
        await connectFromUserToken(page, token, pages[0].id);
        await refreshPageSchedule(page.id);
        return back(page.id, { fb: 'connected' });
      }
      return back(page.id, { fb: 'choose' });
    } catch (error) {
      console.error(`[facebook] OAuth callback failed: ${error.message}`);
      return back(state.pageId, { fb_error: error.message.slice(0, 300) });
    }
  });

  return router;
}
