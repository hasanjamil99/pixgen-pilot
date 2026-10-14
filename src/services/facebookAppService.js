import { config } from '../config/env.js';
import * as repo from '../db/repository.js';

/**
 * The platform Facebook App behind "Continue with Facebook" (one app for all users).
 * Set by the super admin in Admin → Platform settings; FB_APP_ID / FB_APP_SECRET in .env are the fallback.
 * Returns { appId, appSecret, configId, source } or null when not configured.
 */
export async function getFacebookApp() {
  const saved = await repo.getPlatformSettings();
  if (saved.fb_app_id && saved.fb_app_secret) {
    return { appId: saved.fb_app_id, appSecret: saved.fb_app_secret, configId: saved.fb_login_config_id || null, source: 'dashboard' };
  }
  if (config.facebook.appId && config.facebook.appSecret) {
    return { appId: config.facebook.appId, appSecret: config.facebook.appSecret, configId: config.facebook.loginConfigId || null, source: 'env' };
  }
  return null;
}
