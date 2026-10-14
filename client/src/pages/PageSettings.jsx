import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { useNavigate, useParams } from 'react-router-dom';
import { Eraser, ImageUp, Palette, RefreshCw, Save, Settings2, Trash2, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { useConfirm } from '../components/Dialog.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, Field, PageHeader, Toggle } from '../components/ui.jsx';
import { usePageById, usePages } from '../pagesContext.jsx';

const CRON_PRESETS = [
  ['0 10 * * *', 'Every day 10:00'],
  ['0 9,18 * * *', '9:00 and 18:00'],
  ['30 20 * * *', 'Every day 20:30'],
  ['0 10 * * 0-4', 'Sun–Thu 10:00'],
];

const FIELDS = ['name', 'page_niche', 'brand_name', 'brand_handle', 'brand_logo_url', 'primary_color', 'accent_color', 'cron_schedule', 'autopilot_enabled'];

function describeCron(expression, timezone) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) return 'Format: minute hour day-of-month month day-of-week.';
  const [minute, hour, dom, month, dow] = parts;
  if (/^\d+$/.test(minute) && /^[\d,]+$/.test(hour) && dom === '*' && month === '*') {
    const times = hour.split(',').map((h) => `${h.padStart(2, '0')}:${minute.padStart(2, '0')}`).join(' and ');
    const days = dow === '*' ? 'every day' : `on days ${dow} (0 = Sunday)`;
    return `Posts ${days} at ${times} (${timezone}).`;
  }
  return `Custom schedule (${timezone}).`;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/** Upload a logo file (or paste a link). Uploaded logos are stored with the app. */
function LogoField({ page, value, onChange, onUploaded }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const preview = value || '';

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toast('The logo must be at most 3 MB.', 'error');
    setBusy(true);
    try {
      const data = await api(`/pages/${page.id}/logo`, { method: 'POST', body: { dataUrl: await readAsDataUrl(file) } });
      onUploaded(data.page.brand_logo_url);
      toast('Logo uploaded.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const remove = async () => {
    try {
      await api(`/pages/${page.id}/logo`, { method: 'DELETE' });
      onUploaded('');
      toast('Logo removed.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div>
      <span className="label">Logo</span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <ImageUp size={22} className="text-slate-400" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn btn-secondary ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            {busy ? <span className="spinner" /> : <ImageUp size={16} />} {preview ? 'Upload a new logo' : 'Upload logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} />
          </label>
          {preview && <button type="button" className="btn btn-danger-soft" onClick={remove}><Trash2 size={16} /> Remove</button>}
        </div>
      </div>
      <p className="hint">PNG, JPG or WebP, up to 3 MB. Square works best. Without a logo the banner shows the first letter of the brand name.</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-slate-500">Or use a link instead</summary>
        <input type="url" className="input mt-2" maxLength={1000} value={value?.startsWith('/banners/') ? '' : value} onChange={(event) => onChange(event.target.value)} placeholder="https://example.com/logo.png" />
      </details>
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="color" className="h-[42px] w-12 shrink-0 cursor-pointer rounded-xl border border-slate-300 bg-white p-1" value={valid ? value : '#000000'} onChange={(event) => onChange(event.target.value)} />
        <input className="input font-mono" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

const STYLE_FIELDS = [
  ['layout', 'Layout', [['centered', 'Centered'], ['left', 'Left aligned'], ['card', 'Card'], ['split', 'Side band'], ['minimal', 'Minimal']]],
  ['background', 'Background', [['glow', 'Glow'], ['gradient', 'Gradient'], ['solid', 'Solid']]],
  ['decoration', 'Decoration', [['classic', 'Grid + rings'], ['rings', 'Rings'], ['shapes', 'Shapes'], ['dots', 'Dots'], ['none', 'None']]],
  ['badge', 'Category label', [['pill', 'Pill'], ['tag', 'Tag'], ['none', 'Hidden']]],
  ['corner', 'Corners', [['rounded', 'Rounded'], ['sharp', 'Sharp']]],
  ['weight', 'Headline weight', [['600', 'Semi-bold'], ['700', 'Bold'], ['800', 'Extra bold']]],
];
const STYLE_COLORS = [['primary', 'Background'], ['secondary', 'Background 2'], ['accent', 'Accent'], ['text', 'Text']];

const IMAGE_COLORS = [['headline_color', 'Headline'], ['text_color', 'Main text'], ['accent', 'Accent (lines, highlights)'], ['brand_color', 'Brand name']];

/** Text styling on top of the brand's own background image. */
function ImageStyleEditor({ value, onApply }) {
  const [st, setSt] = useState(value || {});
  useEffect(() => setSt(value || {}), [value]);
  const set = (key) => (event) => setSt((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const range = (key, label, min, max, step, suffix = '') => (
    <Field label={`${label}: ${st[key] ?? ''}${suffix}`}>
      <input type="range" className="w-full accent-violet-600" min={min} max={max} step={step} value={st[key] ?? min} onChange={(event) => setSt((c) => ({ ...c, [key]: Number(event.target.value) }))} />
    </Field>
  );
  return (
    <div className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="grid gap-3 sm:grid-cols-4">
        {IMAGE_COLORS.map(([key, label]) => (
          <Field key={key} label={label}>
            <div className="flex gap-2">
              <input type="color" className="h-[42px] w-12 shrink-0 cursor-pointer rounded-xl border border-slate-300 bg-white p-1" value={/^#[0-9a-fA-F]{6}$/.test(st[key] || '') ? st[key] : '#000000'} onChange={set(key)} />
              <input className="input font-mono text-xs" value={st[key] || ''} onChange={set(key)} />
            </div>
          </Field>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Logo position">
          <select className="input" value={st.logo_position || 'top-center'} onChange={set('logo_position')}>
            <option value="top-center">Top centre</option>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="none">Hidden</option>
          </select>
        </Field>
        <Field label="Text alignment">
          <select className="input" value={st.align || 'center'} onChange={set('align')}>
            <option value="center">Centred</option>
            <option value="left">Left</option>
          </select>
        </Field>
        <Field label="Footer text (website or handle)">
          <input className="input" maxLength={80} value={st.footer_text || ''} onChange={set('footer_text')} placeholder="An-nikaah.com" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={st.show_brand_name !== false} onChange={set('show_brand_name')} /> Brand name next to logo</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={Boolean(st.show_badge)} onChange={set('show_badge')} /> Category label</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={st.show_footer !== false} onChange={set('show_footer')} /> Footer</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={Boolean(st.erase)} onChange={set('erase')} /> Cover old text in the background</label>
        {st.erase && (
          <label className="flex items-center gap-2">Cover colour
            <input type="color" className="h-7 w-10 cursor-pointer rounded border border-slate-300 bg-white" value={/^#[0-9a-fA-F]{6}$/.test(st.erase_color || '') ? st.erase_color : '#ffffff'} onChange={set('erase_color')} />
          </label>
        )}
        <label className="flex items-center gap-2">Fit
          <select className="input !w-auto !py-1" value={st.fit || 'cover'} onChange={set('fit')}>
            <option value="cover">Fill (crop)</option>
            <option value="stretch">Stretch to square</option>
          </select>
        </label>
      </div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
        {range('logo_size', 'Logo size', 50, 220, 5, 'px')}
        {range('text_scale', 'Text size', 0.6, 1.4, 0.05, '×')}
        {range('overlay', 'Lighten background', 0, 0.9, 0.05)}
        {range('box_top', 'Text area top', 10, 60, 1, '%')}
        {range('box_height', 'Text area height', 20, 75, 1, '%')}
        {range('box_width', 'Text area width', 40, 92, 1, '%')}
      </div>
      <div className="flex justify-end"><AsyncButton busyLabel="Applying…" onClick={() => onApply(st)}><Save size={16} /> Apply</AsyncButton></div>
    </div>
  );
}

/** Banner design: default PixGen style, or follow an uploaded sample (style) / recreate it (custom). */
function BannerDesign({ page, onChanged }) {
  const toast = useToast();
  const [photosAvailable, setPhotosAvailable] = useState(false);
  useEffect(() => {
    api('/integrations').then((data) => setPhotosAvailable(Boolean(data.photos?.available))).catch(() => {});
  }, []);
  const [preview, setPreview] = useState(null);
  const [style, setStyle] = useState(page.banner_style || {});
  const [busy, setBusy] = useState(null);
  const mode = page.banner_mode || 'default';

  const refresh = useCallback(async () => {
    try {
      const data = await api(`/pages/${page.id}/banner-preview`, { method: 'POST' });
      setPreview(data.preview);
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [page.id, toast]);

  useEffect(() => {
    refresh();
  }, [refresh, page.updated_at]);

  useEffect(() => {
    setStyle(page.banner_style || {});
  }, [page.banner_style]);

  const backgrounds = page.background_images?.length
    ? page.background_images
    : page.background_image_path ? [{ path: page.background_image_path }] : [];

  const previewWith = async (options) => {
    try {
      const data = await api(`/pages/${page.id}/banner-preview`, { method: 'POST', body: options });
      setPreview(data.preview);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const removeBackground = async (index) => {
    try {
      const data = await api(`/pages/${page.id}/backgrounds/${index}`, { method: 'DELETE' });
      setPreview(data.preview);
      onChanged();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const apply = async (nextMode, nextStyle, imageStyle, backgroundSource) => {
    try {
      const data = await api(`/pages/${page.id}/banner-design`, { method: 'PUT', body: { mode: nextMode, style: nextStyle, imageStyle, backgroundSource } });
      setPreview(data.preview);
      onChanged();
      toast('Banner design updated.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const upload = async (event, uploadMode) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return undefined;
    if (file.size > 5 * 1024 * 1024) return toast('The sample must be at most 5 MB.', 'error');
    setBusy(uploadMode);
    try {
      const data = await api(`/pages/${page.id}/sample-design`, { method: 'POST', body: { dataUrl: await readAsDataUrl(file), mode: uploadMode } });
      setPreview(data.preview);
      onChanged();
      toast(uploadMode === 'custom' ? 'Design recreated. Check the preview.' : 'Style matched. Adjust it below if you like.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(null);
    }
    return undefined;
  };

  const uploadBackground = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return undefined;
    if (file.size > 7 * 1024 * 1024) return toast('The background must be at most 7 MB.', 'error');
    setBusy('background');
    try {
      const data = await api(`/pages/${page.id}/background`, { method: 'POST', body: { dataUrl: await readAsDataUrl(file) } });
      setPreview(data.preview);
      onChanged();
      toast('Background uploaded. Adjust the text below.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(null);
    }
    return undefined;
  };

  const useSample = async () => {
    try {
      const data = await api(`/pages/${page.id}/background/use-sample`, { method: 'POST', body: {} });
      setPreview(data.preview);
      onChanged();
      toast('Your sample is now the background. Adjust the text area below if any old text shows.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const fromSample = async () => {
    try {
      const data = await api(`/pages/${page.id}/background/from-sample`, { method: 'POST', body: {} });
      setPreview(data.preview);
      onChanged();
      toast('Background made from your sample. Check the preview.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const UploadButton = ({ uploadMode, label, icon: Icon }) => (
    <label className={clsx('btn', uploadMode === 'custom' ? 'btn-secondary' : 'btn-primary', busy && 'pointer-events-none opacity-60')}>
      {busy === uploadMode ? <span className="spinner" /> : <Icon size={16} />} {busy === uploadMode ? (uploadMode === 'custom' ? 'Recreating… (1–2 min)' : 'Reading design…') : label}
      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => upload(event, uploadMode)} />
    </label>
  );

  return (
    <div className="card space-y-5 p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Banner design</h2>
        <p className="mt-1 text-sm text-slate-500">Use the PixGen design, or upload a sample banner you like and let Gemini follow it.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ['image', 'My background image', 'Your own background (flowers, frame, colours); only the text changes. Best for a brand look.'],
          ['default', 'PixGen default', 'Clean dark design with your two colours below.'],
          ['style', 'Match my sample', 'Same colours and layout style as your sample.'],
          ['custom', 'Recreate my sample', 'Gemini copies the design as closely as it can.'],
        ].map(([key, title, text]) => {
          const available = key === 'default'
            || (key === 'style' && Boolean(page.banner_style))
            || (key === 'custom' && page.has_custom_template)
            || (key === 'image' && Boolean(page.background_image_path));
          return (
            <button
              key={key}
              type="button"
              disabled={!available}
              onClick={() => apply(key)}
              className={clsx('rounded-xl border p-3 text-left transition', mode === key ? 'border-violet bg-violet-50 ring-2 ring-violet/20' : 'border-slate-200 hover:bg-slate-50', !available && 'cursor-not-allowed opacity-50 hover:bg-white')}
            >
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{available ? text : key === 'image' ? 'Upload a background or make one from your sample below.' : 'Upload a sample first.'}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        {page.sample_design_path ? (
          <a href={page.sample_design_path} target="_blank" rel="noreferrer"><img src={page.sample_design_path} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" /></a>
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200"><ImageUp size={22} /></div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">{page.sample_design_path ? 'Your sample design' : 'Upload a sample banner'}</p>
          <p className="text-xs text-slate-500">PNG, JPG or WebP up to 5 MB — a banner or post design you like.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <UploadButton uploadMode="style" label="Upload & match style" icon={Palette} />
            <UploadButton uploadMode="custom" label="Upload & recreate" icon={Wand2} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
        <p className="text-sm font-semibold text-slate-900">My background image</p>
        <p className="mt-0.5 text-xs text-slate-600">
          Add several backgrounds to rotate between them.{' '}
          <b>Best:</b> upload your design's background <b>without any text</b> (e.g. the empty version from Canva).{' '}
          <b>Free:</b> use your uploaded sample as it is: soft panels in the background colour cover its old text.{' '}
          <b>AI:</b> Gemini erases the text (needs a paid key; the free tier has no image editing).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {page.background_image_path && <img src={page.background_image_path} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" />}
          <label className={clsx('btn btn-primary', busy && 'pointer-events-none opacity-60')}>
            {busy === 'background' ? <span className="spinner" /> : <ImageUp size={16} />} {busy === 'background' ? 'Uploading…' : 'Add background (no text)'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadBackground} />
          </label>
          <AsyncButton className="btn-secondary" busyLabel="Preparing…" onClick={useSample} disabled={!page.sample_design_path || Boolean(busy)}>
            <ImageUp size={16} /> Use my sample as it is (free)
          </AsyncButton>
          <AsyncButton className="btn-ghost" busyLabel="Erasing text… (up to 1 min)" onClick={fromSample} disabled={!page.sample_design_path || Boolean(busy)}>
            <Eraser size={16} /> Erase text with AI (paid key)
          </AsyncButton>
        </div>
        {backgrounds.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-600">Your backgrounds ({backgrounds.length}) — each new post uses the next one</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {backgrounds.map((bg, index) => (
                <div key={bg.path} className="group relative">
                  <button type="button" onClick={() => previewWith({ backgroundIndex: index })} className="block" title="Preview with this background">
                    <img src={bg.path} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200 transition group-hover:ring-2 group-hover:ring-violet" />
                  </button>
                  <button type="button" onClick={() => removeBackground(index)} className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-red-600 shadow ring-1 ring-slate-200" aria-label="Remove background"><Trash2 size={12} /></button>
                  {bg.erase && <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1 text-[9px] font-semibold text-slate-600">sample</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {mode === 'image' && <div className="mt-4"><ImageStyleEditor value={page.image_style} onApply={(imageStyle) => apply('image', undefined, imageStyle)} /></div>}
      </div>

      <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-slate-900">Background for each post</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            ['brand', 'My design', 'Your banner design (rotating backgrounds in "My background image").'],
            ['photos', 'Stock photos', 'A free Pexels photo that fits each post’s topic.'],
            ['mix', 'Mix', 'Alternate: one post with your design, the next with a photo.'],
          ].map(([key, title, text]) => {
            const disabled = key !== 'brand' && !photosAvailable;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => apply(mode, undefined, undefined, key)}
                className={clsx('rounded-xl border bg-white p-3 text-left transition', (page.background_source || 'brand') === key ? 'border-violet ring-2 ring-violet/20' : 'border-slate-200 hover:bg-slate-50', disabled && 'cursor-not-allowed opacity-50')}
              >
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{disabled ? 'Needs a Pexels key in Admin → Platform settings.' : text}</p>
              </button>
            );
          })}
        </div>
      </div>

      {mode === 'style' && (
        <div className="space-y-4">
          {style.description && <p className="text-xs text-slate-500">Detected: {style.description}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            {STYLE_FIELDS.map(([key, label, options]) => (
              <Field key={key} label={label}>
                <select className="input" value={style[key] || options[0][0]} onChange={(event) => setStyle((s) => ({ ...s, [key]: event.target.value }))}>
                  {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {STYLE_COLORS.map(([key, label]) => (
              <Field key={key} label={label}>
                <div className="flex gap-2">
                  <input type="color" className="h-[42px] w-12 shrink-0 cursor-pointer rounded-xl border border-slate-300 bg-white p-1" value={/^#[0-9a-fA-F]{6}$/.test(style[key] || '') ? style[key] : '#000000'} onChange={(event) => setStyle((s) => ({ ...s, [key]: event.target.value }))} />
                  <input className="input font-mono text-xs" value={style[key] || ''} onChange={(event) => setStyle((s) => ({ ...s, [key]: event.target.value }))} />
                </div>
              </Field>
            ))}
          </div>
          <div className="flex justify-end"><AsyncButton busyLabel="Applying…" onClick={() => apply('style', style)}><Save size={16} /> Apply style</AsyncButton></div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">Preview <span className="font-normal text-slate-400">(sample text)</span></p>
          <div className="flex flex-wrap gap-1">
            <AsyncButton className="btn-ghost btn-sm" onClick={() => previewWith({ type: 'statement' })}>Message</AsyncButton>
            <AsyncButton className="btn-ghost btn-sm" onClick={() => previewWith({ type: 'quote' })}>Quote</AsyncButton>
            <AsyncButton className="btn-ghost btn-sm" onClick={() => previewWith({ type: 'tips' })}>Tips</AsyncButton>
            {photosAvailable && <AsyncButton className="btn-ghost btn-sm" busyLabel="Finding photo…" onClick={() => previewWith({ type: 'statement', background: 'photo' })}>Photo</AsyncButton>}
            <AsyncButton className="btn-ghost btn-sm" onClick={refresh}><RefreshCw size={14} /></AsyncButton>
          </div>
        </div>
        {preview ? <img src={preview} alt="" className="aspect-square w-full max-w-md rounded-xl border border-slate-200 bg-slate-100 object-cover" /> : <div className="grid aspect-square w-full max-w-md place-items-center rounded-xl bg-slate-100 text-sm text-slate-400">Rendering…</div>}
      </div>
    </div>
  );
}

/** Small live mock of the banner colours and brand. */
function BannerSwatch({ form }) {
  return (
    <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
      <div className="relative aspect-square p-5 text-white" style={{ background: `linear-gradient(155deg, ${form.primary_color}, color-mix(in srgb, ${form.primary_color} 70%, #000))` }}>
        <div className="flex items-center justify-between text-[11px]">
          <span className="rounded-full px-2.5 py-1 font-bn font-semibold" style={{ background: `color-mix(in srgb, ${form.accent_color} 18%, transparent)`, border: `1px solid ${form.accent_color}` }}>বিষয়</span>
          <span className="flex items-center gap-1.5 font-bn font-semibold">{form.brand_logo_url && <img src={form.brand_logo_url} alt="" className="h-5 w-5 rounded object-cover" />}{form.brand_name}</span>
        </div>
        <div className="flex h-[70%] flex-col items-center justify-center text-center">
          <p className="font-bn text-xl font-bold leading-snug">আজকের <span style={{ color: form.accent_color }}>শিরোনাম</span></p>
          <div className="my-3 h-1 w-12 rounded" style={{ background: form.accent_color }} />
          <p className="font-bn text-xs opacity-75">ছোট একটি সহায়ক বাক্য</p>
        </div>
        <p className="absolute bottom-4 left-5 text-[11px] font-semibold">{form.brand_handle}</p>
      </div>
    </div>
  );
}

export default function PageSettings() {
  const { pageId } = useParams();
  const page = usePageById(pageId);
  const { refreshPages } = usePages();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (page && (!form || form.id !== page.id)) {
      setForm({ id: page.id, ...Object.fromEntries(FIELDS.map((key) => [key, page[key] ?? ''])) });
    }
  }, [page, form]);

  if (!page || !form) return <div className="card p-6 text-sm text-slate-500">Loading settings…</div>;

  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const bind = (key) => ({ value: form[key] ?? '', onChange: (event) => set(key)(event.target.value) });
  const timezone = page.schedule.timezone;

  const save = async () => {
    try {
      const { id, ...body } = form;
      await api(`/pages/${page.id}`, { method: 'PUT', body });
      await refreshPages();
      toast('Settings saved.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete "${page.name}"?`,
      message: 'This deletes the page from PixGen Pilot with its queue, history and banners. Posts already on Facebook are not touched.',
      confirmLabel: 'Delete page',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/pages/${page.id}`, { method: 'DELETE' });
      await refreshPages();
      toast('Page deleted.');
      navigate('/');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div>
      <PageHeader
        icon={Settings2}
        title="Brand & schedule"
        description="How this page's banners look, what Gemini writes about, and when it posts."
        actions={<AsyncButton busyLabel="Saving…" onClick={save}><Save size={16} /> Save settings</AsyncButton>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card space-y-5 p-5">
            <h2 className="text-base font-semibold text-slate-900">Page &amp; content</h2>
            <Field label="Page name (in PixGen Pilot)">
              <input className="input font-bn" maxLength={150} {...bind('name')} />
            </Field>
            <Field label="Page niche" hint="Gemini brainstorms topics from this when the queue is empty.">
              <textarea rows={3} className="input font-bn" maxLength={1000} {...bind('page_niche')} />
            </Field>
          </div>

          <div className="card space-y-5 p-5">
            <h2 className="text-base font-semibold text-slate-900">Banner branding</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand name (top right of banner)" hint="Write it in Bangla to keep the banner fully Bangla.">
                <input className="input font-bn" maxLength={100} {...bind('brand_name')} />
              </Field>
              <Field label="Page handle (banner footer)">
                <input className="input font-bn" maxLength={100} {...bind('brand_handle')} placeholder="@yourpage" />
              </Field>
            </div>
            <LogoField
              page={page}
              value={form.brand_logo_url}
              onChange={set('brand_logo_url')}
              onUploaded={(url) => { setForm((current) => ({ ...current, brand_logo_url: url })); refreshPages(); }}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label="Background color (PixGen default design)" value={form.primary_color} onChange={set('primary_color')} />
              <ColorField label="Accent color (PixGen default design)" value={form.accent_color} onChange={set('accent_color')} />
            </div>
          </div>

          <BannerDesign page={page} onChanged={refreshPages} />

          <div className="card space-y-5 p-5">
            <h2 className="text-base font-semibold text-slate-900">Schedule</h2>
            <Toggle checked={Boolean(form.autopilot_enabled)} onChange={set('autopilot_enabled')} label="Autopilot" description="Generate and publish a post automatically on the schedule below." />
            <Field label="Daily schedule (cron)" hint={describeCron(form.cron_schedule, timezone)}>
              <input className="input font-mono" maxLength={100} {...bind('cron_schedule')} />
            </Field>
            <div className="flex flex-wrap gap-2">
              {CRON_PRESETS.map(([expression, label]) => (
                <button key={expression} type="button" className="btn btn-secondary btn-sm" onClick={() => set('cron_schedule')(expression)}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5 lg:sticky lg:top-24">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Banner colours</h2>
            <BannerSwatch form={form} />
            <p className="mt-3 text-xs text-slate-500">A quick colour mock. Real banners are rendered at 1080×1080 when a post is generated.</p>
          </div>
          <div className="card border-red-200 p-5">
            <h2 className="text-base font-semibold text-red-700">Danger zone</h2>
            <p className="mt-1 text-sm text-slate-500">Delete this page with its queue and history.</p>
            <button type="button" className="btn btn-danger-soft mt-3 w-full" onClick={remove}><Trash2 size={16} /> Delete page</button>
          </div>
        </div>
      </div>
    </div>
  );
}
