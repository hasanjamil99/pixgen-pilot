import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

const CHARSET = 'utf8mb4_unicode_ci';
const CONNECT_ATTEMPTS = 10;
const CONNECT_RETRY_MS = 3000;
const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

let pool = null;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    name VARCHAR(100) NOT NULL DEFAULT '',
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('super_admin', 'user') NOT NULL DEFAULT 'user',
    status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    last_login_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_email (email)
  ) ${TABLE_OPTIONS}`,

  // Per-user integrations. Secret columns hold AES-GCM ciphertext (see cryptoService).
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id INT PRIMARY KEY,
    gemini_api_key TEXT DEFAULT NULL,
    gemini_model VARCHAR(100) NOT NULL DEFAULT 'gemini-3.8-flash',
    fb_app_id VARCHAR(64) DEFAULT NULL,
    fb_app_secret TEXT DEFAULT NULL,
    fb_user_token TEXT DEFAULT NULL,
    fb_user_token_expires_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  // One row per Facebook Page a user runs: its connection, brand, niche and schedule.
  `CREATE TABLE IF NOT EXISTS pages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    fb_page_id VARCHAR(64) DEFAULT NULL,
    fb_page_name VARCHAR(255) DEFAULT NULL,
    fb_page_token TEXT DEFAULT NULL,
    fb_connected_at TIMESTAMP NULL DEFAULT NULL,
    page_niche TEXT NOT NULL,
    brand_name VARCHAR(100) NOT NULL,
    brand_handle VARCHAR(100) NOT NULL DEFAULT '',
    brand_logo_url VARCHAR(1000) NOT NULL DEFAULT '',
    primary_color VARCHAR(7) NOT NULL DEFAULT '#0f172a',
    accent_color VARCHAR(7) NOT NULL DEFAULT '#38bdf8',
    cron_schedule VARCHAR(100) NOT NULL DEFAULT '0 10 * * *',
    autopilot_enabled TINYINT(1) NOT NULL DEFAULT 1,
    competitors TEXT DEFAULT NULL,
    auto_research TINYINT(1) NOT NULL DEFAULT 0,
    use_ideas TINYINT(1) NOT NULL DEFAULT 1,
    plan_approval ENUM('auto', 'manual') NOT NULL DEFAULT 'auto',
    banner_mode ENUM('default', 'style', 'custom', 'image') NOT NULL DEFAULT 'default',
    background_image_path VARCHAR(255) DEFAULT NULL,
    image_style TEXT DEFAULT NULL,
    background_images TEXT DEFAULT NULL,
    bg_index INT NOT NULL DEFAULT 0,
    background_source ENUM('brand', 'photos', 'mix') NOT NULL DEFAULT 'brand',
    banner_style TEXT DEFAULT NULL,
    custom_template MEDIUMTEXT DEFAULT NULL,
    sample_design_path VARCHAR(255) DEFAULT NULL,
    research_json MEDIUMTEXT DEFAULT NULL,
    researched_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pages_user (user_id),
    CONSTRAINT fk_pages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS topic_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    page_id INT DEFAULT NULL,
    topic VARCHAR(500) NOT NULL,
    category VARCHAR(150) DEFAULT NULL,
    priority INT DEFAULT 0,
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    error_message TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_queue_page_next (page_id, status, priority, id)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS post_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    page_id INT DEFAULT NULL,
    topic VARCHAR(500) NOT NULL,
    banner_badge VARCHAR(150),
    banner_headline VARCHAR(500),
    banner_subheadline VARCHAR(500),
    post_caption TEXT NOT NULL,
    banner_image_path VARCHAR(255),
    fb_post_id VARCHAR(150) DEFAULT NULL,
    status ENUM('published', 'preview_only', 'failed', 'scheduled', 'planned') DEFAULT 'published',
    error_message TEXT DEFAULT NULL,
    queue_id INT DEFAULT NULL,
    scheduled_at TIMESTAMP NULL DEFAULT NULL,
    approved TINYINT(1) NOT NULL DEFAULT 1,
    banner_type VARCHAR(20) DEFAULT NULL,
    banner_points TEXT DEFAULT NULL,
    banner_bg VARCHAR(500) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_history_page (page_id, id),
    INDEX idx_history_page_status (page_id, status),
    INDEX idx_history_due (status, scheduled_at)
  ) ${TABLE_OPTIONS}`,

  // AI suggested post ideas per page; the user queues, previews or dismisses them.
  `CREATE TABLE IF NOT EXISTS post_ideas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    page_id INT NOT NULL,
    topic VARCHAR(500) NOT NULL,
    angle TEXT DEFAULT NULL,
    category VARCHAR(150) DEFAULT NULL,
    status ENUM('new', 'queued', 'used', 'dismissed') NOT NULL DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ideas_page (page_id, status, id)
  ) ${TABLE_OPTIONS}`,

  // Legacy single-page settings (v1). Read once to create the first page, kept for reference.
  `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NOT NULL
  ) ${TABLE_OPTIONS}`,
];

/* Changes for databases created by v1 (single page, no page_id). Each runs only when needed. */
const MIGRATIONS = [
  { table: 'topic_queue', column: 'page_id', sql: 'ALTER TABLE topic_queue ADD COLUMN page_id INT DEFAULT NULL AFTER id' },
  { table: 'topic_queue', index: 'idx_queue_page_next', sql: 'ALTER TABLE topic_queue ADD INDEX idx_queue_page_next (page_id, status, priority, id)' },
  { table: 'post_history', column: 'page_id', sql: 'ALTER TABLE post_history ADD COLUMN page_id INT DEFAULT NULL AFTER id' },
  { table: 'post_history', column: 'queue_id', sql: 'ALTER TABLE post_history ADD COLUMN queue_id INT DEFAULT NULL' },
  { table: 'post_history', index: 'idx_history_page', sql: 'ALTER TABLE post_history ADD INDEX idx_history_page (page_id, id)' },
  { table: 'post_history', index: 'idx_history_page_status', sql: 'ALTER TABLE post_history ADD INDEX idx_history_page_status (page_id, status)' },
  { table: 'post_history', column: 'scheduled_at', sql: 'ALTER TABLE post_history ADD COLUMN scheduled_at TIMESTAMP NULL DEFAULT NULL AFTER queue_id' },
  { table: 'post_history', index: 'idx_history_due', sql: 'ALTER TABLE post_history ADD INDEX idx_history_due (status, scheduled_at)' },
  { table: 'pages', column: 'competitors', sql: 'ALTER TABLE pages ADD COLUMN competitors TEXT DEFAULT NULL' },
  { table: 'pages', column: 'auto_research', sql: 'ALTER TABLE pages ADD COLUMN auto_research TINYINT(1) NOT NULL DEFAULT 0' },
  { table: 'pages', column: 'use_ideas', sql: 'ALTER TABLE pages ADD COLUMN use_ideas TINYINT(1) NOT NULL DEFAULT 1' },
  { table: 'pages', column: 'research_json', sql: 'ALTER TABLE pages ADD COLUMN research_json MEDIUMTEXT DEFAULT NULL' },
  { table: 'pages', column: 'researched_at', sql: 'ALTER TABLE pages ADD COLUMN researched_at TIMESTAMP NULL DEFAULT NULL' },
  {
    table: 'post_history',
    enumValue: ['status', 'planned'],
    sql: "ALTER TABLE post_history MODIFY status ENUM('published', 'preview_only', 'failed', 'scheduled', 'planned') DEFAULT 'published'",
  },
  { table: 'post_history', column: 'approved', sql: 'ALTER TABLE post_history ADD COLUMN approved TINYINT(1) NOT NULL DEFAULT 1 AFTER scheduled_at' },
  { table: 'pages', column: 'banner_mode', sql: "ALTER TABLE pages ADD COLUMN banner_mode ENUM('default', 'style', 'custom', 'image') NOT NULL DEFAULT 'default'" },
  { table: 'pages', enumValue: ['banner_mode', 'image'], sql: "ALTER TABLE pages MODIFY banner_mode ENUM('default', 'style', 'custom', 'image') NOT NULL DEFAULT 'default'" },
  { table: 'pages', column: 'background_image_path', sql: 'ALTER TABLE pages ADD COLUMN background_image_path VARCHAR(255) DEFAULT NULL' },
  { table: 'pages', column: 'image_style', sql: 'ALTER TABLE pages ADD COLUMN image_style TEXT DEFAULT NULL' },
  { table: 'pages', column: 'background_images', sql: 'ALTER TABLE pages ADD COLUMN background_images TEXT DEFAULT NULL' },
  { table: 'pages', column: 'bg_index', sql: 'ALTER TABLE pages ADD COLUMN bg_index INT NOT NULL DEFAULT 0' },
  { table: 'pages', column: 'background_source', sql: "ALTER TABLE pages ADD COLUMN background_source ENUM('brand', 'photos', 'mix') NOT NULL DEFAULT 'brand'" },
  { table: 'post_history', column: 'banner_type', sql: 'ALTER TABLE post_history ADD COLUMN banner_type VARCHAR(20) DEFAULT NULL' },
  { table: 'post_history', column: 'banner_points', sql: 'ALTER TABLE post_history ADD COLUMN banner_points TEXT DEFAULT NULL' },
  { table: 'post_history', column: 'banner_bg', sql: 'ALTER TABLE post_history ADD COLUMN banner_bg VARCHAR(500) DEFAULT NULL' },
  { table: 'pages', column: 'banner_style', sql: 'ALTER TABLE pages ADD COLUMN banner_style TEXT DEFAULT NULL' },
  { table: 'pages', column: 'custom_template', sql: 'ALTER TABLE pages ADD COLUMN custom_template MEDIUMTEXT DEFAULT NULL' },
  { table: 'pages', column: 'sample_design_path', sql: 'ALTER TABLE pages ADD COLUMN sample_design_path VARCHAR(255) DEFAULT NULL' },
  { table: 'pages', column: 'plan_approval', sql: "ALTER TABLE pages ADD COLUMN plan_approval ENUM('auto', 'manual') NOT NULL DEFAULT 'auto'" },
];

function baseOptions() {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: CHARSET,
    // Store and read every TIMESTAMP as UTC; the dashboard formats it in the configured timezone.
    timezone: 'Z',
    connectTimeout: 15000,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Step 1: connect without a database and create it if missing. Retries while MySQL is still starting. */
async function ensureDatabase() {
  let lastError;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection(baseOptions());
      try {
        await connection.query(
          `CREATE DATABASE IF NOT EXISTS \`${config.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
      } catch (error) {
        // A user limited to one database may not be allowed to run CREATE DATABASE even when it exists.
        if (error.code !== 'ER_DBACCESS_DENIED_ERROR' && error.code !== 'ER_ACCESS_DENIED_ERROR') throw error;
        console.warn(`[db] No permission to create database "${config.db.name}"; assuming it already exists.`);
      }
      return;
    } catch (error) {
      lastError = error;
      const retryable = ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR'];
      if (!retryable.includes(error.code) || attempt === CONNECT_ATTEMPTS) break;
      console.warn(`[db] MySQL not reachable yet (${error.code}). Retry ${attempt}/${CONNECT_ATTEMPTS - 1} in ${CONNECT_RETRY_MS / 1000}s...`);
      await sleep(CONNECT_RETRY_MS);
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  }
  throw new Error(`Could not connect to MySQL at ${config.db.host}:${config.db.port}: ${lastError?.message || lastError}`);
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  return rows.length > 0;
}

async function indexExists(table, index) {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [table, index],
  );
  return rows.length > 0;
}

async function enumHasValue(table, column, value) {
  const [rows] = await pool.query(
    'SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  return rows.length > 0 && rows[0].type.includes(`'${value}'`);
}

async function runMigrations() {
  for (const migration of MIGRATIONS) {
    let exists;
    if (migration.column) exists = await columnExists(migration.table, migration.column);
    else if (migration.index) exists = await indexExists(migration.table, migration.index);
    else exists = await enumHasValue(migration.table, migration.enumValue[0], migration.enumValue[1]);
    if (!exists) {
      await pool.query(migration.sql);
      console.log(`[db] Migrated: ${migration.sql}`);
    }
  }
}

/** Creates the database, the pool, the tables and runs migrations. Safe to call on every start. */
export async function initDatabase() {
  if (pool) return pool;
  await ensureDatabase();

  pool = mysql.createPool({
    ...baseOptions(),
    database: config.db.name,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  // TIMESTAMP columns are converted to the session time zone, so pin every session to UTC.
  pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });

  for (const statement of TABLES) {
    await pool.query(statement);
  }
  await runMigrations();
  console.log(`[db] Connected to MySQL ${config.db.host}:${config.db.port}/${config.db.name} (utf8mb4)`);
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('Database is not initialised. Call initDatabase() first.');
  return pool;
}

export async function pingDatabase() {
  if (!pool) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
