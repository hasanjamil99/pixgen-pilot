import { useState } from 'react';
import { CalendarClock, CheckCircle2, RefreshCw, Save, Send, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { Modal, useConfirm } from './Dialog.jsx';
import { useToast } from './Toasts.jsx';
import { AsyncButton, Badge, Field, formatDate, zonedInputParts } from './ui.jsx';

/**
 * Review and adjust a generated post before it is published:
 * caption + banner text (banner re-rendered on save), regenerate, schedule/reschedule, publish now.
 * `onChanged(entry | null)` receives the updated entry.
 */
export function PostEditor({ pageId, entry: initial, timezone = 'Asia/Dhaka', onClose, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [entry, setEntry] = useState(initial);
  const [form, setForm] = useState({
    banner_badge: initial.banner_badge || '',
    banner_headline: initial.banner_headline || '',
    banner_subheadline: initial.banner_subheadline || '',
    post_caption: initial.post_caption || '',
    banner_type: initial.banner_type || 'statement',
    banner_points: (initial.banner_points || []).join('\n'),
  });
  const defaultWhen = zonedInputParts(initial.scheduled_at || new Date(Date.now() + 3600 * 1000), timezone);
  const [when, setWhen] = useState(defaultWhen);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const original = (key) => (key === 'banner_points' ? (entry.banner_points || []).join('\n') : key === 'banner_type' ? entry.banner_type || 'statement' : entry[key] || '');
  const dirty = Object.keys(form).some((key) => form[key] !== original(key));
  const body = () => ({ ...form, banner_points: form.banner_points.split('\n').map((p) => p.trim()).filter(Boolean) });

  const apply = (next, message) => {
    setEntry(next);
    setForm({
      banner_badge: next.banner_badge || '',
      banner_headline: next.banner_headline || '',
      banner_subheadline: next.banner_subheadline || '',
      post_caption: next.post_caption || '',
      banner_type: next.banner_type || 'statement',
      banner_points: (next.banner_points || []).join('\n'),
    });
    onChanged?.(next);
    if (message) toast(message, 'success');
  };

  const save = async () => {
    try {
      const data = await api(`/pages/${pageId}/history/${entry.id}`, { method: 'PUT', body: body() });
      apply(data.entry, 'Saved. The banner was updated.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const regenerate = async () => {
    if (!(await confirm({ title: 'Write this post again?', message: 'Gemini writes a new post and banner for the same topic. Your edits are replaced.', confirmLabel: 'Regenerate' }))) return;
    try {
      const data = await api(`/pages/${pageId}/history/${entry.id}/regenerate`, { method: 'POST' });
      apply(data.entry, 'New version ready.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const schedule = async () => {
    try {
      if (dirty) await api(`/pages/${pageId}/history/${entry.id}`, { method: 'PUT', body: body() });
      const data = await api(`/pages/${pageId}/history/${entry.id}/schedule`, { method: 'POST', body: when });
      apply(data.entry, `Scheduled for ${formatDate(data.entry.scheduled_at, timezone)}.`);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const approve = async () => {
    try {
      if (dirty) await api(`/pages/${pageId}/history/${entry.id}`, { method: 'PUT', body: body() });
      const data = await api(`/pages/${pageId}/history/${entry.id}/approve`, { method: 'POST' });
      apply(data.entry, 'Approved. It will publish at its time.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const unschedule = async () => {
    try {
      const data = await api(`/pages/${pageId}/history/${entry.id}/unschedule`, { method: 'POST' });
      apply(data.entry, 'Moved back to previews.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const publishNow = async () => {
    if (!(await confirm({ title: 'Publish to Facebook now?', message: 'The banner and caption are posted to your Facebook Page immediately.', confirmLabel: 'Publish now' }))) return;
    try {
      if (dirty) await api(`/pages/${pageId}/history/${entry.id}`, { method: 'PUT', body: body() });
      const data = await api(`/pages/${pageId}/history/${entry.id}/publish`, { method: 'POST' });
      apply(data.entry, 'Published to Facebook.');
      onClose();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const published = entry.status === 'published';

  return (
    <Modal title="Review post" onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          {entry.banner_image_path && <img src={`${entry.banner_image_path}?v=${encodeURIComponent(entry.banner_image_path)}`} alt="" className="aspect-square w-full rounded-xl border border-slate-200 bg-slate-100 object-cover" />}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge status={entry.status} />
            {entry.scheduled_at && entry.status === 'scheduled' && <span className="font-semibold text-violet-700">{formatDate(entry.scheduled_at, timezone)}</span>}
            {entry.status === 'scheduled' && !entry.approved && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">needs approval</span>}
          </div>
          {entry.error_message && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{entry.error_message}</p>}
          {!published && (
            <AsyncButton className="btn-secondary w-full" busyLabel="Writing again…" onClick={regenerate}><RefreshCw size={16} /> Regenerate with Gemini</AsyncButton>
          )}
        </div>

        <div className="space-y-3">
          <p className="font-bn text-sm font-semibold text-slate-900">{entry.topic}</p>
          <Field label="Banner type">
            <select className="input" value={form.banner_type} onChange={set('banner_type')} disabled={published}>
              <option value="statement">Message (headline + line)</option>
              <option value="quote">Quote (hadith, verse or saying + source)</option>
              <option value="tips">Tips (numbered points)</option>
            </select>
          </Field>
          {form.banner_type === 'tips' && (
            <Field label="Points (one per line, max 4)"><textarea rows={4} className="input font-bn" value={form.banner_points} onChange={set('banner_points')} disabled={published} /></Field>
          )}
          <Field label="Banner badge"><input className="input font-bn" maxLength={150} value={form.banner_badge} onChange={set('banner_badge')} disabled={published} /></Field>
          <Field label="Banner headline"><textarea rows={2} className="input font-bn" maxLength={500} value={form.banner_headline} onChange={set('banner_headline')} disabled={published} /></Field>
          <Field label={form.banner_type === 'quote' ? 'Source (e.g. সুনান তিরমিজি)' : 'Banner subheadline'}><textarea rows={2} className="input font-bn" maxLength={500} value={form.banner_subheadline} onChange={set('banner_subheadline')} disabled={published} /></Field>
          <Field label="Caption" hint="Keep a blank line between sentences for easy reading.">
            <textarea rows={9} className="input font-bn text-[15px] leading-relaxed" maxLength={5000} value={form.post_caption} onChange={set('post_caption')} disabled={published} />
          </Field>
          {!published && (
            <div className="flex justify-end">
              <AsyncButton busyLabel="Saving & redrawing banner…" onClick={save} disabled={!dirty}><Save size={16} /> Save changes</AsyncButton>
            </div>
          )}
        </div>
      </div>

      {!published && (
        <div className="mt-5 flex flex-col gap-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={`Schedule (${timezone})`}>
              <div className="flex gap-2">
                <input type="date" className="input !w-auto" value={when.date} onChange={(event) => setWhen((w) => ({ ...w, date: event.target.value }))} />
                <input type="time" className="input !w-auto" value={when.time} onChange={(event) => setWhen((w) => ({ ...w, time: event.target.value }))} />
              </div>
            </Field>
            <AsyncButton className="btn-dark" busyLabel="Scheduling…" onClick={schedule}><CalendarClock size={16} /> {entry.status === 'scheduled' ? 'Reschedule' : 'Schedule'}</AsyncButton>
            {entry.status === 'scheduled' && !entry.approved && <AsyncButton className="btn-secondary" onClick={approve}><CheckCircle2 size={16} /> Approve</AsyncButton>}
            {entry.status === 'scheduled' && <AsyncButton className="btn-ghost" onClick={unschedule}><Undo2 size={16} /> Unschedule</AsyncButton>}
          </div>
          <AsyncButton className="btn-fb" busyLabel="Publishing…" onClick={publishNow}><Send size={16} /> Publish now</AsyncButton>
        </div>
      )}
    </Modal>
  );
}
