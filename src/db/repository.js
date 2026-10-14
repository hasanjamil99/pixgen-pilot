import { getPool } from './mysql.js';
import { config } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../services/cryptoService.js';

const MAX_ERROR_LENGTH = 5000;

function clip(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Runs fn(connection) inside a transaction. */
async function transaction(fn) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

const USER_COLUMNS = 'id, email, name, password_hash, role, status, last_login_at, created_at, updated_at';

export function publicUser(user) {
  if (!user) return null;
  const { password_hash: _hash, ...rest } = user;
  return rest;
}

export async function getUserById(id) {
  const [rows] = await getPool().query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

export async function getUserByEmail(email) {
  const [rows] = await getPool().query(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`, [String(email).trim().toLowerCase()]);
  return rows[0] || null;
}

export async function countUsers() {
  const [[row]] = await getPool().query('SELECT COUNT(*) AS total FROM users');
  return Number(row.total);
}

export async function createUser({ email, name, passwordHash, role = 'user' }) {
  const [result] = await getPool().query(
    'INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)',
    [String(email).trim().toLowerCase(), clip(name || '', 100), passwordHash, role],
  );
  await getPool().query('INSERT IGNORE INTO user_settings (user_id, gemini_model) VALUES (?, ?)', [
    result.insertId,
    config.defaultSettings.gemini_model,
  ]);
  return getUserById(result.insertId);
}

export async function updateUser(id, fields) {
  const allowed = ['name', 'role', 'status', 'password_hash', 'email'];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key) && fields[key] !== undefined);
  if (keys.length === 0) return getUserById(id);
  await getPool().query(
    `UPDATE users SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((key) => (key === 'email' ? String(fields[key]).trim().toLowerCase() : fields[key])), id],
  );
  return getUserById(id);
}

export async function touchLogin(id) {
  await getPool().query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

/* ------------------------------------------------------------------ */
/* User settings (Gemini + Facebook app)                               */
/* ------------------------------------------------------------------ */

const SECRET_USER_FIELDS = ['gemini_api_key', 'fb_app_secret', 'fb_user_token'];

/** Decrypted integration settings for a user. */
export async function getUserSettings(userId) {
  const [rows] = await getPool().query('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  const row = rows[0] || { user_id: userId, gemini_model: config.defaultSettings.gemini_model };
  const out = { ...row };
  for (const field of SECRET_USER_FIELDS) out[field] = decryptSecret(row[field]);
  out.gemini_model = row.gemini_model || config.defaultSettings.gemini_model;
  return out;
}

/** Updates integration settings. Secret fields are encrypted; null clears a field. */
export async function updateUserSettings(userId, fields) {
  const allowed = ['gemini_api_key', 'gemini_model', 'fb_app_id', 'fb_app_secret', 'fb_user_token', 'fb_user_token_expires_at'];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key) && fields[key] !== undefined);
  await getPool().query('INSERT IGNORE INTO user_settings (user_id, gemini_model) VALUES (?, ?)', [userId, config.defaultSettings.gemini_model]);
  if (keys.length === 0) return getUserSettings(userId);
  const values = keys.map((key) => (SECRET_USER_FIELDS.includes(key) ? encryptSecret(fields[key]) : fields[key]));
  await getPool().query(`UPDATE user_settings SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE user_id = ?`, [...values, userId]);
  return getUserSettings(userId);
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export const PAGE_SETTING_FIELDS = Object.freeze([
  'name',
  'page_niche',
  'brand_name',
  'brand_handle',
  'brand_logo_url',
  'primary_color',
  'accent_color',
  'cron_schedule',
  'autopilot_enabled',
  'competitors',
  'auto_research',
  'use_ideas',
  'plan_approval',
]);

const PAGE_COLUMNS = `id, user_id, name, fb_page_id, fb_page_name, fb_page_token, fb_connected_at, page_niche, brand_name,
  brand_handle, brand_logo_url, primary_color, accent_color, cron_schedule, autopilot_enabled, competitors, auto_research,
  use_ideas, plan_approval, banner_mode, banner_style, custom_template, sample_design_path, background_image_path, image_style, background_images, bg_index, background_source, research_json, researched_at, created_at, updated_at`;

function hydratePage(row) {
  if (!row) return null;
  let research = null;
  try {
    research = row.research_json ? JSON.parse(row.research_json) : null;
  } catch {
    research = null;
  }
  let bannerStyle = null;
  try {
    bannerStyle = row.banner_style ? JSON.parse(row.banner_style) : null;
  } catch {
    bannerStyle = null;
  }
  let imageStyle = null;
  try {
    imageStyle = row.image_style ? JSON.parse(row.image_style) : null;
  } catch {
    imageStyle = null;
  }
  let backgrounds = [];
  try {
    backgrounds = row.background_images ? JSON.parse(row.background_images) : [];
  } catch {
    backgrounds = [];
  }
  const { research_json: _raw, banner_style: _style, image_style: _image, background_images: _bgs, ...rest } = row;
  return {
    ...rest,
    background_images: Array.isArray(backgrounds) ? backgrounds : [],
    research,
    banner_style: bannerStyle,
    image_style: imageStyle,
    autopilot_enabled: Boolean(Number(row.autopilot_enabled)),
    auto_research: Boolean(Number(row.auto_research)),
    use_ideas: Boolean(Number(row.use_ideas)),
    fb_page_token: decryptSecret(row.fb_page_token),
  };
}

/** Page without its token (and without the large custom template), safe to send to the browser. */
export function publicPage(page) {
  if (!page) return null;
  const { fb_page_token: token, custom_template: template, ...rest } = page;
  return { ...rest, has_custom_template: Boolean(template), fb_connected: Boolean(page.fb_page_id && token) };
}

/** Saves the banner design: mode, style JSON, custom template and the uploaded sample. */
export async function saveBannerDesign(id, { mode, style, template, samplePath, backgroundPath, imageStyle, backgrounds, backgroundSource }) {
  const fields = [];
  const values = [];
  if (backgrounds !== undefined) { fields.push('background_images = ?'); values.push(JSON.stringify(backgrounds)); }
  if (backgroundSource !== undefined) { fields.push('background_source = ?'); values.push(backgroundSource); }
  if (backgroundPath !== undefined) { fields.push('background_image_path = ?'); values.push(backgroundPath); }
  if (imageStyle !== undefined) { fields.push('image_style = ?'); values.push(imageStyle ? JSON.stringify(imageStyle) : null); }
  if (mode !== undefined) { fields.push('banner_mode = ?'); values.push(mode); }
  if (style !== undefined) { fields.push('banner_style = ?'); values.push(style ? JSON.stringify(style) : null); }
  if (template !== undefined) { fields.push('custom_template = ?'); values.push(template); }
  if (samplePath !== undefined) { fields.push('sample_design_path = ?'); values.push(samplePath); }
  if (fields.length) await getPool().query(`UPDATE pages SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
  return getPage(id);
}

export async function getPage(id) {
  const [rows] = await getPool().query(`SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ?`, [id]);
  return hydratePage(rows[0]);
}

export async function getPageForUser(userId, pageId) {
  const [rows] = await getPool().query(`SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ? AND user_id = ?`, [pageId, userId]);
  return hydratePage(rows[0]);
}

export async function listPages(userId) {
  const [rows] = await getPool().query(`SELECT ${PAGE_COLUMNS} FROM pages WHERE user_id = ? ORDER BY id ASC`, [userId]);
  return rows.map(hydratePage);
}

/** Pages whose daily job should run: autopilot on and the owner's account active. */
export async function listSchedulablePages() {
  const [rows] = await getPool().query(
    `SELECT ${PAGE_COLUMNS.split(',').map((column) => `p.${column.trim()}`).join(', ')}
       FROM pages p JOIN users u ON u.id = p.user_id
      WHERE p.autopilot_enabled = 1 AND u.status = 'active'`,
  );
  return rows.map(hydratePage);
}

export async function findPageByFacebookId(userId, fbPageId) {
  const [rows] = await getPool().query(`SELECT ${PAGE_COLUMNS} FROM pages WHERE user_id = ? AND fb_page_id = ? LIMIT 1`, [userId, String(fbPageId)]);
  return hydratePage(rows[0]);
}

export async function countPages(userId) {
  const [[row]] = await getPool().query('SELECT COUNT(*) AS total FROM pages WHERE user_id = ?', [userId]);
  return Number(row.total);
}

export async function createPage(userId, values) {
  const d = config.defaultSettings;
  const page = {
    name: values.name || values.brand_name || 'My Page',
    page_niche: values.page_niche ?? d.page_niche,
    brand_name: values.brand_name ?? values.name ?? d.brand_name,
    brand_handle: values.brand_handle ?? '',
    brand_logo_url: values.brand_logo_url ?? '',
    primary_color: values.primary_color ?? d.primary_color,
    accent_color: values.accent_color ?? d.accent_color,
    cron_schedule: values.cron_schedule ?? d.cron_schedule,
    autopilot_enabled: values.autopilot_enabled === undefined ? 1 : values.autopilot_enabled ? 1 : 0,
  };
  const [result] = await getPool().query(
    `INSERT INTO pages (user_id, name, page_niche, brand_name, brand_handle, brand_logo_url, primary_color, accent_color, cron_schedule, autopilot_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, clip(page.name, 150), page.page_niche, clip(page.brand_name, 100), clip(page.brand_handle, 100), page.brand_logo_url,
      page.primary_color, page.accent_color, page.cron_schedule, page.autopilot_enabled],
  );
  return getPage(result.insertId);
}

export async function updatePage(id, fields) {
  const keys = Object.keys(fields).filter((key) => PAGE_SETTING_FIELDS.includes(key) && fields[key] !== undefined);
  if (keys.length === 0) return getPage(id);
  const flags = ['autopilot_enabled', 'auto_research', 'use_ideas'];
  const values = keys.map((key) => (flags.includes(key) ? (fields[key] ? 1 : 0) : fields[key]));
  await getPool().query(`UPDATE pages SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [...values, id]);
  return getPage(id);
}

export async function saveResearch(id, research) {
  await getPool().query('UPDATE pages SET research_json = ?, researched_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(research), id]);
  return getPage(id);
}

/** Returns the next rotation index for a page's backgrounds (and advances it). */
export async function nextBackgroundIndex(pageId) {
  return transaction(async (connection) => {
    const [[row]] = await connection.query('SELECT bg_index FROM pages WHERE id = ? FOR UPDATE', [pageId]);
    const index = row ? Number(row.bg_index) : 0;
    await connection.query('UPDATE pages SET bg_index = bg_index + 1 WHERE id = ?', [pageId]);
    return index;
  });
}

/** Pages with weekly auto research on, owned by active users. */
export async function listAutoResearchPages() {
  const [rows] = await getPool().query(
    `SELECT p.id, p.researched_at FROM pages p JOIN users u ON u.id = p.user_id WHERE p.auto_research = 1 AND u.status = 'active'`,
  );
  return rows;
}

/** Takes the oldest "new" idea for the autopilot (marks it used). */
export async function claimNextIdea(pageId) {
  const [rows] = await getPool().query("SELECT * FROM post_ideas WHERE page_id = ? AND status = 'new' ORDER BY id ASC LIMIT 1", [pageId]);
  const idea = rows[0];
  if (!idea) return null;
  const [result] = await getPool().query("UPDATE post_ideas SET status = 'used' WHERE id = ? AND status = 'new'", [idea.id]);
  return result.affectedRows ? idea : null;
}

export async function setPageFacebook(id, { fbPageId, fbPageName, token }) {
  await getPool().query(
    'UPDATE pages SET fb_page_id = ?, fb_page_name = ?, fb_page_token = ?, fb_connected_at = CURRENT_TIMESTAMP WHERE id = ?',
    [String(fbPageId), clip(fbPageName, 255), encryptSecret(token), id],
  );
  return getPage(id);
}

export async function clearPageFacebook(id) {
  await getPool().query('UPDATE pages SET fb_page_id = NULL, fb_page_name = NULL, fb_page_token = NULL, fb_connected_at = NULL WHERE id = ?', [id]);
  return getPage(id);
}

/** Deletes a page with its queue and history. Returns banner paths to clean up. */
export async function deletePage(id) {
  return transaction(async (connection) => {
    const [banners] = await connection.query('SELECT banner_image_path FROM post_history WHERE page_id = ? AND banner_image_path IS NOT NULL', [id]);
    await connection.query('DELETE FROM topic_queue WHERE page_id = ?', [id]);
    await connection.query('DELETE FROM post_history WHERE page_id = ?', [id]);
    await connection.query('DELETE FROM post_ideas WHERE page_id = ?', [id]);
    await connection.query('DELETE FROM pages WHERE id = ?', [id]);
    return banners.map((row) => row.banner_image_path);
  });
}

/* ------------------------------------------------------------------ */
/* Topic queue (per page)                                              */
/* ------------------------------------------------------------------ */

/** Adds topics to a page's queue. Each item: { topic, category?, priority? }. Returns the number inserted. */
export async function addTopics(pageId, items) {
  const rows = items
    .map((item) => ({
      topic: String(item.topic || '').trim(),
      category: item.category ? String(item.category).trim() : null,
      priority: Number.isFinite(Number(item.priority)) ? Math.trunc(Number(item.priority)) : 0,
    }))
    .filter((item) => item.topic !== '');
  if (rows.length === 0) return 0;

  const placeholders = rows.map(() => '(?, ?, ?, ?)').join(', ');
  const values = rows.flatMap((row) => [pageId, clip(row.topic, 500), clip(row.category, 150) || null, row.priority]);
  const [result] = await getPool().query(`INSERT INTO topic_queue (page_id, topic, category, priority) VALUES ${placeholders}`, values);
  return result.affectedRows;
}

export async function listQueue(pageId, { status } = {}) {
  const params = [pageId];
  let where = 'WHERE page_id = ?';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  const [rows] = await getPool().query(
    `SELECT id, page_id, topic, category, priority, status, error_message, created_at, updated_at
       FROM topic_queue ${where}
      ORDER BY FIELD(status, 'processing', 'pending', 'failed', 'completed'), priority DESC, id ASC
      LIMIT 1000`,
    params,
  );
  return rows;
}

export async function getPendingTopics(pageId, limit = 50) {
  const [rows] = await getPool().query("SELECT topic FROM topic_queue WHERE page_id = ? AND status IN ('pending', 'processing') ORDER BY id DESC LIMIT ?", [pageId, limit]);
  return rows.map((row) => row.topic);
}

export async function getQueueCounts(pageId) {
  const [rows] = await getPool().query('SELECT status, COUNT(*) AS total FROM topic_queue WHERE page_id = ? GROUP BY status', [pageId]);
  const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
}

/** Returns the next pending topic without claiming it (used for previews). */
export async function peekNextTopic(pageId) {
  const [rows] = await getPool().query(
    `SELECT id, topic, category, priority FROM topic_queue
      WHERE page_id = ? AND status = 'pending' ORDER BY priority DESC, id ASC LIMIT 1`,
    [pageId],
  );
  return rows[0] || null;
}

/** Atomically takes the next pending topic and marks it as processing. Returns null when the queue is empty. */
export async function claimNextTopic(pageId) {
  return transaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT id, topic, category, priority FROM topic_queue
        WHERE page_id = ? AND status = 'pending' ORDER BY priority DESC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [pageId],
    );
    const item = rows[0] || null;
    if (item) {
      await connection.query("UPDATE topic_queue SET status = 'processing', error_message = NULL WHERE id = ?", [item.id]);
    }
    return item;
  });
}

export async function markTopicCompleted(id) {
  await getPool().query("UPDATE topic_queue SET status = 'completed', error_message = NULL WHERE id = ?", [id]);
}

export async function markTopicFailed(id, errorMessage) {
  await getPool().query("UPDATE topic_queue SET status = 'failed', error_message = ? WHERE id = ?", [clip(errorMessage, MAX_ERROR_LENGTH), id]);
}

/** Puts a failed topic back in the queue. */
export async function requeueTopic(pageId, id) {
  const [result] = await getPool().query(
    "UPDATE topic_queue SET status = 'pending', error_message = NULL WHERE id = ? AND page_id = ? AND status = 'failed'",
    [id, pageId],
  );
  return result.affectedRows > 0;
}

/** Deletes a topic that has not been posted yet (pending or failed). */
export async function deleteTopic(pageId, id) {
  const [result] = await getPool().query(
    "DELETE FROM topic_queue WHERE id = ? AND page_id = ? AND status IN ('pending', 'failed')",
    [id, pageId],
  );
  return result.affectedRows > 0;
}

export async function clearCompletedTopics(pageId) {
  const [result] = await getPool().query("DELETE FROM topic_queue WHERE page_id = ? AND status = 'completed'", [pageId]);
  return result.affectedRows;
}

/** After a crash or restart, topics stuck in "processing" go back to "pending". */
export async function resetStuckTopics() {
  const [result] = await getPool().query("UPDATE topic_queue SET status = 'pending' WHERE status = 'processing'");
  return result.affectedRows;
}

/* ------------------------------------------------------------------ */
/* Post history (per page)                                             */
/* ------------------------------------------------------------------ */

const HISTORY_COLUMNS = `id, page_id, topic, banner_badge, banner_headline, banner_subheadline, post_caption,
  banner_image_path, fb_post_id, status, error_message, queue_id, scheduled_at, approved, banner_type, banner_points,
  banner_bg, created_at`;

export async function insertHistory(entry) {
  const [result] = await getPool().query(
    `INSERT INTO post_history
      (page_id, topic, banner_badge, banner_headline, banner_subheadline, post_caption, banner_image_path,
       fb_post_id, status, error_message, queue_id, scheduled_at, approved, banner_type, banner_points, banner_bg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.page_id,
      clip(entry.topic || '(unknown topic)', 500),
      clip(entry.banner_badge, 150),
      clip(entry.banner_headline, 500),
      clip(entry.banner_subheadline, 500),
      entry.post_caption || '',
      clip(entry.banner_image_path, 255),
      clip(entry.fb_post_id, 150),
      entry.status || 'published',
      clip(entry.error_message, MAX_ERROR_LENGTH),
      entry.queue_id ?? null,
      entry.scheduled_at ?? null,
      entry.approved === undefined ? 1 : entry.approved ? 1 : 0,
      entry.banner_type || null,
      entry.banner_points ? JSON.stringify(entry.banner_points) : null,
      clip(entry.banner_bg, 500),
    ],
  );
  return result.insertId;
}

export async function updateHistory(id, fields) {
  const allowed = ['status', 'fb_post_id', 'error_message', 'scheduled_at', 'approved', 'topic', 'banner_badge', 'banner_headline', 'banner_subheadline', 'post_caption', 'banner_image_path', 'banner_type', 'banner_points', 'banner_bg'];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key) && fields[key] !== undefined);
  if (keys.length === 0) return;
  const values = keys.map((key) => {
    if (key === 'error_message') return clip(fields[key], MAX_ERROR_LENGTH);
    if (key === 'banner_points') return fields[key] ? JSON.stringify(fields[key]) : null;
    return fields[key];
  });
  await getPool().query(`UPDATE post_history SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [...values, id]);
}

function hydrateHistory(row) {
  if (!row) return row;
  let points = [];
  try {
    points = row.banner_points ? JSON.parse(row.banner_points) : [];
  } catch {
    points = [];
  }
  return { ...row, banner_points: Array.isArray(points) ? points : [] };
}

export async function getHistoryById(pageId, id) {
  const [rows] = await getPool().query(`SELECT ${HISTORY_COLUMNS} FROM post_history WHERE id = ? AND page_id = ?`, [id, pageId]);
  return hydrateHistory(rows[0]) || null;
}

export async function listHistory(pageId, { limit = 20, offset = 0, status } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 20, 1), 100);
  const safeOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const params = [pageId];
  let where = 'WHERE page_id = ?';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  const [rows] = await getPool().query(
    `SELECT ${HISTORY_COLUMNS} FROM post_history ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );
  const [[{ total }]] = await getPool().query(`SELECT COUNT(*) AS total FROM post_history ${where}`, params);
  return { rows: rows.map(hydrateHistory), total: Number(total), limit: safeLimit, offset: safeOffset };
}

export async function getHistoryCounts(pageId) {
  const [rows] = await getPool().query('SELECT status, COUNT(*) AS total FROM post_history WHERE page_id = ? GROUP BY status', [pageId]);
  const counts = { published: 0, preview_only: 0, failed: 0, scheduled: 0, planned: 0 };
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
}

export async function deleteHistory(pageId, id) {
  const [result] = await getPool().query("DELETE FROM post_history WHERE id = ? AND page_id = ? AND status <> 'published'", [id, pageId]);
  return result.affectedRows > 0;
}

/** Scheduled posts of a page, soonest first. */
export async function listScheduled(pageId) {
  const [rows] = await getPool().query(
    `SELECT ${HISTORY_COLUMNS} FROM post_history WHERE page_id = ? AND status IN ('scheduled', 'planned') ORDER BY scheduled_at ASC, id ASC LIMIT 500`,
    [pageId],
  );
  return rows.map(hydrateHistory);
}

/** Scheduled or planned posts whose time has come, for active owners only. */
export async function listDueScheduled(limit = 20) {
  const [rows] = await getPool().query(
    `SELECT h.id, h.page_id, h.status, h.approved FROM post_history h
       JOIN pages p ON p.id = h.page_id JOIN users u ON u.id = p.user_id
      WHERE h.status IN ('scheduled', 'planned') AND h.scheduled_at <= UTC_TIMESTAMP() AND u.status = 'active'
      ORDER BY h.scheduled_at ASC LIMIT ?`,
    [limit],
  );
  return rows;
}

/** Planned posts (topic only) due within `hours`, oldest first: they get written the day before. */
export async function listPlannedToWrite(hours = 24, limit = 5) {
  const [rows] = await getPool().query(
    `SELECT h.id, h.page_id FROM post_history h
       JOIN pages p ON p.id = h.page_id JOIN users u ON u.id = p.user_id
      WHERE h.status = 'planned' AND h.scheduled_at <= UTC_TIMESTAMP() + INTERVAL ? HOUR AND u.status = 'active'
      ORDER BY h.scheduled_at ASC LIMIT ?`,
    [hours, limit],
  );
  return rows;
}

export async function approveAllScheduled(pageId) {
  const [result] = await getPool().query("UPDATE post_history SET approved = 1 WHERE page_id = ? AND status IN ('scheduled', 'planned') AND approved = 0", [pageId]);
  return result.affectedRows;
}

/** True when the page already has a planned or planned-and-published post in [from, to). */
export async function hasPlannedPostBetween(pageId, from, to) {
  const [rows] = await getPool().query(
    "SELECT 1 FROM post_history WHERE page_id = ? AND status IN ('scheduled', 'planned', 'published') AND scheduled_at >= ? AND scheduled_at < ? LIMIT 1",
    [pageId, from, to],
  );
  return rows.length > 0;
}

/** Topics already planned for a page (so a new plan does not repeat them). */
export async function getScheduledTopics(pageId, limit = 100) {
  const [rows] = await getPool().query("SELECT topic FROM post_history WHERE page_id = ? AND status IN ('scheduled', 'planned') ORDER BY scheduled_at DESC LIMIT ?", [pageId, limit]);
  return rows.map((row) => row.topic);
}

/** Topics of the most recent published posts of a page, newest first. Used so Gemini avoids repeating itself. */
export async function getRecentPublishedTopics(pageId, limit = 30) {
  const [rows] = await getPool().query(
    "SELECT topic FROM post_history WHERE page_id = ? AND status = 'published' ORDER BY id DESC LIMIT ?",
    [pageId, limit],
  );
  return rows.map((row) => row.topic);
}

/* ------------------------------------------------------------------ */
/* Post ideas (per page)                                               */
/* ------------------------------------------------------------------ */

export async function insertIdeas(pageId, ideas) {
  const rows = ideas.filter((idea) => idea.topic);
  if (rows.length === 0) return [];
  const [result] = await getPool().query(
    `INSERT INTO post_ideas (page_id, topic, angle, category) VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`,
    rows.flatMap((idea) => [pageId, clip(idea.topic, 500), clip(idea.angle, 2000), clip(idea.category, 150)]),
  );
  const firstId = result.insertId;
  const [inserted] = await getPool().query(
    'SELECT * FROM post_ideas WHERE page_id = ? AND id >= ? AND id < ? ORDER BY id ASC',
    [pageId, firstId, firstId + rows.length],
  );
  return inserted;
}

export async function listIdeas(pageId, { status } = {}) {
  const params = [pageId];
  let where = 'WHERE page_id = ?';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  const [rows] = await getPool().query(`SELECT * FROM post_ideas ${where} ORDER BY id DESC LIMIT 300`, params);
  return rows;
}

export async function getIdea(pageId, id) {
  const [rows] = await getPool().query('SELECT * FROM post_ideas WHERE id = ? AND page_id = ?', [id, pageId]);
  return rows[0] || null;
}

export async function setIdeaStatus(pageId, id, status) {
  const [result] = await getPool().query('UPDATE post_ideas SET status = ? WHERE id = ? AND page_id = ?', [status, id, pageId]);
  return result.affectedRows > 0;
}

export async function getIdeaCounts(pageId) {
  const [rows] = await getPool().query('SELECT status, COUNT(*) AS total FROM post_ideas WHERE page_id = ? GROUP BY status', [pageId]);
  const counts = { new: 0, queued: 0, used: 0, dismissed: 0 };
  for (const row of rows) counts[row.status] = Number(row.total);
  return counts;
}

/** Recent idea topics (any status) so Gemini does not suggest the same thing twice. */
export async function getRecentIdeaTopics(pageId, limit = 60) {
  const [rows] = await getPool().query('SELECT topic FROM post_ideas WHERE page_id = ? ORDER BY id DESC LIMIT ?', [pageId, limit]);
  return rows.map((row) => row.topic);
}

export async function clearDismissedIdeas(pageId) {
  const [result] = await getPool().query("DELETE FROM post_ideas WHERE page_id = ? AND status = 'dismissed'", [pageId]);
  return result.affectedRows;
}

/* ------------------------------------------------------------------ */
/* Platform settings (super admin)                                     */
/* ------------------------------------------------------------------ */

const SECRET_PLATFORM_KEYS = ['fb_app_secret', 'pexels_api_key'];

/** Platform-wide settings live in app_settings under a "platform." prefix; secrets are encrypted. */
export async function getPlatformSettings() {
  const [rows] = await getPool().query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'platform.%'");
  const out = {};
  for (const row of rows) {
    const key = row.setting_key.slice('platform.'.length);
    out[key] = SECRET_PLATFORM_KEYS.includes(key) ? decryptSecret(row.setting_value) : row.setting_value;
  }
  return out;
}

/** Saves platform settings; null or '' removes a key. */
export async function setPlatformSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value === null || value === '') {
      await getPool().query('DELETE FROM app_settings WHERE setting_key = ?', [`platform.${key}`]);
    } else {
      const stored = SECRET_PLATFORM_KEYS.includes(key) ? encryptSecret(value) : String(value);
      await getPool().query(
        'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
        [`platform.${key}`, stored],
      );
    }
  }
  return getPlatformSettings();
}

/* ------------------------------------------------------------------ */
/* Legacy v1 data                                                      */
/* ------------------------------------------------------------------ */

export async function getLegacySettings() {
  const [rows] = await getPool().query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key NOT LIKE 'platform.%'");
  return Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
}

export async function setLegacySetting(key, value) {
  await getPool().query(
    'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
    [key, String(value)],
  );
}

/** Gives queue/history rows from v1 (no page) to a page. */
export async function adoptOrphanRows(pageId) {
  const [queue] = await getPool().query('UPDATE topic_queue SET page_id = ? WHERE page_id IS NULL', [pageId]);
  const [history] = await getPool().query('UPDATE post_history SET page_id = ? WHERE page_id IS NULL', [pageId]);
  return queue.affectedRows + history.affectedRows;
}
