import { GoogleGenAI, Type } from '@google/genai';
import { config, isPlaceholder } from '../config/env.js';

const MAX_ATTEMPTS = 3;
const FIELDS = ['selected_topic', 'banner_badge', 'banner_headline', 'banner_subheadline', 'post_caption'];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    selected_topic: {
      type: Type.STRING,
      description: 'The topic used for this post, written in Bengali.',
    },
    banner_badge: {
      type: Type.STRING,
      description: 'Short 2-3 word category tag in Bengali.',
    },
    banner_headline: {
      type: Type.STRING,
      description: 'Powerful, punchy 5-8 word hook/headline in Bengali for the center of the banner.',
    },
    banner_subheadline: {
      type: Type.STRING,
      description: 'One short supporting sentence in Bengali, at most 12 words.',
    },
    post_caption: {
      type: Type.STRING,
      description:
        'Full Facebook post in Bengali: hook, value points, a conversational CTA question, then 4-5 Bengali hashtags. A blank line between every sentence or point.',
    },
  },
  required: [...FIELDS, 'banner_type', 'banner_points', 'photo_query'],
  propertyOrdering: [...FIELDS, 'banner_type', 'banner_points', 'photo_query'],
};

// Extra banner fields: which template suits the post, short points for tips posts, and an
// English stock-photo search (never shown on the banner, so it is exempt from the Bangla rule).
RESPONSE_SCHEMA.properties.banner_type = {
  type: Type.STRING,
  enum: ['statement', 'quote', 'tips'],
  description: 'statement = a strong message; quote = a hadith, verse or saying (headline = the quote, subheadline = its source); tips = practical points.',
};
RESPONSE_SCHEMA.properties.banner_points = {
  type: Type.ARRAY,
  items: { type: Type.STRING },
  description: 'For tips: 3-4 very short Bengali points (max 6 words each). Otherwise an empty array.',
};
RESPONSE_SCHEMA.properties.photo_query = {
  type: Type.STRING,
  description: 'English 2-4 word stock photo search for a calm background photo that fits the topic and the audience culture (objects, nature, places; no text in photo). Example: "wedding rings flowers".',
};

const SYSTEM_INSTRUCTION = `তুমি একজন অভিজ্ঞ বাংলাদেশি সোশ্যাল মিডিয়া কনটেন্ট রাইটার। তুমি ফেসবুক পেজের জন্য স্বাভাবিক, মানুষের মতো, আকর্ষণীয় বাংলা পোস্ট লেখো।

কঠোর নিয়ম:
1. প্রতিটি ফিল্ড শুধুমাত্র বাংলা ভাষায় ও বাংলা হরফে লিখবে। কোনো ইংরেজি শব্দ বা ইংরেজি অক্ষর (A-Z, a-z) ব্যবহার করবে না।
2. প্রযুক্তিগত বা বিদেশি শব্দ হলে বাংলা প্রতিশব্দ বা বাংলা হরফে লিপ্যন্তর ব্যবহার করবে (যেমন: "এআই", "কৃত্রিম বুদ্ধিমত্তা", "ফেসবুক", "ইউটিউব")।
3. সংখ্যা লিখবে বাংলা অঙ্কে (০ ১ ২ ৩ ৪ ৫ ৬ ৭ ৮ ৯)।
4. হ্যাশট্যাগও বাংলায় হবে (যেমন: #প্রযুক্তি #ডিজিটাল_দক্ষতা)। হ্যাশট্যাগের ভেতরে ফাঁকা জায়গা থাকবে না, দরকার হলে আন্ডারস্কোর দেবে।
5. চলিত ভাষায়, বন্ধুসুলভ ও আন্তরিক সুরে লিখবে; যন্ত্রের মতো অনুবাদ-ঘেঁষা ভাষা নয়।
6. পোস্টে কোনো লিংক, ফোন নম্বর বা ব্র্যান্ডের নাম লিখবে না।
7. শুধুমাত্র নির্ধারিত JSON কাঠামোতে উত্তর দেবে।`;

// One SDK client per API key (each user brings their own key).
const clients = new Map();

function getClient(apiKey) {
  if (isPlaceholder(apiKey)) {
    throw new Error('No Gemini API key. Add your key under Integrations → Gemini.');
  }
  if (!clients.has(apiKey)) {
    if (clients.size > 200) clients.clear();
    clients.set(apiKey, new GoogleGenAI({ apiKey }));
  }
  return clients.get(apiKey);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Routine writing does not need deep reasoning: ask for low thinking (much faster), and remember
// models that reject the setting so they are called without it.
const noThinkingConfig = new Set();

async function callModel(ai, params) {
  const model = params.model;
  if (!noThinkingConfig.has(model)) {
    try {
      return await ai.models.generateContent({ ...params, config: { ...params.config, thinkingConfig: { thinkingLevel: 'low' } } });
    } catch (error) {
      const status = error?.status ?? error?.code;
      if (status !== 400 || !/thinking/i.test(error?.message || '')) throw error;
      noThinkingConfig.add(model);
      console.warn(`[gemini] ${model} does not accept thinkingLevel; calling it without.`);
    }
  }
  return ai.models.generateContent(params);
}

function buildPrompt({ topic, category, pageNiche, recentTopics }) {
  const lines = [`পেজের বিষয়বস্তু (নিশ): ${pageNiche}`, ''];

  if (topic) {
    lines.push(`আজকের পোস্টের বিষয়: ${topic}`);
    if (category) lines.push(`ক্যাটাগরি: ${category}`);
    lines.push('', 'এই বিষয়টিই ব্যবহার করবে। "selected_topic" ফিল্ডে বিষয়টি বাংলায় লিখবে (মূল বিষয় অন্য ভাষায় থাকলে বাংলায় রূপান্তর করবে)।');
  } else {
    lines.push('আজকের জন্য কোনো বিষয় দেওয়া হয়নি। পেজের নিশ অনুযায়ী নিজে একটি নতুন, অনন্য, বেশি এনগেজমেন্ট পাওয়ার মতো বিষয় ঠিক করবে।');
    if (recentTopics.length > 0) {
      lines.push('', 'সম্প্রতি এই বিষয়গুলো নিয়ে পোস্ট হয়েছে। এগুলো বা এগুলোর কাছাকাছি কোনো বিষয় আবার বেছে নেবে না:');
      recentTopics.forEach((recent, index) => lines.push(`${index + 1}. ${recent}`));
    }
  }

  lines.push(
    '',
    'যা তৈরি করতে হবে:',
    '- "banner_badge": ২-৩ শব্দের ছোট ক্যাটাগরি ট্যাগ।',
    '- "banner_headline": ব্যানারের মাঝখানের জন্য ৫-৮ শব্দের শক্তিশালী, নজরকাড়া হেডলাইন।',
    '- "banner_subheadline": হেডলাইনকে সমর্থন করে এমন একটি ছোট বাক্য, সর্বোচ্চ ১২ শব্দ।',
    '- "post_caption": পূর্ণাঙ্গ ফেসবুক পোস্ট। শুরুতে একটি জোরালো হুক, তারপর ৩-৫টি কাজের পয়েন্ট (প্রতিটি আলাদা লাইনে, চাইলে শুরুতে একটি ইমোজি), শেষে পাঠকের মতামত জানতে চাওয়া একটি আন্তরিক প্রশ্ন, এবং একদম শেষ লাইনে ৪-৫টি বাংলা হ্যাশট্যাগ।',
    '',
    'খুব গুরুত্বপূর্ণ: "post_caption"-এ প্রতিটি বাক্য বা পয়েন্টের পরে একটি ফাঁকা লাইন দেবে (অর্থাৎ দুটি নতুন লাইন), যাতে পড়তে সহজ হয়।',
    '- "banner_type": ব্যানারের ধরন বেছে নাও — হাদিস/আয়াত/উক্তি হলে "quote" (তখন headline = উক্তিটি, subheadline = সূত্র), কাজের টিপস হলে "tips" (তখন "banner_points"-এ ৩-৪টি খুব ছোট বাংলা পয়েন্ট), নইলে "statement"।',
    '- "photo_query": ব্যাকগ্রাউন্ড ছবির জন্য ২-৪ শব্দের ইংরেজি সার্চ (এটি ব্যানারে দেখা যাবে না)।',
    'হাদিস বা আয়াত উদ্ধৃত করলে শুধু সুপরিচিত ও সহিহ উৎস ব্যবহার করবে এবং সূত্র লিখবে; নিশ্চিত না হলে উক্তি দেবে না।',
  );
  return lines.join('\n');
}

function stripCodeFences(text) {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

/** Finds Latin letters in the generated text, ignoring the brand name/handle in case the model echoes them. */
function findLatinWords(content, ignore) {
  const words = new Set();
  for (const field of [...FIELDS, 'banner_points']) {
    let text = Array.isArray(content[field]) ? content[field].join(' ') : content[field] || '';
    for (const token of ignore) {
      if (token) text = text.split(token).join(' ');
    }
    for (const match of text.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) words.add(match[0]);
  }
  return [...words];
}

const LIST_MARKER = /^[০-৯0-9]{1,2}\s*[.)]\s*/u;
const LIST_NUMBER_ONLY = /^[০-৯0-9]{1,2}\s*[.)]$/u;

/**
 * Makes sure there is a blank line between every sentence or point.
 * Hashtags are kept together on the last line.
 */
export function formatCaption(caption) {
  const text = String(caption || '').replace(/\r\n?/g, '\n').trim();
  const hashtagLines = [];
  const blocks = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(#[^\s#]+\s*)+$/.test(line)) {
      hashtagLines.push(line.replace(/\s+/g, ' '));
      continue;
    }
    // A list number ("১.", "2)") stays on the same line as its point: set it aside before splitting.
    const marker = line.match(LIST_MARKER);
    const rest = marker ? line.slice(marker[0].length) : line;
    // Split a paragraph into sentences after the Bengali dari (।), ?, ! or a full stop followed by a space.
    const sentences = rest.split(/(?<=[।?!]|[.](?=\s))\s+/u).map((part) => part.trim()).filter(Boolean);
    if (marker) {
      const number = marker[0].trim();
      if (sentences.length) sentences[0] = `${number} ${sentences[0]}`;
      else sentences.push(number);
    }
    // A number left alone on its line (an older caption) is joined with the point after it.
    const last = blocks[blocks.length - 1];
    if (last && LIST_NUMBER_ONLY.test(last) && sentences.length) {
      blocks[blocks.length - 1] = `${last} ${sentences.shift()}`;
    }
    blocks.push(...sentences);
  }

  const hashtags = hashtagLines.join(' ').trim();
  return [...blocks, ...(hashtags ? [hashtags] : [])].join('\n\n');
}

function validateContent(raw) {
  const content = {};
  for (const field of FIELDS) {
    const value = typeof raw?.[field] === 'string' ? raw[field].trim() : '';
    if (!value) throw new Error(`Gemini response is missing "${field}".`);
    content[field] = value;
  }
  content.selected_topic = content.selected_topic.slice(0, 500);
  content.banner_badge = content.banner_badge.slice(0, 150);
  content.banner_headline = content.banner_headline.slice(0, 500);
  content.banner_subheadline = content.banner_subheadline.slice(0, 500);
  content.post_caption = formatCaption(content.post_caption);
  content.banner_type = ['statement', 'quote', 'tips'].includes(raw?.banner_type) ? raw.banner_type : 'statement';
  content.banner_points = Array.isArray(raw?.banner_points)
    ? raw.banner_points.map((point) => String(point).trim()).filter(Boolean).slice(0, 4).map((point) => point.slice(0, 120))
    : [];
  if (content.banner_type === 'tips' && content.banner_points.length < 2) content.banner_type = 'statement';
  content.photo_query = typeof raw?.photo_query === 'string' ? raw.photo_query.replace(/[^\w\s-]/g, ' ').trim().slice(0, 60) : '';
  return content;
}

/** The SDK puts the raw JSON error body in the message; pull out Google's readable text. */
function readableApiError(error) {
  const message = error?.message || String(error);
  const start = message.indexOf('{');
  if (start === -1) return message;
  try {
    const body = JSON.parse(message.slice(start));
    const inner = body.error || body;
    if (inner.message) return `${inner.message.trim()}${inner.status ? ` (${inner.status})` : ''}`;
  } catch {
    // not JSON; fall through
  }
  return message;
}

function isRetryableApiError(error) {
  const status = error?.status ?? error?.code;
  return status === 429 || (typeof status === 'number' && status >= 500) || /fetch failed|ECONNRESET|ETIMEDOUT/i.test(error?.message || '');
}

/**
 * Generates the Bengali post and banner text.
 * With a topic it writes about that topic; without one it brainstorms a fresh topic for the niche,
 * avoiding the recently published topics.
 */
export async function generatePostContent({
  apiKey,
  topic = null,
  category = null,
  pageNiche,
  model,
  recentTopics = [],
  brandName = '',
  brandHandle = '',
}) {
  const ai = getClient(apiKey);
  const modelName = (model || config.gemini.model || 'gemini-3.8-flash').trim();
  const contents = [{ role: 'user', parts: [{ text: buildPrompt({ topic, category, pageNiche, recentTopics }) }] }];
  let lastError;
  let best = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await callModel(ai, {
        model: modelName,
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.9,
        },
      });

      const text = response.text;
      if (!text) {
        const reason = response.candidates?.[0]?.finishReason || response.promptFeedback?.blockReason || 'empty response';
        throw new Error(`Gemini returned no text (${reason}).`);
      }

      const content = validateContent(JSON.parse(stripCodeFences(text)));
      const latin = findLatinWords(content, [brandName, brandHandle, brandHandle.replace(/^@/, '')]);
      if (latin.length === 0) return { ...content, model: modelName };

      // Bangla only: ask again, telling the model exactly which English words slipped in.
      best = content;
      console.warn(`[gemini] Attempt ${attempt}: response contained English words (${latin.join(', ')}). Asking again.`);
      contents.push(
        { role: 'model', parts: [{ text }] },
        {
          role: 'user',
          parts: [{
            text: `উত্তরে এই ইংরেজি শব্দগুলো আছে: ${latin.join(', ')}। পুরো JSON আবার লেখো, প্রতিটি ফিল্ড শুধুমাত্র বাংলা হরফে। ইংরেজি শব্দ বাংলায় অনুবাদ বা বাংলা হরফে লিপ্যন্তর করবে।`,
          }],
        },
      );
    } catch (error) {
      lastError = error;
      if (error instanceof SyntaxError) {
        console.warn(`[gemini] Attempt ${attempt}: invalid JSON from model, retrying.`);
      } else if (isRetryableApiError(error)) {
        console.warn(`[gemini] Attempt ${attempt}: ${readableApiError(error)}. Retrying.`);
        await sleep(2000 * attempt);
      } else if (!/missing "/.test(error.message)) {
        throw new Error(`Gemini request failed (${modelName}): ${readableApiError(error)}`);
      }
    }
  }

  if (best) {
    console.warn('[gemini] Still found English words after all retries; using the last response.');
    return { ...best, model: modelName };
  }
  throw new Error(`Gemini request failed after ${MAX_ATTEMPTS} attempts (${modelName}): ${lastError ? readableApiError(lastError) : "unknown error"}`);
}

/** Checks that a key works and can see the model. Returns { model, displayName }. */
export async function testGeminiKey({ apiKey, model }) {
  const ai = getClient(apiKey);
  const modelName = (model || config.gemini.model || 'gemini-3.8-flash').trim();
  try {
    const info = await ai.models.get({ model: modelName });
    return { model: modelName, displayName: info.displayName || modelName };
  } catch (error) {
    throw Object.assign(new Error(readableApiError(error)), { statusCode: 400 });
  }
}

const IDEAS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    ideas: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING, description: 'The post topic in Bengali, one clear line (max 15 words).' },
          angle: { type: Type.STRING, description: 'One Bengali sentence: the hook or angle that makes this post engaging.' },
          category: { type: Type.STRING, description: 'Short 1-3 word Bengali category.' },
        },
        required: ['topic', 'angle', 'category'],
        propertyOrdering: ['topic', 'angle', 'category'],
      },
    },
  },
  required: ['ideas'],
};

/**
 * Suggests fresh Bangla post ideas for a page. Avoids recent, queued and already suggested topics.
 * Returns [{ topic, angle, category }].
 */
export async function generatePostIdeas({ apiKey, model, pageNiche, avoidTopics = [], count = 10, hint = '' }) {
  const ai = getClient(apiKey);
  const modelName = (model || config.gemini.model || 'gemini-3.8-flash').trim();
  const lines = [
    `পেজের বিষয়বস্তু (নিশ): ${pageNiche}`,
    '',
    `এই ফেসবুক পেজের জন্য ${count}টি নতুন, বৈচিত্র্যময়, বেশি এনগেজমেন্ট পাওয়ার মতো পোস্টের আইডিয়া দাও।`,
    'প্রতিটি আইডিয়া আলাদা ধরনের হবে: টিপস, প্রশ্ন, গল্প, ভুল ধারণা ভাঙা, তালিকা, অনুপ্রেরণা, মৌসুমি বিষয় ইত্যাদি মিশিয়ে দাও।',
  ];
  if (hint) lines.push('', `বিশেষ নির্দেশনা: ${hint}`);
  if (avoidTopics.length) {
    lines.push('', 'এই বিষয়গুলো আগেই ব্যবহার বা প্রস্তাব করা হয়েছে, এগুলো বা কাছাকাছি কিছু আবার দেবে না:');
    avoidTopics.slice(0, 80).forEach((topic, index) => lines.push(`${index + 1}. ${topic}`));
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await callModel(ai, {
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: lines.join('\n') }] }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: IDEAS_SCHEMA,
          temperature: 1,
        },
      });
      if (!response.text) throw new Error('Gemini returned no ideas.');
      const parsed = JSON.parse(stripCodeFences(response.text));
      const ideas = (parsed.ideas || [])
        .map((idea) => ({
          topic: String(idea.topic || '').trim().slice(0, 500),
          angle: String(idea.angle || '').trim().slice(0, 2000),
          category: String(idea.category || '').trim().slice(0, 150),
        }))
        .filter((idea) => idea.topic);
      if (ideas.length === 0) throw new Error('Gemini returned no ideas.');
      return ideas.slice(0, count);
    } catch (error) {
      lastError = error;
      if (error instanceof SyntaxError || /no ideas/.test(error.message)) continue;
      if (isRetryableApiError(error)) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new Error(`Gemini request failed (${modelName}): ${readableApiError(error)}`);
    }
  }
  throw new Error(`Gemini could not suggest ideas (${modelName}): ${lastError ? readableApiError(lastError) : 'unknown error'}`);
}

const RESEARCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    analysis: {
      type: Type.OBJECT,
      properties: {
        niche: { type: Type.STRING, description: 'What the page is about, one Bengali sentence (used as the page niche).' },
        audience: { type: Type.STRING, description: 'Who follows the page, one Bengali sentence.' },
        tone: { type: Type.STRING, description: 'The voice and style of the page, one Bengali sentence.' },
        pillars: { type: Type.ARRAY, items: { type: Type.STRING }, description: '3-6 Bengali content pillars.' },
        what_works: { type: Type.ARRAY, items: { type: Type.STRING }, description: '2-5 Bengali observations about which posts get the most engagement.' },
        competitor_insights: { type: Type.ARRAY, items: { type: Type.STRING }, description: '0-5 Bengali observations from competitors and trends.' },
      },
      required: ['niche', 'audience', 'tone', 'pillars', 'what_works', 'competitor_insights'],
      propertyOrdering: ['niche', 'audience', 'tone', 'pillars', 'what_works', 'competitor_insights'],
    },
    ideas: IDEAS_SCHEMA.properties.ideas,
  },
  required: ['analysis', 'ideas'],
  propertyOrdering: ['analysis', 'ideas'],
};

/** Google Search grounded research of competitors and current trends. Returns { text, sources }. */
async function searchResearch(ai, model, { profile, niche, competitors }) {
  const lines = [
    'You are researching content for a Bangladeshi Facebook Page. Use Google Search.',
    `Page: ${profile.name} (${profile.category}). Niche: ${niche}.`,
    profile.about || profile.description ? `About: ${profile.about || profile.description}` : '',
    competitors.length
      ? `Competitors to study (Facebook pages, brands or websites): ${competitors.join('; ')}`
      : 'Find 3-5 similar Bangladeshi Facebook pages, brands or websites in this niche and study them.',
    '',
    'Report briefly (bullet points):',
    '1. What competitors post about and which themes seem to get attention.',
    '2. Topics, questions and seasonal events trending in Bangladesh for this niche in the next 2-3 weeks.',
    '3. Content gaps this page could fill.',
  ].filter(Boolean);
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: lines.join('\n') }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.7 },
  });
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = [];
  for (const chunk of chunks) {
    if (chunk.web?.uri && !sources.some((item) => item.url === chunk.web.uri)) sources.push({ title: chunk.web.title || chunk.web.uri, url: chunk.web.uri });
  }
  return { text: (response.text || '').slice(0, 8000), sources: sources.slice(0, 12) };
}

/**
 * Auto research: analyses the page (profile + posts with engagement), optionally researches
 * competitors and trends with Google Search, and suggests ideas in the page's style.
 * Returns { analysis, ideas, sources, searchUsed, searchError }.
 */
export async function researchPageIdeas({ apiKey, model, profile, posts, niche, competitors = [], avoidTopics = [], count = 10, useSearch = true }) {
  const ai = getClient(apiKey);
  const modelName = (model || config.gemini.model || 'gemini-3.8-flash').trim();

  let research = { text: '', sources: [] };
  let searchError = null;
  if (useSearch) {
    try {
      research = await searchResearch(ai, modelName, { profile, niche, competitors });
    } catch (error) {
      searchError = readableApiError(error);
      console.warn(`[gemini] Google Search research unavailable: ${searchError}`);
    }
  }

  const top = [...posts].sort((a, b) => b.score - a.score).slice(0, 8);
  const recent = posts.slice(0, 10);
  const fmt = (post) => `- [${post.reactions} রিঅ্যাকশন, ${post.comments} কমেন্ট, ${post.shares} শেয়ার] ${post.message.replace(/\s+/g, ' ').slice(0, 300)}`;
  const lines = [
    `পেজ: ${profile.name} | ক্যাটাগরি: ${profile.category} | ফলোয়ার: ${profile.followers ?? 'অজানা'}`,
    profile.about ? `পেজের বিবরণ: ${profile.about}` : '',
    profile.description ? `বিস্তারিত: ${profile.description.slice(0, 600)}` : '',
    niche ? `বর্তমান নিশ (ভুল হলে ঠিক করো): ${niche}` : '',
    '',
    top.length ? 'সবচেয়ে বেশি এনগেজমেন্ট পাওয়া পোস্ট:' : 'এই পেজে এখনো বিশ্লেষণযোগ্য পোস্ট নেই।',
    ...top.map(fmt),
    '',
    recent.length ? 'সাম্প্রতিক পোস্ট:' : '',
    ...recent.map(fmt),
    '',
    research.text ? `প্রতিযোগী ও ট্রেন্ড গবেষণা (গুগল সার্চ থেকে):\n${research.text}` : '',
    '',
    'কাজ:',
    '১. পেজটি বিশ্লেষণ করো: বিষয়বস্তু (নিশ), দর্শক, লেখার সুর, কনটেন্টের মূল স্তম্ভ, কোন ধরনের পোস্ট বেশি সাড়া পায়, এবং প্রতিযোগী/ট্রেন্ড থেকে শিক্ষা।',
    `২. এই বিশ্লেষণের ভিত্তিতে ${count}টি নতুন পোস্ট আইডিয়া দাও যা পেজের সুরের সাথে মেলে এবং বেশি সাড়া পাওয়া পোস্টের ধরন অনুসরণ করে।`,
    avoidTopics.length ? `এই বিষয়গুলো আগেই ব্যবহৃত/প্রস্তাবিত, এগুলো বা কাছাকাছি কিছু দেবে না:\n${avoidTopics.slice(0, 80).map((topic, index) => `${index + 1}. ${topic}`).join('\n')}` : '',
  ].filter((line) => line !== undefined);

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await callModel(ai, {
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: lines.join('\n') }] }],
        config: { systemInstruction: SYSTEM_INSTRUCTION, responseMimeType: 'application/json', responseSchema: RESEARCH_SCHEMA, temperature: 0.9 },
      });
      if (!response.text) throw new Error('Gemini returned no research.');
      const parsed = JSON.parse(stripCodeFences(response.text));
      const ideas = (parsed.ideas || [])
        .map((idea) => ({
          topic: String(idea.topic || '').trim().slice(0, 500),
          angle: String(idea.angle || '').trim().slice(0, 2000),
          category: String(idea.category || '').trim().slice(0, 150),
        }))
        .filter((idea) => idea.topic)
        .slice(0, count);
      const a = parsed.analysis || {};
      const list = (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : []);
      return {
        analysis: {
          niche: String(a.niche || '').trim().slice(0, 1000),
          audience: String(a.audience || '').trim().slice(0, 500),
          tone: String(a.tone || '').trim().slice(0, 500),
          pillars: list(a.pillars),
          what_works: list(a.what_works),
          competitor_insights: list(a.competitor_insights),
        },
        ideas,
        sources: research.sources,
        searchUsed: Boolean(research.text),
        searchError,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof SyntaxError || /no research/.test(error.message)) continue;
      if (isRetryableApiError(error)) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new Error(`Gemini request failed (${modelName}): ${readableApiError(error)}`);
    }
  }
  throw new Error(`Gemini research failed (${modelName}): ${lastError ? readableApiError(lastError) : 'unknown error'}`);
}

const STYLE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    layout: { type: Type.STRING, enum: ['centered', 'left', 'card', 'split', 'minimal'], description: 'Closest text layout of the sample.' },
    background: { type: Type.STRING, enum: ['glow', 'gradient', 'solid'] },
    decoration: { type: Type.STRING, enum: ['classic', 'rings', 'shapes', 'dots', 'none'] },
    badge: { type: Type.STRING, enum: ['pill', 'tag', 'none'], description: 'How a small category label looks (or none).' },
    corner: { type: Type.STRING, enum: ['rounded', 'sharp'] },
    weight: { type: Type.STRING, enum: ['600', '700', '800'], description: 'Headline boldness.' },
    primary: { type: Type.STRING, description: 'Main background colour, hex like #112233.' },
    secondary: { type: Type.STRING, description: 'Second background colour for gradients, hex.' },
    accent: { type: Type.STRING, description: 'Highlight colour for keywords, lines and badges, hex.' },
    text: { type: Type.STRING, description: 'Main text colour with good contrast on the background, hex.' },
    muted: { type: Type.STRING, description: 'Secondary text colour, hex.' },
    description: { type: Type.STRING, description: 'One English sentence describing the design style.' },
  },
  required: ['layout', 'background', 'decoration', 'badge', 'corner', 'weight', 'primary', 'secondary', 'accent', 'text', 'muted', 'description'],
};

function imagePart(image) {
  return { inlineData: { mimeType: image.mime, data: image.buffer.toString('base64') } };
}

/** Reads a sample banner and returns its colour palette and layout style (for the built-in template). */
export async function analyzeDesignStyle({ apiKey, model, image }) {
  const ai = getClient(apiKey);
  const modelName = (model || config.gemini.model || 'gemini-3.8-flash').trim();
  try {
    const response = await callModel(ai, {
      model: modelName,
      contents: [{
        role: 'user',
        parts: [
          imagePart(image),
          { text: 'This is a sample social media banner. Describe its visual style so we can design similar 1080x1080 banners: pick the closest layout, background type, decoration, badge style, corners and headline weight, and extract the colour palette as hex colours. Make sure text colours have strong contrast against the background.' },
        ],
      }],
      config: { responseMimeType: 'application/json', responseSchema: STYLE_SCHEMA, temperature: 0.2 },
    });
    return JSON.parse(stripCodeFences(response.text || '{}'));
  } catch (error) {
    throw Object.assign(new Error(`Could not read the design: ${readableApiError(error)}`), { statusCode: 400 });
  }
}

/** Asks Gemini to recreate a sample banner as an HTML/CSS template with placeholders. */
export async function recreateDesignTemplate({ apiKey, model, image, feedback = '' }) {
  const ai = getClient(apiKey);
  const modelName = (model || config.gemini.model || 'gemini-3.8-flash').trim();
  const rules = [
    'Recreate the design of this sample social media banner as ONE self-contained HTML document for a 1080x1080 px banner.',
    'Requirements:',
    '- html and body exactly 1080px wide and 1080px tall, overflow hidden, margin 0. All CSS inside one <style> tag. No JavaScript.',
    '- Match the sample: layout, colours (hex), shapes, decorations, spacing and overall feel. Draw decorations with CSS only (gradients, borders, pseudo-elements). No external images.',
    '- Font: load Hind Siliguri from Google Fonts with a <link> to https://fonts.googleapis.com and use font-family: "Hind Siliguri", "Noto Sans Bengali", sans-serif for all text. Line-height at least 1.35 for Bengali text.',
    '- Use these placeholders exactly where the text/elements go (they will be replaced with Bangla text):',
    '  {{HEADLINE}} - the main headline, inside an element with data-fit="headline" (big, bold, 70-110px).',
    '  {{SUBHEADLINE}} - a supporting sentence, inside an element with data-fit="subheadline".',
    '  {{BADGE}} - a short category label.',
    '  {{BRAND_NAME}} - the brand name.  {{BRAND_HANDLE}} - the page handle like @page.',
    '  {{LOGO_HTML}} - the logo element (a 76px square); give its container a fixed size.',
    '- {{HEADLINE}} may contain a <span class="hl"> for highlighted words: style .hl with the accent colour.',
    '- Leave enough room so a 2-3 line headline fits without overlapping other elements.',
    feedback ? `- Fix this problem from the previous attempt: ${feedback}` : '',
    'Return JSON: {"html": "<!doctype html>..."}',
  ].filter(Boolean).join('\n');
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [imagePart(image), { text: rules }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: { type: Type.OBJECT, properties: { html: { type: Type.STRING } }, required: ['html'] },
        temperature: 0.4,
      },
    });
    const html = String(JSON.parse(stripCodeFences(response.text || '{}')).html || '');
    if (!html.includes('{{HEADLINE}}') || !html.includes('{{SUBHEADLINE}}')) throw new Error('The template is missing the headline or subheadline placeholder.');
    if (html.length > 80000) throw new Error('The template is too large.');
    return html;
  } catch (error) {
    throw Object.assign(new Error(`Could not recreate the design: ${readableApiError(error)}`), { statusCode: 400 });
  }
}

const imageModelCache = new Map(); // apiKey -> model name

/** Finds a Gemini model this key can use to edit images (e.g. "...-flash-image"). */
async function findImageModel(ai, apiKey) {
  if (imageModelCache.has(apiKey)) return imageModelCache.get(apiKey);
  const names = [];
  const pager = await ai.models.list({ config: { pageSize: 200 } });
  for await (const model of pager) {
    const name = String(model.name || '').replace(/^models\//, '');
    const actions = model.supportedActions || model.supportedGenerationMethods || [];
    if (/image/i.test(name) && !/imagen/i.test(name) && (!actions.length || actions.includes('generateContent'))) names.push(name);
  }
  // Prefer the newest "flash-image" style model.
  names.sort((a, b) => Number(/flash-image/.test(b)) - Number(/flash-image/.test(a)) || b.localeCompare(a, undefined, { numeric: true }));
  const chosen = names[0] || null;
  imageModelCache.set(apiKey, chosen);
  return chosen;
}

/**
 * Removes all text and logos from a sample banner, keeping its background (flowers, frames, colours),
 * as a square image. Returns { buffer, mime, model }.
 */
export async function cleanBackgroundFromSample({ apiKey, image }) {
  const ai = getClient(apiKey);
  let model;
  try {
    model = await findImageModel(ai, apiKey);
  } catch (error) {
    throw Object.assign(new Error(`Could not list Gemini models: ${readableApiError(error)}`), { statusCode: 400 });
  }
  if (!model) {
    throw Object.assign(new Error('Your Gemini key has no image-editing model available. Upload a background without text instead.'), { statusCode: 400 });
  }
  const prompt = [
    'Edit this social media banner image.',
    'Remove ALL text, letters, numbers, quotes, logos, icons and website names completely.',
    'Keep everything else exactly as it is: the background colours, flowers, textures, soft lighting, frame lines and decorative borders.',
    'Where a logo interrupted a frame line, leave the gap empty (no logo). Fill removed areas naturally so it looks like the clean original background.',
    'Output a square 1:1 image: extend the background naturally on the shorter sides if needed. No new text or objects.',
  ].join(' ');
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [imagePart(image), { text: prompt }] }],
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    const out = parts.find((part) => part.inlineData?.data);
    if (!out) throw new Error(response.text ? `The model answered without an image: ${response.text.slice(0, 200)}` : 'The model returned no image.');
    return { buffer: Buffer.from(out.inlineData.data, 'base64'), mime: out.inlineData.mimeType || 'image/png', model };
  } catch (error) {
    throw Object.assign(new Error(`Could not clean the sample (${model}): ${readableApiError(error)}`), { statusCode: 400 });
  }
}
