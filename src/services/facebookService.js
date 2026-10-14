import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config/env.js';

// business_management lets us also list Pages that the user manages only through a Business Portfolio.
export const FB_SCOPES = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'business_management'];

export class FacebookError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FacebookError';
    this.details = details;
  }
}

function graphUrl(pathname) {
  return `https://graph.facebook.com/${config.facebook.graphVersion}/${pathname}`;
}

/** Converts an axios error into a readable FacebookError and logs the full Graph API response. */
function toFacebookError(error, action) {
  const fbError = error.response?.data?.error;
  if (fbError) {
    const details = {
      status: error.response.status,
      type: fbError.type,
      code: fbError.code,
      subcode: fbError.error_subcode,
      fbtraceId: fbError.fbtrace_id,
    };
    console.error(`[facebook] ${action} failed:`, JSON.stringify({ message: fbError.message, ...details }));
    let hint = '';
    if (fbError.code === 190) hint = ' The access token is invalid or expired; connect the page again.';
    else if (fbError.code === 200 || fbError.code === 10) hint = ` The token is missing a permission (${FB_SCOPES.join(', ')}).`;
    else if (fbError.code === 368 || fbError.code === 32 || fbError.code === 4) hint = ' Facebook is rate limiting or blocking posts for now; try again later.';
    const userMessage = fbError.error_user_msg ? ` ${fbError.error_user_msg}` : '';
    const code = `${fbError.code}${fbError.error_subcode ? `/${fbError.error_subcode}` : ''}`;
    return new FacebookError(`Facebook ${action} failed (code ${code}): ${fbError.message}.${userMessage}${hint}`, details);
  }
  console.error(`[facebook] ${action} failed:`, error.message);
  return new FacebookError(`Facebook ${action} failed: ${error.message}`, { status: error.response?.status });
}

async function graphGet(pathname, params, action) {
  try {
    const { data } = await axios.get(graphUrl(pathname), { params, timeout: 20000 });
    return data;
  } catch (error) {
    throw toFacebookError(error, action);
  }
}

export function facebookPostUrl(fbPostId) {
  return fbPostId ? `https://www.facebook.com/${encodeURIComponent(fbPostId)}` : null;
}

/**
 * Uploads a PNG with its caption to the Page's photos edge, which creates a feed post.
 * Returns { photoId, postId, url }.
 */
export async function publishPhoto({ pageId, accessToken, imagePath, caption }) {
  if (!pageId || !accessToken) throw new FacebookError('This page is not connected to Facebook yet. Connect it under Facebook.');
  if (!imagePath || !fs.existsSync(imagePath)) throw new FacebookError(`Banner image not found: ${imagePath}`);

  const form = new FormData();
  form.append('source', fs.createReadStream(imagePath), { filename: path.basename(imagePath), contentType: 'image/png' });
  form.append('message', caption || '');
  form.append('published', 'true');
  // Sent in the body rather than the URL so the token never lands in proxy logs.
  form.append('access_token', accessToken);

  try {
    const { data } = await axios.post(graphUrl(`${encodeURIComponent(pageId)}/photos`), form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000,
    });
    const postId = data.post_id || data.id;
    console.log(`[facebook] Published photo ${data.id} (post ${postId}) to page ${pageId}.`);
    return { photoId: data.id, postId, url: facebookPostUrl(postId) };
  } catch (error) {
    throw toFacebookError(error, 'publish');
  }
}

/** Checks a page token can read its page. Returns { id, name }. */
export async function checkPageConnection({ pageId, accessToken }) {
  if (!pageId || !accessToken) throw new FacebookError('This page is not connected to Facebook yet.');
  const data = await graphGet(encodeURIComponent(pageId), { fields: 'id,name', access_token: accessToken }, 'connection check');
  return { id: data.id, name: data.name };
}

const PAGE_FIELDS = 'id,name,category,access_token,tasks,picture{url}';
const MAX_PAGES = 500;

/** Follows Graph API paging until there is no next page (or MAX_PAGES items). */
async function graphGetAll(pathname, params, action) {
  const items = [];
  let data = await graphGet(pathname, { ...params, limit: 100 }, action);
  items.push(...(data.data || []));
  while (data.paging?.next && items.length < MAX_PAGES) {
    try {
      ({ data } = await axios.get(data.paging.next, { timeout: 20000 }));
    } catch (error) {
      throw toFacebookError(error, action);
    }
    items.push(...(data.data || []));
  }
  return items;
}

function toPage(page, business = null) {
  return {
    id: page.id,
    name: page.name,
    category: page.category || null,
    picture: page.picture?.data?.url || null,
    business,
    canPost: Boolean(page.access_token) && (!page.tasks || page.tasks.includes('CREATE_CONTENT') || page.tasks.includes('MANAGE')),
    accessToken: page.access_token || null,
  };
}

/**
 * Pages the user can post to, with their page tokens:
 *  - Pages where the user has a direct role (me/accounts), and
 *  - Pages owned by, or shared with, the user's Business Portfolios (needs business_management).
 */
export async function listManagedPages(userToken) {
  // A Page token fails here with error 100; inspectToken relies on that.
  const direct = await graphGetAll('me/accounts', { fields: PAGE_FIELDS, access_token: userToken }, 'listing pages');
  const pages = new Map(direct.map((page) => [page.id, toPage(page)]));

  let businesses = [];
  try {
    businesses = await graphGetAll('me/businesses', { fields: 'id,name', access_token: userToken }, 'listing business portfolios');
  } catch (error) {
    // No business_management permission or no portfolios: direct pages only.
    console.warn(`[facebook] Business portfolios not available: ${error.message}`);
  }

  for (const business of businesses) {
    for (const edge of ['owned_pages', 'client_pages']) {
      try {
        const list = await graphGetAll(`${business.id}/${edge}`, { fields: PAGE_FIELDS, access_token: userToken }, `listing ${business.name} pages`);
        for (const page of list) {
          const existing = pages.get(page.id);
          if (!existing || (!existing.accessToken && page.access_token)) pages.set(page.id, toPage(page, business.name));
        }
      } catch (error) {
        console.warn(`[facebook] Could not read ${edge} of business ${business.id}: ${error.message}`);
      }
    }
  }

  return [...pages.values()].sort((a, b) => Number(b.canPost) - Number(a.canPost) || a.name.localeCompare(b.name));
}

/**
 * Works out what a pasted token is.
 * Returns { type: 'page', page: {id, name} } or { type: 'user', pages: [...] }.
 */
export async function inspectToken(token) {
  const me = await graphGet('me', { fields: 'id,name', access_token: token }, 'token check');
  try {
    const pages = await listManagedPages(token);
    return { type: 'user', user: me, pages };
  } catch (error) {
    // A Page token has no "accounts" edge: Graph answers with error 100 for it.
    if (error.details?.code === 100) return { type: 'page', page: { id: me.id, name: me.name } };
    throw error;
  }
}

/** Short-lived user token → long-lived (≈60 days). Page tokens taken from it never expire. */
export async function exchangeForLongLivedToken({ appId, appSecret, token }) {
  const data = await graphGet(
    'oauth/access_token',
    { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token },
    'token exchange',
  );
  return { token: data.access_token, expiresIn: data.expires_in || null };
}

/** Facebook Login URL. Apps using "Facebook Login for Business" pass a configuration ID instead of scopes. */
export function buildOAuthUrl({ appId, redirectUri, state, configId }) {
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state, response_type: 'code' });
  if (configId) params.set('config_id', configId);
  else params.set('scope', FB_SCOPES.join(','));
  return `https://www.facebook.com/${config.facebook.graphVersion}/dialog/oauth?${params}`;
}

export async function exchangeCodeForToken({ appId, appSecret, redirectUri, code }) {
  const data = await graphGet(
    'oauth/access_token',
    { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
    'login',
  );
  return data.access_token;
}

/**
 * The page's profile and its recent posts with engagement, for content analysis.
 * Uses pages_read_engagement. Returns { profile, posts: [{ message, createdAt, url, reactions, comments, shares, score }] }.
 */
export async function fetchPageContent({ pageId, accessToken, limit = 50 }) {
  const profile = await graphGet(
    encodeURIComponent(pageId),
    { fields: 'name,about,description,category,fan_count,followers_count,website', access_token: accessToken },
    'reading the page profile',
  );
  let raw = [];
  try {
    const data = await graphGet(
      `${encodeURIComponent(pageId)}/posts`,
      {
        fields: 'message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
        limit: Math.min(limit, 100),
        access_token: accessToken,
      },
      'reading page posts',
    );
    raw = data.data || [];
  } catch (error) {
    console.warn(`[facebook] Could not read posts of page ${pageId}: ${error.message}`);
  }
  const posts = raw
    .filter((post) => post.message)
    .map((post) => {
      const reactions = post.reactions?.summary?.total_count || 0;
      const comments = post.comments?.summary?.total_count || 0;
      const shares = post.shares?.count || 0;
      return {
        message: post.message.slice(0, 600),
        createdAt: post.created_time,
        url: post.permalink_url || null,
        reactions,
        comments,
        shares,
        score: reactions + comments * 3 + shares * 5,
      };
    });
  return {
    profile: {
      name: profile.name,
      about: profile.about || '',
      description: profile.description || '',
      category: profile.category || '',
      followers: profile.followers_count ?? profile.fan_count ?? null,
      website: profile.website || '',
    },
    posts,
  };
}
