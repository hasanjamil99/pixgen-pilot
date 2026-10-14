import { config, isGeminiConfigured, validateConfig } from './config/env.js';
import { bootstrap } from './db/bootstrap.js';
import { closeDatabase, initDatabase } from './db/mysql.js';
import * as repo from './db/repository.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './services/authService.js';
import { generatePostContent } from './services/geminiService.js';
import { renderBanner } from './services/bannerService.js';
import { runPipeline, startScheduler, stopScheduler } from './services/schedulerService.js';
import { startWeeklyResearch, stopWeeklyResearch } from './services/researchService.js';
import { startServer } from './web/server.js';

const DEFAULT_TEST_TOPIC = 'কৃত্রিম বুদ্ধিমত্তা কীভাবে আমাদের প্রতিদিনের কাজ সহজ করছে';

const HELP = `PixGen Pilot (fb-autopilot-mysql)

Usage:
  node src/index.js                                Start the dashboard and the schedulers
  node src/index.js --test-banner [text]           Render public/banners/test-banner.png (no database needed)
  node src/index.js --preview [topic] --page <id>  Generate one preview post for a page and exit
  node src/index.js --run-now --page <id>          Run the full pipeline once for a page (publishes) and exit
  node src/index.js --reset-password <email> <new> Set a user's password (account recovery)
  node src/index.js --help                         Show this help
`;

function parseArgs(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      flags._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

function checkConfig({ requireDatabase }) {
  const { errors, warnings } = validateConfig({ requireDatabase });
  warnings
    .filter((warning) => requireDatabase || !warning.startsWith('ADMIN_PASSWORD'))
    .forEach((warning) => console.warn(`[config] ${warning}`));
  if (errors.length) {
    errors.forEach((error) => console.error(`[config] ${error}`));
    console.error('[config] Fix the values above in .env and start again.');
    process.exit(1);
  }
}

async function testBanner(text) {
  checkConfig({ requireDatabase: false });
  const topic = typeof text === 'string' && text.trim() ? text.trim() : DEFAULT_TEST_TOPIC;
  const settings = { ...config.defaultSettings };

  let content = {
    banner_badge: 'প্রযুক্তি ভাবনা',
    banner_headline: topic,
    banner_subheadline: 'ছোট ছোট স্মার্ট অভ্যাসেই বদলে যায় পুরো দিনের কাজের গতি',
  };

  if (isGeminiConfigured()) {
    try {
      console.log('[test-banner] GEMINI_API_KEY found: asking Gemini for banner text...');
      content = await generatePostContent({
        apiKey: config.gemini.apiKey,
        model: settings.gemini_model,
        topic,
        pageNiche: settings.page_niche,
        brandName: settings.brand_name,
        brandHandle: settings.brand_handle,
      });
      console.log('\n----- Generated caption -----\n');
      console.log(content.post_caption);
      console.log('\n-----------------------------\n');
    } catch (error) {
      console.warn(`[test-banner] Gemini failed (${error.message}); using sample Bengali text instead.`);
    }
  } else {
    console.log('[test-banner] GEMINI_API_KEY not set: using sample Bengali text.');
  }

  const banner = await renderBanner({
    badge: content.banner_badge,
    headline: content.banner_headline,
    subheadline: content.banner_subheadline,
    settings,
    fileName: 'test-banner.png',
  });
  console.log(`[test-banner] Saved ${banner.filePath}`);
  if (!banner.fontsOk) console.warn('[test-banner] Web fonts did not load; check the server can reach fonts.googleapis.com.');
}

async function withDatabase(fn) {
  checkConfig({ requireDatabase: true });
  await initDatabase();
  try {
    await bootstrap();
    await fn();
  } finally {
    await closeDatabase();
  }
}

async function runOnce({ publish, topic, pageId }) {
  await withDatabase(async () => {
    const id = Number.parseInt(pageId, 10);
    if (!Number.isInteger(id)) throw new Error('Pass the page id: --page <id> (see the dashboard URL, /pages/<id>).');
    const result = await runPipeline({ pageId: id, publish, topic: typeof topic === 'string' ? topic : null, trigger: 'cli' });
    console.log(`[cli] ${result.message} History #${result.historyId}${result.url ? ` → ${result.url}` : ''}`);
  });
}

async function resetPassword(email, password) {
  if (typeof email !== 'string' || typeof password !== 'string') throw new Error('Usage: --reset-password <email> <new password>');
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  await withDatabase(async () => {
    const user = await repo.getUserByEmail(email);
    if (!user) throw new Error(`No account with email ${email}.`);
    await repo.updateUser(user.id, { password_hash: await hashPassword(password), status: 'active' });
    console.log(`[cli] Password updated for ${user.email}. Their other sessions are signed out.`);
  });
}

async function startApp() {
  checkConfig({ requireDatabase: true });
  await initDatabase();
  await bootstrap();
  const reset = await repo.resetStuckTopics();
  if (reset > 0) console.warn(`[db] Put ${reset} topic(s) stuck in "processing" back to "pending".`);

  const server = await startServer();
  await startScheduler();
  startWeeklyResearch();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[app] ${signal} received, shutting down...`);
    stopScheduler();
    stopWeeklyResearch();
    server.close();
    server.closeIdleConnections?.();
    await closeDatabase().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) return console.log(HELP);
  if (flags['test-banner'] !== undefined) return testBanner(flags['test-banner']);
  if (flags['run-now']) return runOnce({ publish: true, pageId: flags.page });
  if (flags.preview !== undefined) return runOnce({ publish: false, topic: flags.preview, pageId: flags.page });
  if (flags['reset-password'] !== undefined) return resetPassword(flags['reset-password'], flags._[0]);
  return startApp();
}

process.on('unhandledRejection', (reason) => {
  console.error('[app] Unhandled promise rejection:', reason);
});

main().catch((error) => {
  console.error(`[app] ${error.message}`);
  process.exit(1);
});
