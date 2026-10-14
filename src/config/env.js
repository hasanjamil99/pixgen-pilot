import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import cron from 'node-cron';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DB_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value).trim();
}

function int(name, fallback) {
  const raw = str(name);
  if (raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** True when a value is empty or still the "your_..._here" placeholder from .env.example. */
export function isPlaceholder(value) {
  return !value || /^your_[a-z0-9_]*_here$/i.test(value);
}

export function isValidHexColor(value) {
  return HEX_COLOR.test(String(value || ''));
}

export function isValidTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isValidCron(value) {
  return typeof value === 'string' && value.trim() !== '' && cron.validate(value.trim());
}

export function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const config = Object.freeze({
  rootDir: ROOT_DIR,
  port: int('PORT', 3000),
  bindHost: str('BIND_HOST', '0.0.0.0'),
  adminEmail: str('ADMIN_EMAIL', 'admin@example.com').toLowerCase(),
  adminPassword: str('ADMIN_PASSWORD', 'admin123'),
  // Signs dashboard login sessions. Optional: without it the key is derived from the admin
  // email + password, so changing the password logs every browser out.
  sessionSecret: str('SESSION_SECRET'),
  // Encrypts API keys and tokens stored in MySQL. Set once and never change it.
  secretsKey: str('SECRETS_KEY'),
  // Public address of the dashboard (used for the Facebook login redirect). Optional.
  publicUrl: str('PUBLIC_URL').replace(/\/+$/, ''),
  timezone: str('TIMEZONE', 'Asia/Dhaka'),
  db: Object.freeze({
    host: str('DB_HOST', '127.0.0.1'),
    port: int('DB_PORT', 3306),
    user: str('DB_USER', 'root'),
    password: process.env.DB_PASSWORD ?? '',
    name: str('DB_NAME', 'fb_autopilot'),
    connectionLimit: int('DB_POOL_SIZE', 10),
  }),
  gemini: Object.freeze({
    apiKey: str('GEMINI_API_KEY'),
    model: str('GEMINI_MODEL', 'gemini-3.8-flash'),
  }),
  facebook: Object.freeze({
    pageId: str('FB_PAGE_ID'),
    accessToken: str('FB_PAGE_ACCESS_TOKEN'),
    graphVersion: str('FB_GRAPH_VERSION', 'v21.0'),
    // Platform Facebook App used by "Continue with Facebook" for every user. Can also be set in Admin → Platform settings.
    appId: str('FB_APP_ID'),
    appSecret: str('FB_APP_SECRET'),
    loginConfigId: str('FB_LOGIN_CONFIG_ID'),
  }),
  puppeteerExecutablePath: str('PUPPETEER_EXECUTABLE_PATH') || undefined,
  // Defaults copied into the app_settings table on first start. After that the dashboard owns them.
  defaultSettings: Object.freeze({
    page_niche: str('PAGE_NICHE', 'Technology, AI, Business & Digital Productivity'),
    brand_name: str('BRAND_NAME', 'My Page Name'),
    brand_handle: str('BRAND_HANDLE', '@mypagehandle'),
    brand_logo_url: str('BRAND_LOGO_URL'),
    cron_schedule: str('CRON_SCHEDULE', '0 10 * * *'),
    primary_color: str('PRIMARY_COLOR', '#0f172a'),
    accent_color: str('ACCENT_COLOR', '#38bdf8'),
    gemini_model: str('GEMINI_MODEL', 'gemini-3.8-flash'),
  }),
  paths: Object.freeze({
    public: path.join(ROOT_DIR, 'public'),
    banners: path.join(ROOT_DIR, 'public', 'banners'),
    templates: path.join(ROOT_DIR, 'src', 'templates'),
    dashboard: path.join(ROOT_DIR, 'client', 'dist'),
  }),
});

export function isGeminiConfigured() {
  return !isPlaceholder(config.gemini.apiKey);
}

export function isFacebookConfigured() {
  return !isPlaceholder(config.facebook.pageId) && !isPlaceholder(config.facebook.accessToken);
}

/**
 * Checks the environment. Errors stop the app from starting; warnings are only logged
 * (a missing Gemini or Facebook key should not block the dashboard).
 */
export function validateConfig({ requireDatabase = true } = {}) {
  const errors = [];
  const warnings = [];
  const d = config.defaultSettings;

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push('PORT must be a number between 1 and 65535.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail)) errors.push('ADMIN_EMAIL must be a valid email address.');
  if (!config.adminPassword) errors.push('ADMIN_PASSWORD must not be empty.');
  if (!isValidTimezone(config.timezone)) errors.push(`TIMEZONE "${config.timezone}" is not a valid IANA timezone (e.g. Asia/Dhaka).`);

  if (requireDatabase) {
    if (!config.db.host) errors.push('DB_HOST is required.');
    if (!Number.isInteger(config.db.port) || config.db.port < 1) errors.push('DB_PORT must be a valid port number.');
    if (!config.db.user) errors.push('DB_USER is required.');
    if (!DB_NAME_PATTERN.test(config.db.name)) errors.push('DB_NAME may only contain letters, numbers and underscores.');
    if (!Number.isInteger(config.db.connectionLimit) || config.db.connectionLimit < 1) errors.push('DB_POOL_SIZE must be a positive number.');
  }

  if (!isValidCron(d.cron_schedule)) errors.push(`CRON_SCHEDULE "${d.cron_schedule}" is not a valid cron expression.`);
  if (!isValidHexColor(d.primary_color)) errors.push('PRIMARY_COLOR must be a hex color like #0f172a.');
  if (!isValidHexColor(d.accent_color)) errors.push('ACCENT_COLOR must be a hex color like #38bdf8.');
  if (d.brand_logo_url && !isValidHttpUrl(d.brand_logo_url)) errors.push('BRAND_LOGO_URL must be an http(s) URL or empty.');
  if (!/^v\d+\.\d+$/.test(config.facebook.graphVersion)) errors.push('FB_GRAPH_VERSION must look like v21.0.');

  if (requireDatabase && !config.secretsKey) warnings.push('SECRETS_KEY is not set. Stored API keys are encrypted with a key derived from SESSION_SECRET / the DB password instead; set SECRETS_KEY once and keep it.');
  if (config.adminPassword === 'admin123') warnings.push('ADMIN_PASSWORD is still the default "admin123". Change it before exposing the dashboard.');

  return { errors, warnings };
}
