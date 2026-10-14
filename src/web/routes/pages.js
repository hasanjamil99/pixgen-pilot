import express from 'express';
import * as repo from '../../db/repository.js';
import { deleteBannerFile, deleteUpload, normalizeImageStyle, normalizeStyle, renderBanner, resolveUploadPath, saveUpload } from '../../services/bannerService.js';
import fs from 'node:fs/promises';
import { buildSlots, cancelPlanJob, getPlanJob, startPlanJob, startWriteJob } from '../../services/plannerService.js';
import { getResearchJob, startResearchJob } from '../../services/researchService.js';
import { zonedDate, zonedToUtc } from '../../services/timeService.js';
import { getPexelsKey, searchPhoto } from '../../services/photoService.js';
import { checkPageConnection, facebookPostUrl, inspectToken, listManagedPages } from '../../services/facebookService.js';
import { analyzeDesignStyle, cleanBackgroundFromSample, generatePostIdeas, recreateDesignTemplate } from '../../services/geminiService.js';
import { config } from '../../config/env.js';
import {
  generateForPage,
  getPageSchedule,
  historyFields,
  parseBackground,
  loadContext,
  publishHistoryEntry,
  writePlannedPost,
  refreshPageSchedule,
  runPipeline,
  unschedulePage,
} from '../../services/schedulerService.js';
import { asyncRoute, cleanPageSettings, decodeImageUpload, httpError, parseId } from '../validation.js';
import { saveUserToken } from './integrations.js';

const MAX_PAGES_PER_USER = 50;

function withPostUrl(row) {
  return row ? { ...row, fb_post_url: facebookPostUrl(row.fb_post_id) } : row;
}

async function pageSummary(page) {
  const [queue, history, ideas] = await Promise.all([repo.getQueueCounts(page.id), repo.getHistoryCounts(page.id), repo.getIdeaCounts(page.id)]);
  return { ...repo.publicPage(page), queue, history, ideas, schedule: getPageSchedule(page.id) };
}

const DEFAULT_PAGE_NAMES = new Set([config.defaultSettings.brand_name, 'My Page', 'My Page Name']);

/** Saves a Facebook connection; a page still using the default name takes the Facebook Page's name. */
async function saveConnection(page, { fbPageId, fbPageName, token }) {
  const saved = await repo.setPageFacebook(page.id, { fbPageId, fbPageName, token });
  if (fbPageName && DEFAULT_PAGE_NAMES.has(page.name)) {
    const rename = { name: fbPageName.slice(0, 150) };
    if (DEFAULT_PAGE_NAMES.has(page.brand_name)) rename.brand_name = fbPageName.slice(0, 100);
    return repo.updatePage(page.id, rename);
  }
  return saved;
}

/** Stores the connection for one of the pages a user token manages. */
async function connectFromUserToken(page, userToken, fbPageId) {
  const pages = await listManagedPages(userToken);
  const chosen = pages.find((item) => item.id === String(fbPageId));
  if (!chosen) throw httpError('That Facebook Page is not in the list of pages your account manages.', 404);
  if (!chosen.accessToken) {
    throw httpError('Facebook did not give a posting token for that page. In Meta Business Suite, give yourself "Content" (full) access to the page in its Business Portfolio, then connect again.', 400);
  }
  return saveConnection(page, { fbPageId: chosen.id, fbPageName: chosen.name, token: chosen.accessToken });
}

export function pagesRouter() {
  const router = express.Router();

  /* ---------------- Pages ---------------- */

  router.get('/', asyncRoute(async (req, res) => {
    const pages = await repo.listPages(req.user.id);
    res.json({ pages: await Promise.all(pages.map(pageSummary)) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    if ((await repo.countPages(req.user.id)) >= MAX_PAGES_PER_USER) throw httpError(`You can have up to ${MAX_PAGES_PER_USER} pages.`);
    const values = cleanPageSettings({ brand_name: req.body?.name, ...req.body }, { partial: true });
    if (!values.name) throw httpError('Give the page a name.');
    const page = await repo.createPage(req.user.id, values);
    await refreshPageSchedule(page.id);
    res.status(201).json({ page: await pageSummary(page) });
  }));

  // Everything below works on one page that must belong to the signed-in user.
  router.param('pageId', (req, res, next, value) => {
    Promise.resolve()
      .then(() => repo.getPageForUser(req.user.id, parseId(value)))
      .then((page) => {
        if (!page) throw httpError('Page not found.', 404);
        req.page = page;
        next();
      })
      .catch(next);
  });

  router.get('/:pageId', asyncRoute(async (req, res) => {
    res.json({ page: await pageSummary(req.page) });
  }));

  router.put('/:pageId', asyncRoute(async (req, res) => {
    const values = cleanPageSettings(req.body || {}, { partial: true });
    const page = await repo.updatePage(req.page.id, values);
    await refreshPageSchedule(page.id);
    res.json({ page: await pageSummary(page) });
  }));

  router.delete('/:pageId', asyncRoute(async (req, res) => {
    unschedulePage(req.page.id);
    const banners = await repo.deletePage(req.page.id);
    await Promise.all(banners.map(deleteBannerFile));
    res.json({ ok: true });
  }));

  /* ---------------- Logo upload ---------------- */

  router.post('/:pageId/logo', asyncRoute(async (req, res) => {
    const { buffer, ext } = decodeImageUpload(req.body?.dataUrl, { maxBytes: 3 * 1024 * 1024 });
    const webPath = await saveUpload(buffer, ext, `logo-${req.page.id}`);
    const previous = req.page.brand_logo_url;
    const page = await repo.updatePage(req.page.id, { brand_logo_url: webPath });
    await deleteUpload(previous);
    res.json({ page: await pageSummary(page) });
  }));

  router.delete('/:pageId/logo', asyncRoute(async (req, res) => {
    const page = await repo.updatePage(req.page.id, { brand_logo_url: '' });
    await deleteUpload(req.page.brand_logo_url);
    res.json({ page: await pageSummary(page) });
  }));

  /* ---------------- Banner design ---------------- */

  const SAMPLE_TEXT = {
    badge: 'নমুনা বিষয়',
    headline: 'আপনার পোস্টের শিরোনাম এখানে থাকবে',
    subheadline: 'ছোট একটি সহায়ক বাক্য যা মূল কথাকে আরও পরিষ্কার করে',
  };

  const SAMPLE_BY_TYPE = {
    statement: SAMPLE_TEXT,
    quote: { badge: 'হাদিস', headline: 'তোমাদের মধ্যে সেই উত্তম, যে তার পরিবারের কাছে উত্তম', subheadline: 'সুনান তিরমিজি', points: [] },
    tips: { badge: 'টিপস', headline: 'বিয়ের আগে যে ৪টি বিষয় জানা জরুরি', subheadline: '', points: ['দ্বীনদারি ও চরিত্র', 'পরিবারের মূল্যবোধ', 'পড়াশোনা ও পেশা', 'ভবিষ্যতের পরিকল্পনা'] },
  };

  /** Renders sample text with a page's banner settings (optionally a given background and post type). */
  async function renderPreview(page, background = null, type = 'statement') {
    const sample = SAMPLE_BY_TYPE[type] || SAMPLE_TEXT;
    const banner = await renderBanner({ ...sample, type, settings: page, background, fileName: `preview-page-${page.id}.png` });
    return `${banner.webPath}?t=${Date.now()}`;
  }

  router.post('/:pageId/banner-preview', asyncRoute(async (req, res) => {
    const type = ['statement', 'quote', 'tips'].includes(req.body?.type) ? req.body.type : 'statement';
    let background = null;
    const list = backgroundList(req.page);
    if (req.body?.background === 'photo') {
      const photo = await searchPhoto(req.body?.photoQuery || 'flowers soft light', { seed: Date.now() % 15 });
      if (!photo) throw httpError('No photo found. Check the Pexels key in Admin → Platform settings.');
      background = { kind: 'photo', url: photo.url };
    } else if (Number.isInteger(req.body?.backgroundIndex) && list[req.body.backgroundIndex]) {
      background = { kind: 'brand', ...list[req.body.backgroundIndex] };
    }
    res.json({ preview: await renderPreview(req.page, background, type) });
  }));

  /** Switches between default / style / custom and adjusts the style by hand. */
  router.put('/:pageId/banner-design', asyncRoute(async (req, res) => {
    const mode = req.body?.mode;
    if (!['default', 'style', 'custom', 'image'].includes(mode)) throw httpError('Pick a banner design mode.');
    if (mode === 'custom' && !req.page.custom_template) throw httpError('Upload a sample design to recreate first.');
    if (mode === 'image' && !req.page.background_image_path) throw httpError('Upload a background image first.');
    const style = req.body?.style ? normalizeStyle({ ...(req.page.banner_style || {}), ...req.body.style }) : undefined;
    if (mode === 'style' && !style && !req.page.banner_style) throw httpError('Upload a sample design first.');
    const imageStyle = req.body?.imageStyle
      ? normalizeImageStyle({ ...(req.page.image_style || {}), ...req.body.imageStyle }, req.page.banner_style || {})
      : undefined;
    const backgroundSource = ['brand', 'photos', 'mix'].includes(req.body?.backgroundSource) ? req.body.backgroundSource : undefined;
    if (backgroundSource && backgroundSource !== 'brand' && !(await getPexelsKey())) {
      throw httpError('Stock photos need a Pexels API key: Admin → Platform settings.');
    }
    const page = await repo.saveBannerDesign(req.page.id, { mode, style, imageStyle, backgroundSource });
    res.json({ page: await pageSummary(page), preview: await renderPreview(page) });
  }));

  /**
   * Upload a sample banner. mode "style": Gemini reads colours + layout and the built-in template follows them.
   * mode "custom": Gemini recreates the design as a template (checked by rendering it).
   */
  router.post('/:pageId/sample-design', asyncRoute(async (req, res) => {
    const mode = req.body?.mode === 'custom' ? 'custom' : 'style';
    const settings = await repo.getUserSettings(req.user.id);
    if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');
    const image = decodeImageUpload(req.body?.dataUrl, { maxBytes: 5 * 1024 * 1024 });
    const samplePath = await saveUpload(image.buffer, image.ext, `sample-${req.page.id}`);
    const previousSample = req.page.sample_design_path;

    let page;
    if (mode === 'style') {
      const style = normalizeStyle(await analyzeDesignStyle({ apiKey: settings.gemini_api_key, model: settings.gemini_model, image }));
      page = await repo.saveBannerDesign(req.page.id, { mode: 'style', style, samplePath });
    } else {
      let template = null;
      let feedback = '';
      for (let attempt = 1; attempt <= 2 && !template; attempt += 1) {
        const candidate = await recreateDesignTemplate({ apiKey: settings.gemini_api_key, model: settings.gemini_model, image, feedback });
        try {
          // Prove it renders before saving it.
          await renderPreview({ ...req.page, banner_mode: 'custom', custom_template: candidate });
          template = candidate;
        } catch (error) {
          feedback = error.message.slice(0, 300);
        }
      }
      if (!template) throw httpError(`The recreated design could not be rendered. Try again or use "Match colours + layout". (${feedback})`);
      page = await repo.saveBannerDesign(req.page.id, { mode: 'custom', template, samplePath });
    }
    if (previousSample && previousSample !== samplePath) await deleteUpload(previousSample);
    res.json({ page: await pageSummary(page), preview: await renderPreview(page) });
  }));

  /** The page's rotating brand backgrounds (older pages have just one in background_image_path). */
  function backgroundList(page) {
    if (page.background_images?.length) return [...page.background_images];
    if (!page.background_image_path) return [];
    const st = page.image_style || {};
    return [{ path: page.background_image_path, fit: st.fit || 'cover', erase: Boolean(st.erase) }];
  }

  async function addBackground(page, item) {
    const list = backgroundList(page).filter((existing) => existing.path !== item.path);
    if (list.length >= 12) throw httpError('You can keep up to 12 backgrounds. Remove one first.');
    list.push(item);
    return list;
  }

  /** Default text styling for a new background: colours from the analysed sample, website as footer. */
  function initialImageStyle(page) {
    return normalizeImageStyle(page.image_style || { footer_text: page.brand_handle || '' }, page.banner_style || {});
  }

  /** "My background image": upload the brand's own background (ideally without text). */
  router.post('/:pageId/background', asyncRoute(async (req, res) => {
    const image = decodeImageUpload(req.body?.dataUrl, { maxBytes: 7 * 1024 * 1024 });
    const backgroundPath = await saveUpload(image.buffer, image.ext, `bg-${req.page.id}`);
    const previous = req.page.background_image_path;
    const page = await repo.saveBannerDesign(req.page.id, { mode: 'image', backgroundPath, imageStyle: initialImageStyle(req.page) });
    if (previous && previous !== backgroundPath) await deleteUpload(previous);
    res.json({ page: await pageSummary(page), preview: await renderPreview(page) });
  }));

  /**
   * Free alternative to AI cleaning: the sample itself becomes the background (stretched to square)
   * and soft panels in the background colour cover its old text where the new text goes.
   */
  router.post('/:pageId/background/use-sample', asyncRoute(async (req, res) => {
    if (!resolveUploadPath(req.page.sample_design_path)) throw httpError('Upload a sample design first.');
    const eraseColor = typeof req.body?.eraseColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.eraseColor) ? req.body.eraseColor : '#ffffff';
    const imageStyle = normalizeImageStyle({ ...initialImageStyle(req.page), erase_color: eraseColor }, req.page.banner_style || {});
    const item = { path: req.page.sample_design_path, fit: 'stretch', erase: true };
    const backgrounds = await addBackground(req.page, item);
    const page = await repo.saveBannerDesign(req.page.id, { mode: 'image', backgroundPath: req.page.background_image_path || item.path, imageStyle, backgrounds });
    res.json({ page: await pageSummary(page), preview: await renderPreview(page, { kind: 'brand', ...item }) });
  }));

  router.delete('/:pageId/backgrounds/:index', asyncRoute(async (req, res) => {
    const list = backgroundList(req.page);
    const index = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw httpError('Background not found.', 404);
    const [removed] = list.splice(index, 1);
    const fields = { backgrounds: list, backgroundPath: list[0]?.path || null };
    if (list.length === 0) fields.mode = 'default';
    const page = await repo.saveBannerDesign(req.page.id, fields);
    if (removed.path !== req.page.sample_design_path) await deleteUpload(removed.path);
    res.json({ page: await pageSummary(page), preview: await renderPreview(page) });
  }));

  /** Makes a clean background (text and logos removed) from the uploaded sample with a Gemini image model. */
  router.post('/:pageId/background/from-sample', asyncRoute(async (req, res) => {
    const settings = await repo.getUserSettings(req.user.id);
    if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');
    let image;
    if (req.body?.dataUrl) {
      image = decodeImageUpload(req.body.dataUrl, { maxBytes: 7 * 1024 * 1024 });
    } else {
      const filePath = resolveUploadPath(req.page.sample_design_path);
      if (!filePath) throw httpError('Upload a sample design first.');
      const buffer = await fs.readFile(filePath);
      const ext = filePath.split('.').pop().toLowerCase();
      image = { buffer, mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
    }
    const cleaned = await cleanBackgroundFromSample({ apiKey: settings.gemini_api_key, image });
    const ext = cleaned.mime.includes('jpeg') ? 'jpg' : cleaned.mime.includes('webp') ? 'webp' : 'png';
    const backgroundPath = await saveUpload(cleaned.buffer, ext, `bg-${req.page.id}`);
    const item = { path: backgroundPath, fit: 'cover', erase: false };
    const backgrounds = await addBackground(req.page, item);
    const page = await repo.saveBannerDesign(req.page.id, { mode: 'image', backgroundPath: req.page.background_image_path || backgroundPath, imageStyle: req.page.image_style ? undefined : initialImageStyle(req.page), backgrounds });
    res.json({ page: await pageSummary(page), preview: await renderPreview(page, { kind: 'brand', ...item }), model: cleaned.model });
  }));

  /** Which topic the autopilot would use next (nothing is claimed). */
  router.get('/:pageId/next-topic', asyncRoute(async (req, res) => {
    const queued = await repo.peekNextTopic(req.page.id);
    if (queued) return res.json({ source: 'queue', topic: queued.topic });
    if (req.page.use_ideas) {
      const idea = (await repo.listIdeas(req.page.id, { status: 'new' })).at(-1);
      if (idea) return res.json({ source: 'idea', topic: idea.topic });
    }
    return res.json({ source: 'autopilot', topic: null });
  }));

  /* ---------------- Queue ---------------- */

  router.get('/:pageId/queue', asyncRoute(async (req, res) => {
    const status = ['pending', 'processing', 'completed', 'failed'].includes(req.query.status) ? req.query.status : undefined;
    res.json({ items: await repo.listQueue(req.page.id, { status }) });
  }));

  router.post('/:pageId/queue', asyncRoute(async (req, res) => {
    const { topics, topic, category, priority } = req.body || {};
    const lines = typeof topics === 'string' ? topics.split(/\r?\n/) : Array.isArray(topics) ? topics.map(String) : [topic];
    const items = lines.map((line) => String(line || '').trim()).filter(Boolean).map((line) => ({ topic: line, category, priority }));
    if (items.length === 0) throw httpError('Add at least one topic.');
    if (items.length > 500) throw httpError('You can add up to 500 topics at a time.');
    if (items.some((item) => item.topic.length > 500)) throw httpError('Each topic must be at most 500 characters.');
    res.status(201).json({ added: await repo.addTopics(req.page.id, items) });
  }));

  router.delete('/:pageId/queue/completed', asyncRoute(async (req, res) => {
    res.json({ deleted: await repo.clearCompletedTopics(req.page.id) });
  }));

  router.delete('/:pageId/queue/:itemId', asyncRoute(async (req, res) => {
    if (!(await repo.deleteTopic(req.page.id, parseId(req.params.itemId)))) throw httpError('Only pending or failed topics can be deleted.', 404);
    res.json({ ok: true });
  }));

  router.post('/:pageId/queue/:itemId/retry', asyncRoute(async (req, res) => {
    if (!(await repo.requeueTopic(req.page.id, parseId(req.params.itemId)))) throw httpError('Only failed topics can be retried.', 404);
    res.json({ ok: true });
  }));

  /* ---------------- Generate / publish ---------------- */

  router.post('/:pageId/preview', asyncRoute(async (req, res) => {
    const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 500) : '';
    const result = await runPipeline({ pageId: req.page.id, publish: false, topic: topic || null, trigger: 'dashboard-preview' });
    if (req.body?.ideaId) await repo.setIdeaStatus(req.page.id, parseId(req.body.ideaId), 'used');
    res.json({ ...result, entry: withPostUrl(await repo.getHistoryById(req.page.id, result.historyId)) });
  }));

  router.post('/:pageId/run-now', asyncRoute(async (req, res) => {
    const result = await runPipeline({ pageId: req.page.id, publish: true, trigger: 'dashboard' });
    res.json({ ...result, entry: withPostUrl(await repo.getHistoryById(req.page.id, result.historyId)) });
  }));

  /* ---------------- History ---------------- */

  router.get('/:pageId/history', asyncRoute(async (req, res) => {
    const status = ['published', 'preview_only', 'failed', 'scheduled'].includes(req.query.status) ? req.query.status : undefined;
    const result = await repo.listHistory(req.page.id, { limit: req.query.limit, offset: req.query.offset, status });
    res.json({ ...result, rows: result.rows.map(withPostUrl) });
  }));

  router.get('/:pageId/history/:entryId', asyncRoute(async (req, res) => {
    const entry = await repo.getHistoryById(req.page.id, parseId(req.params.entryId));
    if (!entry) throw httpError('Post not found.', 404);
    res.json({ entry: withPostUrl(entry) });
  }));

  router.post('/:pageId/history/:entryId/publish', asyncRoute(async (req, res) => {
    const id = parseId(req.params.entryId);
    const result = await publishHistoryEntry(req.page.id, id);
    res.json({ ...result, entry: withPostUrl(await repo.getHistoryById(req.page.id, id)) });
  }));

  router.delete('/:pageId/history/:entryId', asyncRoute(async (req, res) => {
    const id = parseId(req.params.entryId);
    const entry = await repo.getHistoryById(req.page.id, id);
    if (!entry) throw httpError('Post not found.', 404);
    if (entry.status === 'published') throw httpError('Published posts stay in history.');
    await repo.deleteHistory(req.page.id, id);
    await deleteBannerFile(entry.banner_image_path);
    res.json({ ok: true });
  }));

  /* ---------------- Edit, schedule, regenerate ---------------- */

  async function editableEntry(req) {
    const entry = await repo.getHistoryById(req.page.id, parseId(req.params.entryId));
    if (!entry) throw httpError('Post not found.', 404);
    if (entry.status === 'published') throw httpError('Published posts cannot be changed here. Edit them on Facebook.');
    return entry;
  }

  /** Edits caption and banner text. Changed banner text re-renders the banner. */
  router.put('/:pageId/history/:entryId', asyncRoute(async (req, res) => {
    const entry = await editableEntry(req);
    const limits = { post_caption: 5000, banner_badge: 150, banner_headline: 500, banner_subheadline: 500, topic: 500 };
    const fields = {};
    for (const [key, max] of Object.entries(limits)) {
      if (req.body?.[key] === undefined) continue;
      const value = String(req.body[key]).replace(/\r\n?/g, '\n').trim();
      if (!value) throw httpError(`${key.replace(/_/g, ' ')} cannot be empty.`);
      if (value.length > max) throw httpError(`${key.replace(/_/g, ' ')} must be at most ${max} characters.`);
      fields[key] = value;
    }
    if (entry.status === 'planned') {
      // Not written yet: only the topic can change (the post is written the day before).
      if (!fields.topic) throw httpError('This post is not written yet; you can change its topic.');
      await repo.updateHistory(entry.id, { topic: fields.topic });
      return res.json({ entry: withPostUrl(await repo.getHistoryById(req.page.id, entry.id)) });
    }
    if (req.body?.banner_type !== undefined) {
      if (!['statement', 'quote', 'tips'].includes(req.body.banner_type)) throw httpError('Unknown banner type.');
      fields.banner_type = req.body.banner_type;
    }
    if (req.body?.banner_points !== undefined) {
      const points = (Array.isArray(req.body.banner_points) ? req.body.banner_points : String(req.body.banner_points).split(/\r?\n/))
        .map((point) => String(point).trim()).filter(Boolean).slice(0, 4).map((point) => point.slice(0, 120));
      fields.banner_points = points;
    }
    const bannerChanged = ['banner_badge', 'banner_headline', 'banner_subheadline', 'banner_type'].some((key) => fields[key] !== undefined && fields[key] !== entry[key])
      || (fields.banner_points !== undefined && JSON.stringify(fields.banner_points) !== JSON.stringify(entry.banner_points || []));
    if (bannerChanged || !entry.banner_image_path) {
      const banner = await renderBanner({
        badge: fields.banner_badge ?? entry.banner_badge,
        headline: fields.banner_headline ?? entry.banner_headline,
        subheadline: fields.banner_subheadline ?? entry.banner_subheadline,
        type: fields.banner_type ?? entry.banner_type ?? 'statement',
        points: fields.banner_points ?? entry.banner_points ?? [],
        background: parseBackground(entry.banner_bg),
        settings: req.page,
      });
      fields.banner_image_path = banner.webPath;
    }
    await repo.updateHistory(entry.id, { ...fields, error_message: null });
    if (fields.banner_image_path && entry.banner_image_path) await deleteBannerFile(entry.banner_image_path);
    return res.json({ entry: withPostUrl(await repo.getHistoryById(req.page.id, entry.id)) });
  }));

  /** Writes the post again with Gemini for the same topic (keeps the schedule). */
  router.post('/:pageId/history/:entryId/regenerate', asyncRoute(async (req, res) => {
    const entry = await editableEntry(req);
    if (entry.status === 'planned') {
      return res.json({ entry: withPostUrl(await writePlannedPost(req.page.id, entry.id)) });
    }
    const { page, settings } = await loadContext(req.page.id);
    if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');
    const { content, banner, background } = await generateForPage(page, settings, { topic: entry.topic, category: null, queueId: null, source: 'custom' });
    const { page_id: _pageId, ...fields } = historyFields(page, content, banner, background);
    await repo.updateHistory(entry.id, { ...fields, error_message: null });
    if (entry.banner_image_path) await deleteBannerFile(entry.banner_image_path);
    return res.json({ entry: withPostUrl(await repo.getHistoryById(req.page.id, entry.id)) });
  }));

  /** Schedules (or reschedules) a preview / failed / scheduled post. */
  router.post('/:pageId/history/:entryId/schedule', asyncRoute(async (req, res) => {
    const entry = await editableEntry(req);
    if (entry.status !== 'planned' && (!entry.post_caption || !entry.banner_image_path)) throw httpError('This entry has no generated post to schedule.');
    // Either an ISO instant, or a wall-clock date + time in the app timezone (what the dashboard sends).
    const { date, time } = req.body || {};
    const at = date && time && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)
      ? zonedToUtc(date, time, config.timezone)
      : new Date(req.body?.scheduledAt);
    if (Number.isNaN(at.getTime())) throw httpError('Pick a valid date and time.');
    if (at.getTime() < Date.now() + 60 * 1000) throw httpError('Pick a time at least one minute in the future.');
    if (at.getTime() > Date.now() + 180 * 24 * 3600 * 1000) throw httpError('You can schedule up to 6 months ahead.');
    await repo.updateHistory(entry.id, { status: entry.status === 'planned' ? 'planned' : 'scheduled', scheduled_at: at, error_message: null });
    res.json({ entry: withPostUrl(await repo.getHistoryById(req.page.id, entry.id)) });
  }));

  router.post('/:pageId/history/:entryId/approve', asyncRoute(async (req, res) => {
    const entry = await editableEntry(req);
    if (!['scheduled', 'planned'].includes(entry.status)) throw httpError('Only scheduled posts need approval.');
    await repo.updateHistory(entry.id, { approved: 1 });
    res.json({ entry: withPostUrl(await repo.getHistoryById(req.page.id, entry.id)) });
  }));

  router.post('/:pageId/scheduled/approve-all', asyncRoute(async (req, res) => {
    res.json({ approved: await repo.approveAllScheduled(req.page.id) });
  }));

  router.post('/:pageId/history/:entryId/unschedule', asyncRoute(async (req, res) => {
    const entry = await editableEntry(req);
    if (entry.status === 'planned') {
      // Never written: turn it back into an idea instead of an empty preview.
      await repo.insertIdeas(req.page.id, [{ topic: entry.topic, angle: null, category: null }]);
      await repo.deleteHistory(req.page.id, entry.id);
      return res.json({ entry: null, movedToIdeas: true });
    }
    await repo.updateHistory(entry.id, { status: 'preview_only', scheduled_at: null });
    return res.json({ entry: withPostUrl(await repo.getHistoryById(req.page.id, entry.id)) });
  }));

  /* ---------------- Content planner ---------------- */

  router.get('/:pageId/scheduled', asyncRoute(async (req, res) => {
    const rows = await repo.listScheduled(req.page.id);
    res.json({ rows: rows.map(withPostUrl), job: getPlanJob(req.page.id) });
  }));

  router.get('/:pageId/plan', (req, res) => {
    res.json({ job: getPlanJob(req.page.id) });
  });

  /** Generates posts for every day of the range at the given times, as scheduled posts. */
  router.post('/:pageId/plan', asyncRoute(async (req, res) => {
    const startDate = String(req.body?.startDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw httpError('Pick a start date.');
    const today = zonedDate(new Date(), config.timezone);
    if (startDate < today) throw httpError('The start date is in the past.');
    const days = Number.parseInt(req.body?.days, 10);
    if (!Number.isInteger(days) || days < 1 || days > 31) throw httpError('Plan between 1 and 31 days.');
    const times = Array.isArray(req.body?.times) ? [...new Set(req.body.times.map(String))] : [];
    if (times.length === 0 || times.length > 3) throw httpError('Pick 1 to 3 posting times per day.');
    if (times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw httpError('Times must look like 10:00.');
    if (days * times.length > 100) throw httpError('A plan can have up to 100 posts.');
    const settings = await repo.getUserSettings(req.user.id);
    if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');
    const job = startPlanJob({ pageId: req.page.id, startDate, days, times: times.sort(), useQueue: req.body?.useQueue !== false });
    res.status(202).json({ job });
  }));

  /**
   * One-click month: approved ideas get a date each (posting times x days from startDate).
   * write = 'day_before' (default): each post is written ~24h before its time; 'now': all are written right away.
   */
  router.post('/:pageId/plan/approve', asyncRoute(async (req, res) => {
    const ids = Array.isArray(req.body?.ideaIds) ? [...new Set(req.body.ideaIds.map(Number))].filter((id) => Number.isInteger(id) && id > 0) : [];
    if (ids.length === 0) throw httpError('Pick at least one idea.');
    if (ids.length > 100) throw httpError('You can schedule up to 100 ideas at a time.');
    const startDate = String(req.body?.startDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw httpError('Pick a start date.');
    if (startDate < zonedDate(new Date(), config.timezone)) throw httpError('The start date is in the past.');
    const times = Array.isArray(req.body?.times) ? [...new Set(req.body.times.map(String))].sort() : [];
    if (times.length === 0 || times.length > 3 || times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw httpError('Pick 1 to 3 posting times like 10:00.');
    const write = req.body?.write === 'now' ? 'now' : 'day_before';
    if (req.body?.approval && ['auto', 'manual'].includes(req.body.approval)) await repo.updatePage(req.page.id, { plan_approval: req.body.approval });

    const ideas = (await Promise.all(ids.map((id) => repo.getIdea(req.page.id, id)))).filter((idea) => idea && idea.status === 'new');
    if (ideas.length === 0) throw httpError('Those ideas are no longer available.');
    const days = Math.ceil(ideas.length / times.length) + 1;
    const slots = buildSlots({ startDate, days, times }).slice(0, ideas.length);
    if (slots.length < ideas.length) throw httpError('Not enough future time slots. Pick a later start date.');

    const created = [];
    for (let index = 0; index < ideas.length; index += 1) {
      const idea = ideas[index];
      const id = await repo.insertHistory({ page_id: req.page.id, topic: idea.topic, post_caption: '', status: 'planned', scheduled_at: slots[index] });
      await repo.setIdeaStatus(req.page.id, idea.id, 'used');
      created.push(id);
    }
    const job = write === 'now' ? startWriteJob({ pageId: req.page.id, historyIds: created }) : null;
    res.status(201).json({ planned: created.length, from: slots[0], to: slots[slots.length - 1], write, job });
  }));

  router.delete('/:pageId/plan', (req, res) => {
    res.json({ job: cancelPlanJob(req.page.id) });
  });

  /* ---------------- Post ideas ---------------- */

  router.get('/:pageId/ideas', asyncRoute(async (req, res) => {
    const status = ['new', 'queued', 'used', 'dismissed'].includes(req.query.status) ? req.query.status : undefined;
    const [ideas, counts] = await Promise.all([repo.listIdeas(req.page.id, { status }), repo.getIdeaCounts(req.page.id)]);
    res.json({ ideas, counts });
  }));

  /** Asks Gemini for fresh ideas (optionally steered by a hint) and stores them as "new". */
  router.post('/:pageId/ideas/generate', asyncRoute(async (req, res) => {
    const settings = await repo.getUserSettings(req.user.id);
    if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');
    const count = Math.min(Math.max(Number.parseInt(req.body?.count, 10) || 10, 3), 30);
    const hint = typeof req.body?.hint === 'string' ? req.body.hint.trim().slice(0, 300) : '';
    const [published, pending, suggested] = await Promise.all([
      repo.getRecentPublishedTopics(req.page.id, 40),
      repo.getPendingTopics(req.page.id, 40),
      repo.getRecentIdeaTopics(req.page.id, 60),
    ]);
    const ideas = await generatePostIdeas({
      apiKey: settings.gemini_api_key,
      model: settings.gemini_model,
      pageNiche: req.page.page_niche,
      avoidTopics: [...new Set([...pending, ...published, ...suggested])],
      count,
      hint,
    });
    res.status(201).json({ ideas: await repo.insertIdeas(req.page.id, ideas) });
  }));

  /** Auto research: analyse the page + competitors and add ideas (background job). */
  router.post('/:pageId/research', asyncRoute(async (req, res) => {
    const settings = await repo.getUserSettings(req.user.id);
    if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');
    const count = Math.min(Math.max(Number.parseInt(req.body?.count, 10) || 10, 3), 30);
    res.status(202).json({ job: startResearchJob(req.page.id, { count }) });
  }));

  router.get('/:pageId/research', asyncRoute(async (req, res) => {
    const page = await repo.getPage(req.page.id);
    res.json({ job: getResearchJob(req.page.id), research: page.research, researchedAt: page.researched_at });
  }));

  /** Moves an idea into the content queue. */
  router.post('/:pageId/ideas/:ideaId/queue', asyncRoute(async (req, res) => {
    const idea = await repo.getIdea(req.page.id, parseId(req.params.ideaId));
    if (!idea) throw httpError('Idea not found.', 404);
    const priority = Number.isFinite(Number(req.body?.priority)) ? Math.trunc(Number(req.body.priority)) : 0;
    await repo.addTopics(req.page.id, [{ topic: idea.topic, category: idea.category, priority }]);
    await repo.setIdeaStatus(req.page.id, idea.id, 'queued');
    res.json({ ok: true });
  }));

  router.post('/:pageId/ideas/:ideaId/status', asyncRoute(async (req, res) => {
    const status = req.body?.status;
    if (!['new', 'used', 'dismissed'].includes(status)) throw httpError('Invalid status.');
    if (!(await repo.setIdeaStatus(req.page.id, parseId(req.params.ideaId), status))) throw httpError('Idea not found.', 404);
    res.json({ ok: true });
  }));

  router.delete('/:pageId/ideas/dismissed', asyncRoute(async (req, res) => {
    res.json({ deleted: await repo.clearDismissedIdeas(req.page.id) });
  }));

  /* ---------------- Facebook connection ---------------- */

  router.get('/:pageId/facebook/check', asyncRoute(async (req, res) => {
    const info = await checkPageConnection({ pageId: req.page.fb_page_id, accessToken: req.page.fb_page_token });
    if (info.name && info.name !== req.page.fb_page_name) {
      await saveConnection(req.page, { fbPageId: req.page.fb_page_id, fbPageName: info.name, token: req.page.fb_page_token });
    }
    res.json({ page: info });
  }));

  /**
   * Paste a token. A Page token connects directly. A User token is (if the user saved a Facebook App)
   * exchanged for a long-lived one, then the user picks which of their pages to connect.
   */
  router.post('/:pageId/facebook/token', asyncRoute(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token || token.length > 2000 || /\s/.test(token)) throw httpError('Paste a valid Facebook access token.');

    const info = await inspectToken(token);
    if (info.type === 'page') {
      const page = await saveConnection(req.page, { fbPageId: info.page.id, fbPageName: info.page.name, token });
      await refreshPageSchedule(page.id);
      return res.json({ connected: true, page: await pageSummary(page) });
    }

    const { longLived } = await saveUserToken(req.user.id, token);

    const pages = info.pages.map(({ accessToken, ...rest }) => rest);
    if (pages.length === 0) throw httpError('This Facebook account does not manage any pages, or the pages_show_list permission is missing.');
    return res.json({ connected: false, choose: true, longLived, pages });
  }));

  /** Pages available from the user's saved Facebook user token (after "Connect with Facebook" or a pasted user token). */
  router.get('/:pageId/facebook/accounts', asyncRoute(async (req, res) => {
    const settings = await repo.getUserSettings(req.user.id);
    if (!settings.fb_user_token) throw httpError('Connect with Facebook or paste a user token first.');
    const pages = await listManagedPages(settings.fb_user_token);
    res.json({ pages: pages.map(({ accessToken, ...rest }) => rest) });
  }));

  router.post('/:pageId/facebook/select', asyncRoute(async (req, res) => {
    const fbPageId = String(req.body?.fbPageId || '').trim();
    if (!/^\d{3,30}$/.test(fbPageId)) throw httpError('Pick a Facebook Page.');
    const settings = await repo.getUserSettings(req.user.id);
    if (!settings.fb_user_token) throw httpError('Your Facebook login has expired. Connect again.');
    const page = await connectFromUserToken(req.page, settings.fb_user_token, fbPageId);
    await refreshPageSchedule(page.id);
    res.json({ page: await pageSummary(page) });
  }));

  router.delete('/:pageId/facebook', asyncRoute(async (req, res) => {
    const page = await repo.clearPageFacebook(req.page.id);
    res.json({ page: await pageSummary(page) });
  }));

  return router;
}

export { connectFromUserToken, saveConnection };
