import { isValidCron, isValidHexColor, isValidHttpUrl } from '../config/env.js';

export const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function parseId(value) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id < 1) throw httpError('Invalid id.');
  return id;
}

/** Validates page settings from the dashboard. `partial` allows sending only some fields. */
export function cleanPageSettings(body, { partial = true } = {}) {
  const errors = [];
  const out = {};
  const text = (key, max, { required = false } = {}) => {
    if (body[key] === undefined) {
      if (!partial && required) errors.push(`${key} is required.`);
      return;
    }
    const value = String(body[key] ?? '').trim();
    if (required && !value) errors.push(`${key.replace(/_/g, ' ')} is required.`);
    else if (value.length > max) errors.push(`${key.replace(/_/g, ' ')} must be at most ${max} characters.`);
    else out[key] = value;
  };

  text('name', 150, { required: true });
  text('page_niche', 1000, { required: true });
  text('brand_name', 100, { required: true });
  text('brand_handle', 100);
  text('brand_logo_url', 1000);
  text('cron_schedule', 100, { required: !partial });
  text('primary_color', 7, { required: !partial });
  text('accent_color', 7, { required: !partial });
  if (body.autopilot_enabled !== undefined) out.autopilot_enabled = Boolean(body.autopilot_enabled);
  if (body.auto_research !== undefined) out.auto_research = Boolean(body.auto_research);
  if (body.use_ideas !== undefined) out.use_ideas = Boolean(body.use_ideas);
  if (body.plan_approval !== undefined) {
    if (!['auto', 'manual'].includes(body.plan_approval)) errors.push('Approval must be auto or manual.');
    else out.plan_approval = body.plan_approval;
  }
  if (body.competitors !== undefined) {
    const lines = String(body.competitors ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 15) errors.push('List up to 15 competitors.');
    else if (lines.some((line) => line.length > 300)) errors.push('Each competitor must be at most 300 characters.');
    else out.competitors = lines.join('\n');
  }

  if (out.brand_logo_url && !isValidHttpUrl(out.brand_logo_url) && !/^\/banners\/uploads\/[\w.-]+$/.test(out.brand_logo_url)) {
    errors.push('Logo URL must start with http:// or https:// (or upload a logo file).');
  }
  if (out.cron_schedule && !isValidCron(out.cron_schedule)) errors.push('Cron schedule is not valid (example: 0 10 * * *).');
  if (out.primary_color && !isValidHexColor(out.primary_color)) errors.push('Background color must be a hex color like #0f172a.');
  if (out.accent_color && !isValidHexColor(out.accent_color)) errors.push('Accent color must be a hex color like #38bdf8.');

  if (errors.length) throw httpError(errors.join(' '));
  return out;
}

export function cleanGeminiModel(value) {
  const model = String(value ?? '').trim();
  if (!model || model.length > 100 || !/^[A-Za-z0-9._\-/]+$/.test(model)) throw httpError('Gemini model name is not valid (example: gemini-3.8-flash).');
  return model;
}

const IMAGE_TYPES = [
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/** Decodes a base64 data URL and checks it really is a PNG, JPG or WebP within maxBytes. */
export function decodeImageUpload(dataUrl, { maxBytes = 3 * 1024 * 1024 } = {}) {
  const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) throw httpError('Upload a PNG, JPG or WebP image.');
  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) throw httpError('The image is empty.');
  if (buffer.length > maxBytes) throw httpError(`The image must be at most ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const type = IMAGE_TYPES.find((candidate) => candidate.test(buffer));
  if (!type) throw httpError('Only PNG, JPG and WebP images are supported.');
  return { buffer, ext: type.ext, mime: type.mime };
}
