import cron from 'node-cron';
import { config } from '../config/env.js';
import * as repo from '../db/repository.js';
import { fetchPageContent } from './facebookService.js';
import { researchPageIdeas } from './geminiService.js';

/*
 * Auto research: reads the page's own posts (with engagement), researches competitors and
 * trends with Google Search, then stores an analysis and fresh ideas. Runs on demand (background
 * job with progress) and weekly for pages with auto research switched on.
 */

const jobs = new Map(); // pageId -> job
const DEFAULT_NICHES = new Set([config.defaultSettings.page_niche, '']);
let weeklyTask = null;

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export function getResearchJob(pageId) {
  return jobs.get(pageId) || null;
}

/** Runs one research for a page. Returns { analysis, ideas, ... }. */
export async function runResearch(pageId, { count = 10, trigger = 'manual', step = () => {} } = {}) {
  const page = await repo.getPage(pageId);
  if (!page) throw httpError('Page not found.', 404);
  const owner = await repo.getUserById(page.user_id);
  if (!owner || owner.status !== 'active') throw httpError('The account that owns this page is disabled.', 403);
  const settings = await repo.getUserSettings(page.user_id);
  if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');

  step('Reading your Facebook Page…');
  let profile = { name: page.fb_page_name || page.name, about: '', description: '', category: '', followers: null, website: '' };
  let posts = [];
  let facebookError = null;
  if (page.fb_page_id && page.fb_page_token) {
    try {
      ({ profile, posts } = await fetchPageContent({ pageId: page.fb_page_id, accessToken: page.fb_page_token }));
    } catch (error) {
      facebookError = error.message;
    }
  }

  step('Researching competitors and trends with Google Search…');
  const competitors = (page.competitors || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const [published, pending, suggested, scheduled] = await Promise.all([
    repo.getRecentPublishedTopics(pageId, 40),
    repo.getPendingTopics(pageId, 40),
    repo.getRecentIdeaTopics(pageId, 60),
    repo.getScheduledTopics(pageId, 60),
  ]);
  const avoidTopics = [...new Set([...pending, ...scheduled, ...published, ...suggested])];

  const result = await researchPageIdeas({
    apiKey: settings.gemini_api_key,
    model: settings.gemini_model,
    profile,
    posts,
    niche: page.page_niche,
    competitors,
    avoidTopics,
    count,
    useSearch: true,
  });

  step('Saving ideas…');
  const ideas = await repo.insertIdeas(pageId, result.ideas);
  const summary = {
    analysis: result.analysis,
    sources: result.sources,
    searchUsed: result.searchUsed,
    searchError: result.searchError,
    facebookError,
    postsAnalyzed: posts.length,
    topPosts: [...posts].sort((a, b) => b.score - a.score).slice(0, 3).map(({ message, url, reactions, comments, shares }) => ({
      message: message.slice(0, 160), url, reactions, comments, shares,
    })),
    ideasAdded: ideas.length,
    trigger,
    at: new Date().toISOString(),
  };
  await repo.saveResearch(pageId, summary);
  // A page still on the default niche takes the niche Gemini worked out from its posts.
  if (result.analysis.niche && DEFAULT_NICHES.has(page.page_niche.trim())) {
    await repo.updatePage(pageId, { page_niche: result.analysis.niche });
  }
  console.log(`[research] Page #${pageId}: ${ideas.length} ideas (${posts.length} posts analysed, search ${result.searchUsed ? 'used' : 'unavailable'}).`);
  return { ...summary, ideas };
}

/** Starts research in the background; poll getResearchJob for progress. */
export function startResearchJob(pageId, { count }) {
  if (jobs.get(pageId)?.status === 'running') throw httpError('Research is already running for this page.', 409);
  const job = { status: 'running', step: 'Starting…', startedAt: new Date().toISOString(), finishedAt: null, error: null, ideasAdded: 0 };
  jobs.set(pageId, job);
  runResearch(pageId, { count, step: (text) => { job.step = text; } })
    .then((result) => {
      job.status = 'done';
      job.ideasAdded = result.ideasAdded;
    })
    .catch((error) => {
      job.status = 'failed';
      job.error = error.message;
      console.error(`[research] Page #${pageId}: ${error.message}`);
    })
    .finally(() => {
      job.step = null;
      job.finishedAt = new Date().toISOString();
    });
  return job;
}

/** Weekly: every Monday 09:00 (app timezone), research pages with auto research on. */
export function startWeeklyResearch() {
  if (weeklyTask) return;
  weeklyTask = cron.schedule('0 9 * * 1', async () => {
    for (const page of await repo.listAutoResearchPages()) {
      const last = page.researched_at ? new Date(page.researched_at).getTime() : 0;
      if (Date.now() - last < 6 * 24 * 3600 * 1000) continue;
      try {
        await runResearch(page.id, { count: 10, trigger: 'weekly' });
      } catch (error) {
        console.error(`[research] Weekly research for page #${page.id} failed: ${error.message}`);
      }
    }
  }, { timezone: config.timezone, name: 'weekly-research', noOverlap: true });
}

export function stopWeeklyResearch() {
  weeklyTask?.destroy();
  weeklyTask = null;
}
