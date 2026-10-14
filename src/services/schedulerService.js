import cron from 'node-cron';
import { config, isValidCron } from '../config/env.js';
import * as repo from '../db/repository.js';
import { generatePostContent } from './geminiService.js';
import { renderBanner, resolveBannerPath } from './bannerService.js';
import { publishPhoto } from './facebookService.js';
import { dayRangeUtc } from './timeService.js';
import { searchPhoto } from './photoService.js';

/**
 * Picks this post's background: one of the page's brand backgrounds (rotating), a stock photo
 * matching the topic, or both alternating ("mix"). Returns null for the page's normal design.
 */
export async function chooseBackground(page, content) {
  const brandList = page.background_images?.length
    ? page.background_images
    : page.background_image_path ? [{ path: page.background_image_path }] : [];
  const brandOn = page.banner_mode === 'image' && brandList.length > 0;
  const source = page.background_source || 'brand';
  if (!brandOn && source === 'brand') return null;
  const index = await repo.nextBackgroundIndex(page.id);
  const wantPhoto = source === 'photos' || (source === 'mix' && (index % 2 === 1 || !brandOn));
  if (wantPhoto && content.photo_query) {
    try {
      const photo = await searchPhoto(content.photo_query, { seed: index });
      if (photo?.url) return { kind: 'photo', url: photo.url };
    } catch (error) {
      console.warn(`[photos] Page #${page.id}: photo search failed: ${error.message}`);
    }
  }
  if (brandOn) {
    const item = brandList[index % brandList.length];
    return { kind: 'brand', path: item.path, fit: item.fit, erase: item.erase };
  }
  return null;
}

/** Background stored with a post (so edits re-render with the same picture). */
export function parseBackground(value) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && (parsed.kind === 'photo' || parsed.kind === 'brand') ? parsed : null;
  } catch {
    return null;
  }
}

export class BusyError extends Error {
  constructor() {
    super('A post for this page is being generated right now. Wait for it to finish and try again.');
    this.name = 'BusyError';
  }
}

const tasks = new Map(); // pageId -> { task, expression }
const running = new Map(); // pageId -> { trigger, startedAt }
const lastRuns = new Map(); // pageId -> { trigger, startedAt, finishedAt, ok, message, historyId }

/** Only one job per page at a time (cron, dashboard and CLI share this lock). Different pages run in parallel. */
async function withLock(pageId, trigger, job) {
  if (running.has(pageId)) throw new BusyError();
  const startedAt = new Date().toISOString();
  running.set(pageId, { trigger, startedAt });
  try {
    const result = await job();
    lastRuns.set(pageId, { trigger, startedAt, finishedAt: new Date().toISOString(), ok: true, message: result.message, historyId: result.historyId });
    return result;
  } catch (error) {
    lastRuns.set(pageId, { trigger, startedAt, finishedAt: new Date().toISOString(), ok: false, message: error.message, historyId: error.historyId ?? null });
    throw error;
  } finally {
    running.delete(pageId);
  }
}

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

/** Loads the page and its owner's Gemini settings. */
export async function loadContext(pageId) {
  const page = await repo.getPage(pageId);
  if (!page) throw httpError('Page not found.', 404);
  const owner = await repo.getUserById(page.user_id);
  if (!owner || owner.status !== 'active') throw httpError('The account that owns this page is disabled.', 403);
  const settings = await repo.getUserSettings(page.user_id);
  return { page, settings };
}

/**
 * Picks the topic: a custom one, the next queue item, then (when the page uses ideas) the oldest
 * new idea, or none (Gemini brainstorms one).
 */
async function pickTopic(page, { customTopic, claim }) {
  if (customTopic) return { topic: customTopic.trim(), category: null, queueId: null, source: 'custom' };
  const item = claim ? await repo.claimNextTopic(page.id) : await repo.peekNextTopic(page.id);
  if (item) return { topic: item.topic, category: item.category, queueId: item.id, source: 'queue' };
  if (page.use_ideas) {
    const idea = claim ? await repo.claimNextIdea(page.id) : (await repo.listIdeas(page.id, { status: 'new' })).at(-1);
    if (idea) return { topic: idea.topic, category: idea.category, queueId: null, source: 'idea' };
  }
  return { topic: null, category: null, queueId: null, source: 'autopilot' };
}

/** Writes the post with Gemini and renders the banner. `extraAvoid` adds topics Gemini must not repeat. */
export async function generateForPage(page, settings, picked, extraAvoid = []) {
  const recentTopics = picked.topic ? [] : [...(await repo.getRecentPublishedTopics(page.id, 30)), ...extraAvoid];
  if (picked.topic) console.log(`[pipeline] Page #${page.id} topic (${picked.source}): ${picked.topic}`);
  else console.log(`[pipeline] Page #${page.id}: queue empty, brainstorming (avoiding ${recentTopics.length} recent topics).`);

  const content = await generatePostContent({
    apiKey: settings.gemini_api_key,
    model: settings.gemini_model,
    topic: picked.topic,
    category: picked.category,
    pageNiche: page.page_niche,
    recentTopics,
    brandName: page.brand_name,
    brandHandle: page.brand_handle,
  });

  const background = await chooseBackground(page, content);
  const banner = await renderBanner({
    badge: content.banner_badge,
    headline: content.banner_headline,
    subheadline: content.banner_subheadline,
    settings: page,
    type: content.banner_type,
    points: content.banner_points,
    background,
  });
  return { content, banner, background };
}

export function historyFields(page, content, banner, background = null) {
  return {
    page_id: page.id,
    banner_type: content.banner_type || 'statement',
    banner_points: content.banner_points || [],
    banner_bg: background ? JSON.stringify(background) : null,
    topic: content.selected_topic,
    banner_badge: content.banner_badge,
    banner_headline: content.banner_headline,
    banner_subheadline: content.banner_subheadline,
    post_caption: content.post_caption,
    banner_image_path: banner?.webPath ?? null,
  };
}

/**
 * Full pipeline for one page: topic -> Gemini -> banner -> (optionally) Facebook -> history.
 * publish=false stores a "preview_only" history row and leaves the queue untouched.
 */
export function runPipeline({ pageId, publish = true, topic = null, trigger = 'manual' }) {
  return withLock(pageId, trigger, async () => {
    const { page, settings } = await loadContext(pageId);
    if (publish && !(page.fb_page_id && page.fb_page_token)) {
      throw httpError('Connect this page to Facebook before publishing (Facebook in the sidebar).', 400);
    }
    if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.', 400);

    const picked = await pickTopic(page, { customTopic: topic, claim: publish });

    let content;
    let banner;
    let background;
    try {
      ({ content, banner, background } = await generateForPage(page, settings, picked));
    } catch (error) {
      const message = `Generation failed: ${error.message}`;
      console.error(`[pipeline] Page #${page.id}: ${message}`);
      // A failed preview is only reported to the dashboard; failed real runs are logged for later review.
      if (!publish) throw error;
      if (picked.queueId) await repo.markTopicFailed(picked.queueId, message);
      error.historyId = await repo.insertHistory({
        page_id: page.id,
        topic: picked.topic || '(autopilot topic)',
        post_caption: '',
        status: 'failed',
        error_message: message,
        queue_id: picked.queueId,
      });
      throw error;
    }

    if (!publish) {
      const historyId = await repo.insertHistory({ ...historyFields(page, content, banner, background), status: 'preview_only', queue_id: picked.queueId });
      return { historyId, status: 'preview_only', source: picked.source, message: 'Preview generated.' };
    }

    try {
      const fb = await publishPhoto({ pageId: page.fb_page_id, accessToken: page.fb_page_token, imagePath: banner.filePath, caption: content.post_caption });
      const historyId = await repo.insertHistory({ ...historyFields(page, content, banner, background), fb_post_id: fb.postId, status: 'published', queue_id: picked.queueId });
      if (picked.queueId) await repo.markTopicCompleted(picked.queueId);
      return { historyId, status: 'published', source: picked.source, fbPostId: fb.postId, url: fb.url, message: 'Published to Facebook.' };
    } catch (error) {
      console.error(`[pipeline] Page #${page.id}: publishing failed: ${error.message}`);
      // Keep the generated post so it can be retried from the dashboard without calling Gemini again.
      error.historyId = await repo.insertHistory({ ...historyFields(page, content, banner, background), status: 'failed', error_message: error.message, queue_id: picked.queueId });
      if (picked.queueId) await repo.markTopicFailed(picked.queueId, error.message);
      throw error;
    }
  });
}

/** Publishes an existing preview (or a post whose publishing failed) without regenerating it. */
export function publishHistoryEntry(pageId, historyId, trigger = 'dashboard') {
  return withLock(pageId, trigger, async () => {
    const { page } = await loadContext(pageId);
    const entry = await repo.getHistoryById(pageId, historyId);
    if (!entry) throw httpError('Post not found.', 404);
    if (entry.status === 'published') throw httpError('This post is already published.', 409);
    if (!entry.post_caption || !entry.banner_image_path) throw httpError('This entry has no generated post to publish. Generate a new one instead.', 400);

    try {
      const fb = await publishPhoto({
        pageId: page.fb_page_id,
        accessToken: page.fb_page_token,
        imagePath: resolveBannerPath(entry.banner_image_path),
        caption: entry.post_caption,
      });
      await repo.updateHistory(historyId, { status: 'published', fb_post_id: fb.postId, error_message: null });
      if (entry.queue_id) await repo.markTopicCompleted(entry.queue_id);
      return { historyId, status: 'published', fbPostId: fb.postId, url: fb.url, message: 'Published to Facebook.' };
    } catch (error) {
      // A scheduled post that fails is marked failed (retry it from the dashboard) instead of retrying every minute.
      await repo.updateHistory(historyId, entry.status === 'scheduled' ? { status: 'failed', error_message: error.message } : { error_message: error.message });
      error.historyId = historyId;
      throw error;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Planned (scheduled) posts                                           */
/* ------------------------------------------------------------------ */

let dueTask = null;
let writeTask = null;
let publishingDue = false;
let writingPlanned = false;

/**
 * Writes a planned post (topic + date only) with Gemini and renders its banner. The post becomes
 * "scheduled"; it is approved automatically unless the page asks for approval.
 */
export async function writePlannedPost(pageId, historyId) {
  const { page, settings } = await loadContext(pageId);
  const entry = await repo.getHistoryById(pageId, historyId);
  if (!entry || entry.status !== 'planned') return entry;
  if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.', 400);
  try {
    const { content, banner, background } = await generateForPage(page, settings, { topic: entry.topic, category: null, queueId: null, source: 'plan' });
    await repo.updateHistory(historyId, {
      ...historyFields(page, content, banner, background),
      status: 'scheduled',
      approved: page.plan_approval === 'manual' ? 0 : 1,
      error_message: null,
    });
    console.log(`[planner] Page #${pageId}: wrote planned post #${historyId}.`);
  } catch (error) {
    await repo.updateHistory(historyId, { error_message: `Writing failed (will retry): ${error.message}` });
    throw error;
  }
  return repo.getHistoryById(pageId, historyId);
}

/** Every 10 minutes: write planned posts due within 24 hours (a few at a time, kind to free API limits). */
export async function writeUpcomingPlanned() {
  if (writingPlanned) return;
  writingPlanned = true;
  try {
    for (const row of await repo.listPlannedToWrite(24, 4)) {
      await writePlannedPost(row.page_id, row.id).catch((error) => console.error(`[planner] Page #${row.page_id}: post #${row.id}: ${error.message}`));
    }
  } catch (error) {
    console.error(`[planner] Writing planned posts failed: ${error.message}`);
  } finally {
    writingPlanned = false;
  }
}

/** Publishes every approved scheduled post whose time has come. Runs every minute. */
export async function publishDueScheduled() {
  if (publishingDue) return;
  publishingDue = true;
  try {
    for (const due of await repo.listDueScheduled(20)) {
      try {
        // Not written yet (e.g. writing kept failing): try once more right now.
        let entry = due;
        if (due.status === 'planned') entry = await writePlannedPost(due.page_id, due.id);
        if (!entry?.approved) {
          await repo.updateHistory(due.id, { status: 'preview_only', error_message: 'Skipped: it was not approved before its time. Approve and schedule it again.' });
          console.log(`[planner] Page #${due.page_id}: post #${due.id} skipped (not approved).`);
          continue;
        }
        const result = await publishHistoryEntry(due.page_id, due.id, 'planner');
        console.log(`[planner] Page #${due.page_id}: published scheduled post #${due.id} (${result.fbPostId}).`);
      } catch (error) {
        if (error instanceof BusyError) continue; // the page is busy; try again next minute
        if (due.status === 'planned') await repo.updateHistory(due.id, { status: 'failed', error_message: error.message }).catch(() => {});
        console.error(`[planner] Page #${due.page_id}: scheduled post #${due.id} failed: ${error.message}`);
      }
    }
  } catch (error) {
    console.error(`[planner] Checking scheduled posts failed: ${error.message}`);
  } finally {
    publishingDue = false;
  }
}

/* ------------------------------------------------------------------ */
/* Cron jobs                                                           */
/* ------------------------------------------------------------------ */

async function scheduledRun(pageId, expression) {
  console.log(`[scheduler] Page #${pageId}: cron fired (${expression}, ${config.timezone}).`);
  try {
    const [from, to] = dayRangeUtc(new Date(), config.timezone);
    if (await repo.hasPlannedPostBetween(pageId, from, to)) {
      console.log(`[scheduler] Page #${pageId}: today already has a planned post; daily autopilot skipped.`);
      return;
    }
    const result = await runPipeline({ pageId, publish: true, trigger: 'cron' });
    console.log(`[scheduler] Page #${pageId}: ${result.message} History #${result.historyId}.`);
  } catch (error) {
    console.error(`[scheduler] Page #${pageId}: daily run failed: ${error.message}`);
  }
}

export function unschedulePage(pageId) {
  const entry = tasks.get(pageId);
  if (entry) {
    entry.task.destroy();
    tasks.delete(pageId);
  }
}

function schedule(page) {
  unschedulePage(page.id);
  if (!page.autopilot_enabled) return;
  if (!isValidCron(page.cron_schedule)) {
    console.error(`[scheduler] Page #${page.id}: cron "${page.cron_schedule}" is invalid; not scheduled.`);
    return;
  }
  const task = cron.schedule(page.cron_schedule, () => scheduledRun(page.id, page.cron_schedule), {
    timezone: config.timezone,
    name: `page-${page.id}`,
    noOverlap: true,
  });
  tasks.set(page.id, { task, expression: page.cron_schedule });
}

/** Re-reads one page (after its settings, owner or connection changed) and (re)schedules it. */
export async function refreshPageSchedule(pageId) {
  const page = await repo.getPage(pageId);
  const owner = page ? await repo.getUserById(page.user_id) : null;
  if (!page || !owner || owner.status !== 'active') {
    unschedulePage(pageId);
    return;
  }
  schedule(page);
}

export async function startScheduler() {
  for (const { task } of tasks.values()) task.destroy();
  tasks.clear();
  const pages = await repo.listSchedulablePages();
  pages.forEach(schedule);
  console.log(`[scheduler] ${tasks.size} page(s) scheduled (${config.timezone}).`);
  if (!dueTask) dueTask = cron.schedule('* * * * *', publishDueScheduled, { name: 'planned-posts', noOverlap: true });
  if (!writeTask) writeTask = cron.schedule('*/10 * * * *', writeUpcomingPlanned, { name: 'write-planned', noOverlap: true });
}

export function stopScheduler() {
  for (const { task } of tasks.values()) task.destroy();
  tasks.clear();
  dueTask?.destroy();
  dueTask = null;
  writeTask?.destroy();
  writeTask = null;
}

export function getPageSchedule(pageId) {
  const entry = tasks.get(pageId);
  const next = entry?.task.getNextRun?.() || null;
  return {
    scheduled: Boolean(entry),
    cronSchedule: entry?.expression ?? null,
    timezone: config.timezone,
    nextRun: next ? next.toISOString() : null,
    running: running.get(pageId) || null,
    lastRun: lastRuns.get(pageId) || null,
  };
}
