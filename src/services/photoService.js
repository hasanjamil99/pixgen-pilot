import axios from 'axios';
import * as repo from '../db/repository.js';

/*
 * Free stock photos (Pexels) used as banner backgrounds. The super admin adds one Pexels API key
 * (Admin → Platform settings); PEXELS_API_KEY in .env is the fallback.
 */

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function getPexelsKey() {
  const saved = await repo.getPlatformSettings();
  return saved.pexels_api_key || process.env.PEXELS_API_KEY || null;
}

/** Finds a photo for the query. `seed` picks a different result for different posts. */
export async function searchPhoto(query, { seed = 0, apiKey } = {}) {
  const key = apiKey || (await getPexelsKey());
  if (!key || !query) return null;
  const { data } = await axios.get('https://api.pexels.com/v1/search', {
    params: { query, orientation: 'square', per_page: 15, size: 'large' },
    headers: { Authorization: key },
    timeout: 20000,
  });
  const photos = data.photos || [];
  if (photos.length === 0) return null;
  const photo = photos[Math.abs(seed) % photos.length];
  return {
    url: photo.src?.large2x || photo.src?.large || photo.src?.original,
    photographer: photo.photographer,
    pexelsUrl: photo.url,
    alt: photo.alt || '',
  };
}

/** Checks a Pexels key with a tiny search. */
export async function testPexelsKey(apiKey) {
  try {
    const photo = await searchPhoto('flowers', { apiKey });
    return Boolean(photo);
  } catch (error) {
    const status = error.response?.status;
    throw Object.assign(new Error(status === 401 || status === 403 ? 'Pexels rejected this API key.' : `Pexels error: ${error.message}`), { statusCode: 400 });
  }
}

/** Downloads a photo (only from Pexels' image CDN) as a data URL for the renderer. */
export async function photoDataUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'images.pexels.com') return null;
  const response = await axios.get(parsed.toString(), { responseType: 'arraybuffer', timeout: 30000, maxContentLength: MAX_PHOTO_BYTES });
  const mime = String(response.headers['content-type'] || 'image/jpeg').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
  return `data:${mime};base64,${Buffer.from(response.data).toString('base64')}`;
}
