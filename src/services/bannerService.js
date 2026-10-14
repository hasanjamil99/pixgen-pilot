import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';
import { config, isValidHttpUrl, isValidHexColor } from '../config/env.js';
import { photoDataUrl } from './photoService.js';

const SIZE = 1080;
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--font-render-hinting=none',
  '--disable-gpu',
  '--hide-scrollbars',
  '--mute-audio',
];

let templateCache = null;
// Renders run one at a time so a small VPS never has two Chromium instances open.
let renderChain = Promise.resolve();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function graphemeLength(text) {
  const segmenter = new Intl.Segmenter('bn', { granularity: 'grapheme' });
  return [...segmenter.segment(text)].length;
}

/** Starting font size from headline length; the in-page fit script shrinks it further if needed. */
export function headlineFontSize(headline) {
  const length = graphemeLength(headline);
  if (length <= 16) return 118;
  if (length <= 24) return 104;
  if (length <= 34) return 92;
  if (length <= 46) return 82;
  if (length <= 60) return 72;
  return 64;
}

/** Colours the last one or two words of the headline with the accent colour. */
function headlineHtml(headline) {
  const words = headline.trim().split(/\s+/);
  if (words.length < 3) return escapeHtml(headline);
  const highlightCount = words.length >= 6 ? 2 : 1;
  const plain = words.slice(0, -highlightCount).join(' ');
  const highlighted = words.slice(-highlightCount).join(' ');
  return `${escapeHtml(plain)} <span class="hl">${escapeHtml(highlighted)}</span>`;
}

const UPLOADS_DIR = 'uploads';
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Absolute path of an uploaded file (/banners/uploads/x.png), or null if the path is not an upload. */
export function resolveUploadPath(webPath) {
  const match = /^\/banners\/uploads\/([\w.-]+)$/.exec(String(webPath || ''));
  return match ? path.join(config.paths.banners, UPLOADS_DIR, match[1]) : null;
}

/** Saves an uploaded image under public/banners/uploads and returns its web path. */
export async function saveUpload(buffer, ext, prefix) {
  const dir = path.join(config.paths.banners, UPLOADS_DIR);
  await fs.mkdir(dir, { recursive: true });
  const name = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, name), buffer);
  return `/banners/${UPLOADS_DIR}/${name}`;
}

export async function deleteUpload(webPath) {
  const filePath = resolveUploadPath(webPath);
  if (filePath) await fs.unlink(filePath).catch(() => {});
}

/** Uploaded logos are embedded as data URLs (the banner page has no origin to load them from). */
async function logoSource(logoUrl) {
  const filePath = resolveUploadPath(logoUrl);
  if (filePath) {
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      return `data:${MIME_BY_EXT[ext] || 'image/png'};base64,${data.toString('base64')}`;
    } catch {
      return null;
    }
  }
  return logoUrl && isValidHttpUrl(logoUrl) ? logoUrl : null;
}

function logoHtml(brandName, logoUrl) {
  const initial = escapeHtml([...new Intl.Segmenter('bn', { granularity: 'grapheme' }).segment(brandName.trim() || 'B')][0].segment);
  if (logoUrl) {
    // If the image fails to load, fall back to the initial.
    return `<div class="brand-logo" data-initial="${initial}"><img src="${escapeHtml(logoUrl)}" alt="" onerror="this.parentNode.textContent=this.parentNode.dataset.initial"></div>`;
  }
  return `<div class="brand-logo">${initial}</div>`;
}

async function loadTemplate() {
  if (!templateCache) {
    templateCache = await fs.readFile(path.join(config.paths.templates, 'banner.html'), 'utf8');
  }
  return templateCache;
}

export const STYLE_OPTIONS = Object.freeze({
  layout: ['centered', 'left', 'card', 'split', 'minimal'],
  background: ['glow', 'gradient', 'solid'],
  decoration: ['classic', 'rings', 'shapes', 'dots', 'none'],
  badge: ['pill', 'tag', 'none'],
  corner: ['rounded', 'sharp'],
  weight: ['600', '700', '800'],
});

const pick = (value, list, fallback) => (list.includes(String(value)) ? String(value) : fallback);

/** Cleans a style object (from Gemini or the dashboard) into safe, known values. */
export function normalizeStyle(style = {}) {
  const color = (value, fallback) => (isValidHexColor(value) ? value : fallback);
  return {
    layout: pick(style.layout, STYLE_OPTIONS.layout, 'centered'),
    background: pick(style.background, STYLE_OPTIONS.background, 'glow'),
    decoration: pick(style.decoration, STYLE_OPTIONS.decoration, 'classic'),
    badge: pick(style.badge, STYLE_OPTIONS.badge, 'pill'),
    corner: pick(style.corner, STYLE_OPTIONS.corner, 'rounded'),
    weight: pick(style.weight, STYLE_OPTIONS.weight, '700'),
    primary: color(style.primary, null),
    secondary: color(style.secondary, null),
    accent: color(style.accent, null),
    text: color(style.text, null),
    muted: color(style.muted, null),
    description: typeof style.description === 'string' ? style.description.slice(0, 500) : '',
  };
}

// Shrinks the element marked data-fit="headline" (or the largest heading) until the page fits 1080×1080.
const FIT_SCRIPT = `<script>window.__fitText=function(){var h=document.querySelector('[data-fit="headline"]')||document.querySelector('h1');var s=document.querySelector('[data-fit="subheadline"]');var root=document.body;function over(){return root.scrollHeight>1082||root.scrollWidth>1082||(h&&h.scrollWidth>h.clientWidth+2);}var g=0;while(h&&over()&&g<60){var f=parseFloat(getComputedStyle(h).fontSize);if(f<=48)break;h.style.fontSize=(f-3)+'px';g++;}g=0;while(s&&over()&&g<30){var f2=parseFloat(getComputedStyle(s).fontSize);if(f2<=26)break;s.style.fontSize=(f2-2)+'px';g++;}return{};};</script>`;

/** Removes scripts, event handlers and outside resources (except Google Fonts) from a custom template. */
export function sanitizeTemplate(html) {
  let out = String(html || '');
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/javascript:/gi, '');
  out = out.replace(/<(iframe|object|embed|form|input|meta[^>]+http-equiv)[\s\S]*?>/gi, '');
  // Only Google Fonts may be loaded from outside; every other external URL is dropped.
  out = out.replace(/(href|src)\s*=\s*"(https?:)?\/\/(?!fonts\.googleapis\.com|fonts\.gstatic\.com)[^"]*"/gi, '$1=""');
  out = out.replace(/url\(\s*['"]?(https?:)?\/\/(?!fonts\.g)[^)]*\)/gi, 'none');
  out = out.replace(/@import\s+url\(\s*['"]?(?!https:\/\/fonts\.googleapis\.com)[^)]*\)\s*;?/gi, '');
  return out;
}

/** Settings for the "My background image" design, cleaned with safe defaults. */
export function normalizeImageStyle(style = {}, fallback = {}) {
  const color = (value, def) => (isValidHexColor(value) ? value : def);
  const num = (value, min, max, def) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
  };
  const accent = color(style.accent, color(fallback.accent, '#CF007A'));
  return {
    headline_color: color(style.headline_color, accent),
    text_color: color(style.text_color, color(fallback.text, '#111111')),
    accent,
    brand_color: color(style.brand_color, accent),
    logo_position: pick(style.logo_position, ['top-center', 'top-left', 'top-right', 'none'], 'top-center'),
    logo_size: num(style.logo_size, 50, 220, 110),
    show_brand_name: style.show_brand_name !== false,
    show_badge: Boolean(style.show_badge),
    show_footer: style.show_footer !== false,
    footer_text: typeof style.footer_text === 'string' ? style.footer_text.slice(0, 80) : '',
    align: pick(style.align, ['center', 'left'], 'center'),
    box_top: num(style.box_top, 10, 60, 30),
    box_height: num(style.box_height, 20, 75, 50),
    box_width: num(style.box_width, 40, 92, 72),
    overlay: num(style.overlay, 0, 0.9, 0),
    text_scale: num(style.text_scale, 0.6, 1.4, 1),
    fit: pick(style.fit, ['cover', 'stretch'], 'cover'),
    erase: Boolean(style.erase),
    erase_color: color(style.erase_color, '#ffffff'),
  };
}

async function uploadDataUrl(webPath) {
  const filePath = resolveUploadPath(webPath);
  if (!filePath) return null;
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return `data:${MIME_BY_EXT[ext] || 'image/png'};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

const TYPES = ['statement', 'quote', 'tips'];
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** Template values shared by every design for the post type (statement / quote / tips). */
function typeValues({ type, points, subheadline }) {
  const kind = TYPES.includes(type) ? type : 'statement';
  const list = kind === 'tips' ? (points || []).slice(0, 4) : [];
  let sub = subheadline || '';
  if (kind === 'quote' && sub && !/^[—–-]/.test(sub.trim())) sub = `— ${sub.trim()}`;
  return {
    kind,
    sub,
    TYPE_CLASS: `type-${kind}`,
    POINTS_HTML: list.map((point, index) => `<li><span class="n">${BN_DIGITS[index + 1]}</span><span>${escapeHtml(point)}</span></li>`).join(''),
    POINTS_SIZE: String(list.length >= 4 ? 38 : 42),
  };
}

let imageTemplateCache = null;

async function buildImageBannerHtml({ badge, headline, subheadline, settings, type, points, background: chosen }) {
  if (!imageTemplateCache) imageTemplateCache = await fs.readFile(path.join(config.paths.templates, 'banner-image.html'), 'utf8');
  const st = normalizeImageStyle(settings.image_style || {}, settings.banner_style || {});
  const isPhoto = chosen?.kind === 'photo';
  if (chosen?.kind === 'brand') {
    // Each rotating background keeps its own fit / cover-old-text settings.
    if (chosen.fit) st.fit = chosen.fit;
    if (chosen.erase !== undefined) st.erase = Boolean(chosen.erase);
  }
  const background = isPhoto
    ? await photoDataUrl(chosen.url).catch(() => null)
    : await uploadDataUrl(chosen?.kind === 'brand' ? chosen.path : settings.background_image_path);
  const tv = typeValues({ type, points, subheadline });
  const logo = await logoSource(settings.brand_logo_url);
  const scale = st.text_scale;
  const values = {
    BACKGROUND: background ? `url("${background}")` : 'none',
    HEADLINE_COLOR: st.headline_color,
    TEXT_COLOR: st.text_color,
    ACCENT_COLOR: st.accent,
    BRAND_COLOR: st.brand_color,
    HEADLINE_SIZE: String(Math.round((headlineFontSize(headline) - (tv.kind === 'tips' ? 28 : 18)) * scale)),
    SUB_SIZE: String(Math.round(46 * scale)),
    LOGO_SIZE: String(st.logo_size),
    BOX_TOP: String(st.box_top),
    BOX_HEIGHT: String(st.box_height),
    BOX_WIDTH: String(st.box_width),
    OVERLAY: String(st.overlay),
    BG_SIZE: st.fit === 'stretch' ? '100% 100%' : 'cover',
    ERASE_CLASS: st.erase && !isPhoto ? '' : 'hidden',
    PHOTO_CLASS: isPhoto ? 'photo' : '',
    TYPE_CLASS: tv.TYPE_CLASS,
    POINTS_HTML: tv.POINTS_HTML,
    POINTS_SIZE: String(Math.round(Number(tv.POINTS_SIZE) * scale)),
    ERASE_COLOR: st.erase_color,
    LOGO_POSITION: st.logo_position,
    BRAND_NAME_CLASS: st.show_brand_name ? '' : 'hide-name',
    LOGO_IMG: logo ? `<img src="${escapeHtml(logo)}" alt="">` : '',
    BRAND_NAME: escapeHtml(settings.brand_name),
    ALIGN: st.align,
    BADGE_CLASS: st.show_badge ? '' : 'hidden',
    BADGE: escapeHtml(badge),
    HEADLINE: headlineHtml(headline),
    SUBHEADLINE: escapeHtml(tv.sub),
    FOOTER_CLASS: st.show_footer && (st.footer_text || settings.brand_handle) ? '' : 'hidden',
    FOOTER_TEXT: escapeHtml(st.footer_text || settings.brand_handle || ''),
  };
  return imageTemplateCache.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in values ? values[key] : match));
}

export async function buildBannerHtml({ badge, headline, subheadline, settings, type = 'statement', points = [], background = null }) {
  if (background?.kind === 'photo' || background?.kind === 'brand' || (settings.banner_mode === 'image' && settings.background_image_path)) {
    return buildImageBannerHtml({ badge, headline, subheadline, settings, type, points, background });
  }
  const tv = typeValues({ type, points, subheadline });
  const primary = isValidHexColor(settings.primary_color) ? settings.primary_color : '#0f172a';
  const accent = isValidHexColor(settings.accent_color) ? settings.accent_color : '#38bdf8';
  const mode = settings.banner_mode || 'default';
  const textValues = {
    BADGE: escapeHtml(badge),
    HEADLINE: headlineHtml(headline),
    SUBHEADLINE: escapeHtml(tv.sub),
    BRAND_NAME: escapeHtml(settings.brand_name),
    BRAND_HANDLE: escapeHtml(settings.brand_handle),
    LOGO_HTML: logoHtml(settings.brand_name || '', await logoSource(settings.brand_logo_url)),
    PRIMARY_COLOR: primary,
    ACCENT_COLOR: accent,
    TYPE_CLASS: tv.TYPE_CLASS,
    POINTS_HTML: tv.POINTS_HTML,
    POINTS_SIZE: tv.POINTS_SIZE,
  };

  if (mode === 'custom' && settings.custom_template) {
    const filled = sanitizeTemplate(settings.custom_template).replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in textValues ? textValues[key] : ''));
    return filled.includes('</body>') ? filled.replace('</body>', `${FIT_SCRIPT}</body>`) : `${filled}${FIT_SCRIPT}`;
  }

  const style = normalizeStyle(mode === 'style' ? settings.banner_style || {} : {});
  const base = style.primary || primary;
  const values = {
    ...textValues,
    PRIMARY_COLOR: base,
    ACCENT_COLOR: style.accent || accent,
    SECONDARY_COLOR: style.secondary || `color-mix(in srgb, ${base} 70%, ${style.accent || accent})`,
    TEXT_COLOR: style.text || '#f8fafc',
    MUTED_COLOR: style.muted || `color-mix(in srgb, ${style.text || '#f8fafc'} 72%, ${base})`,
    HEADLINE_WEIGHT: style.weight,
    HEADLINE_SIZE: String(headlineFontSize(headline) - (style.layout === 'card' || style.layout === 'split' ? 8 : 0) - (tv.kind === 'tips' ? 24 : 0)),
    STYLE_CLASSES: mode === 'style'
      ? `layout-${style.layout} bg-${style.background} deco-${style.decoration} badge-${style.badge} corner-${style.corner}`
      : 'layout-centered bg-glow deco-classic badge-pill corner-rounded',
  };
  const template = await loadTemplate();
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => (key in values ? values[key] : match));
}

function timestampedName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `banner-${stamp}-${crypto.randomBytes(3).toString('hex')}.png`;
}

async function render({ html, outputPath }) {
  const browser = await puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
    executablePath: config.puppeteerExecutablePath,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 2 });

    try {
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    } catch (error) {
      // Usually a slow logo or font request; the fonts check below decides if the result is usable.
      console.warn(`[banner] Page did not fully settle (${error.message}). Continuing.`);
    }

    // Wait for the Bengali web fonts so conjuncts (যুক্তবর্ণ) are shaped by the right font.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const fontsOk = await page.evaluate(async () => {
      const sample = 'ক্ষ্ম স্ত্র';
      await Promise.allSettled([
        document.fonts.load(`700 80px "Hind Siliguri"`, sample),
        document.fonts.load(`500 40px "Hind Siliguri"`, sample),
      ]);
      await document.fonts.ready;
      return document.fonts.check(`700 80px "Hind Siliguri"`, sample);
    });
    if (!fontsOk) {
      console.warn('[banner] Hind Siliguri did not load (no internet?). Falling back to locally installed Bengali fonts.');
    }

    const fitted = await page.evaluate(() => (typeof window.__fitText === "function" ? window.__fitText() : {}));
    await page.screenshot({ path: outputPath, type: 'png', clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    return { fontsOk, fitted };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Renders the banner to public/banners and returns its absolute file path and its public URL path.
 * `fileName` is optional (defaults to a timestamped name).
 */
export function renderBanner({ badge, headline, subheadline, settings, fileName, type = 'statement', points = [], background = null }) {
  const job = renderChain.then(async () => {
    await fs.mkdir(config.paths.banners, { recursive: true });
    const name = fileName || timestampedName();
    const outputPath = path.join(config.paths.banners, name);
    const html = await buildBannerHtml({ badge, headline, subheadline, settings, type, points, background });
    const started = Date.now();
    const { fontsOk } = await render({ html, outputPath });
    console.log(`[banner] Rendered ${name} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { filePath: outputPath, webPath: `/banners/${name}`, fileName: name, fontsOk };
  });
  renderChain = job.catch(() => {});
  return job;
}

/** Turns a stored web path (/banners/x.png) back into an absolute file path inside public/banners. */
export function resolveBannerPath(webPath) {
  if (!webPath) return null;
  const name = path.basename(String(webPath));
  if (!/^[\w.-]+\.png$/i.test(name)) return null;
  return path.join(config.paths.banners, name);
}

export async function deleteBannerFile(webPath) {
  const filePath = resolveBannerPath(webPath);
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}
