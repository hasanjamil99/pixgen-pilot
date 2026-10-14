import { config } from '../config/env.js';
import * as repo from '../db/repository.js';
import { generateForPage, historyFields, loadContext, writePlannedPost } from './schedulerService.js';
import { addDays, zonedToUtc } from './timeService.js';

/*
 * Content planner: generates a week or a month of posts in one go and stores them as
 * "scheduled" posts. The one-minute job in schedulerService publishes each at its time.
 */

const MAX_SLOTS = 100;
const MIN_LEAD_MS = 5 * 60 * 1000;
const jobs = new Map(); // pageId -> job

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/** Posting times for every day of the plan, as UTC Dates (past times are skipped). */
export function buildSlots({ startDate, days, times }) {
  const now = Date.now();
  const slots = [];
  for (let day = 0; day < days; day += 1) {
    const date = addDays(startDate, day);
    for (const time of times) {
      const at = zonedToUtc(date, time, config.timezone);
      if (at.getTime() > now + MIN_LEAD_MS) slots.push(at);
    }
  }
  return slots.sort((a, b) => a - b).slice(0, MAX_SLOTS);
}

function publicJob(job) {
  if (!job) return null;
  const { cancelled, ...rest } = job;
  return rest;
}

export function getPlanJob(pageId) {
  return publicJob(jobs.get(pageId));
}

export function cancelPlanJob(pageId) {
  const job = jobs.get(pageId);
  if (job && job.status === 'running') job.cancelled = true;
  return publicJob(job);
}

async function runJob(job, { pageId, slots, useQueue }) {
  const planned = [];
  try {
    for (const slot of slots) {
      if (job.cancelled) {
        job.status = 'cancelled';
        break;
      }
      job.current = slot.toISOString();
      let queueItem = null;
      try {
        // Re-read every time: settings or the owner's status may change while the plan runs.
        const { page, settings } = await loadContext(pageId);
        if (!settings.gemini_api_key) throw httpError('Add your Gemini API key under Integrations first.');
        queueItem = useQueue ? await repo.claimNextTopic(pageId) : null;
        const idea = !queueItem && page.use_ideas ? await repo.claimNextIdea(pageId) : null;
        let picked = { topic: null, category: null, queueId: null, source: 'autopilot' };
        if (queueItem) picked = { topic: queueItem.topic, category: queueItem.category, queueId: queueItem.id, source: 'queue' };
        else if (idea) picked = { topic: idea.topic, category: idea.category, queueId: null, source: 'idea' };
        const avoid = [...(await repo.getScheduledTopics(pageId)), ...planned];
        const { content, banner, background } = await generateForPage(page, settings, picked, avoid);
        const id = await repo.insertHistory({ ...historyFields(page, content, banner, background), status: 'scheduled', queue_id: picked.queueId, scheduled_at: slot });
        if (queueItem) await repo.markTopicCompleted(queueItem.id);
        planned.push(content.selected_topic);
        job.created.push({ id, scheduledAt: slot.toISOString(), topic: content.selected_topic });
      } catch (error) {
        // Put a claimed topic back in the queue (processing -> failed -> pending) so it is not lost.
        if (queueItem) {
          await repo.markTopicFailed(queueItem.id, error.message).catch(() => {});
          await repo.requeueTopic(pageId, queueItem.id).catch(() => {});
        }
        job.errors.push({ scheduledAt: slot.toISOString(), message: error.message });
        console.error(`[planner] Page #${pageId}: slot ${slot.toISOString()} failed: ${error.message}`);
        // Configuration problems will fail every slot: stop early.
        if (/API key|credits|RESOURCE_EXHAUSTED|disabled|not found/i.test(error.message)) {
          job.status = 'failed';
          break;
        }
      }
      job.done += 1;
    }
    if (job.status === 'running') job.status = 'done';
  } catch (error) {
    job.status = 'failed';
    job.errors.push({ message: error.message });
  } finally {
    job.current = null;
    job.finishedAt = new Date().toISOString();
    console.log(`[planner] Page #${pageId}: plan ${job.status}, ${job.created.length}/${job.total} posts scheduled.`);
  }
}

/** Starts generating a plan in the background. Returns the job right away. */
export function startPlanJob({ pageId, startDate, days, times, useQueue }) {
  const existing = jobs.get(pageId);
  if (existing?.status === 'running') throw httpError('A plan is already being generated for this page.', 409);
  const slots = buildSlots({ startDate, days, times });
  if (slots.length === 0) throw httpError('All chosen times are in the past. Pick a later start date or time.');
  const job = {
    status: 'running',
    total: slots.length,
    done: 0,
    created: [],
    errors: [],
    current: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    range: { from: slots[0].toISOString(), to: slots[slots.length - 1].toISOString() },
    cancelled: false,
  };
  jobs.set(pageId, job);
  runJob(job, { pageId, slots, useQueue }).catch(() => {});
  return publicJob(job);
}

/** Writes already planned posts right away ("write all now"), with the same progress object. */
export function startWriteJob({ pageId, historyIds }) {
  const existing = jobs.get(pageId);
  if (existing?.status === 'running') throw httpError('Posts are already being written for this page.', 409);
  const job = {
    status: 'running',
    total: historyIds.length,
    done: 0,
    created: [],
    errors: [],
    current: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    range: null,
    cancelled: false,
  };
  jobs.set(pageId, job);
  (async () => {
    for (const id of historyIds) {
      if (job.cancelled) {
        job.status = 'cancelled';
        break;
      }
      try {
        const entry = await writePlannedPost(pageId, id);
        if (entry) job.created.push({ id, scheduledAt: entry.scheduled_at, topic: entry.topic });
      } catch (error) {
        job.errors.push({ message: error.message });
        if (/API key|credits|RESOURCE_EXHAUSTED|disabled/i.test(error.message)) {
          job.status = 'failed';
          break;
        }
      }
      job.done += 1;
    }
    if (job.status === 'running') job.status = 'done';
    job.finishedAt = new Date().toISOString();
  })().catch(() => {});
  return publicJob(job);
}
