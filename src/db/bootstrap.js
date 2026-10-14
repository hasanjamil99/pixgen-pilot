import { config, isPlaceholder } from '../config/env.js';
import { hashPassword } from '../services/authService.js';
import * as repo from './repository.js';

/**
 * Runs on every start:
 *  1. creates the super admin from ADMIN_EMAIL / ADMIN_PASSWORD when no account exists yet;
 *  2. copies GEMINI_API_KEY from .env into the super admin's integrations if they have none;
 *  3. upgrades a v1 (single page) database: its app_settings + FB_PAGE_* from .env become the
 *     super admin's first page, and old queue/history rows are attached to it.
 */
export async function bootstrap() {
  let admin = await repo.getUserByEmail(config.adminEmail);

  if (!admin && (await repo.countUsers()) === 0) {
    admin = await repo.createUser({
      email: config.adminEmail,
      name: 'Super Admin',
      passwordHash: await hashPassword(config.adminPassword),
      role: 'super_admin',
    });
    console.log(`[bootstrap] Created super admin ${admin.email}.`);
  }
  if (!admin) return;

  const settings = await repo.getUserSettings(admin.id);
  if (!settings.gemini_api_key && !isPlaceholder(config.gemini.apiKey)) {
    await repo.updateUserSettings(admin.id, { gemini_api_key: config.gemini.apiKey });
    console.log('[bootstrap] Stored GEMINI_API_KEY from .env in the super admin\'s integrations.');
  }

  const legacy = await repo.getLegacySettings();
  if (legacy.migrated_to_pages) return;

  if ((await repo.countPages(admin.id)) === 0) {
    const d = config.defaultSettings;
    const page = await repo.createPage(admin.id, {
      name: legacy.brand_name || d.brand_name,
      page_niche: legacy.page_niche || d.page_niche,
      brand_name: legacy.brand_name || d.brand_name,
      brand_handle: legacy.brand_handle ?? d.brand_handle,
      brand_logo_url: legacy.brand_logo_url ?? d.brand_logo_url,
      primary_color: legacy.primary_color || d.primary_color,
      accent_color: legacy.accent_color || d.accent_color,
      cron_schedule: legacy.cron_schedule || d.cron_schedule,
    });
    if (legacy.gemini_model) await repo.updateUserSettings(admin.id, { gemini_model: legacy.gemini_model });
    if (!isPlaceholder(config.facebook.pageId) && !isPlaceholder(config.facebook.accessToken)) {
      await repo.setPageFacebook(page.id, { fbPageId: config.facebook.pageId, fbPageName: null, token: config.facebook.accessToken });
    }
    const adopted = await repo.adoptOrphanRows(page.id);
    console.log(`[bootstrap] Created page #${page.id} "${page.name}" for ${admin.email}${adopted ? ` and moved ${adopted} old queue/history rows to it` : ''}.`);
  }
  await repo.setLegacySetting('migrated_to_pages', new Date().toISOString());
}
