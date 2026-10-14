import { useState } from 'react';
import { CalendarClock, Copy, ExternalLink, FileText, PencilLine, Send, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Modal, useConfirm } from './Dialog.jsx';
import { useToast } from './Toasts.jsx';
import { AsyncButton, Badge, copyText, formatDate } from './ui.jsx';
import { PostEditor } from './PostEditor.jsx';

/**
 * Shared post actions for one page. `onChanged(entry | null)` is called after a publish
 * (with the updated entry) or a delete (with null).
 */
function usePostActions(pageId, onChanged) {
  const toast = useToast();
  const confirm = useConfirm();

  const copy = async (entry) => {
    await copyText(entry.post_caption);
    toast('Caption copied.', 'success');
  };

  const publish = async (entry) => {
    const ok = await confirm({ title: 'Publish to Facebook?', message: 'This posts the banner and caption to your Facebook Page now.', confirmLabel: 'Publish' });
    if (!ok) return;
    try {
      const data = await api(`/pages/${pageId}/history/${entry.id}/publish`, { method: 'POST' });
      toast('Published to Facebook.', 'success');
      onChanged?.(data.entry);
    } catch (error) {
      toast(error.message, 'error');
      onChanged?.({ ...entry, error_message: error.message });
    }
  };

  const remove = async (entry) => {
    const ok = await confirm({ title: 'Delete this post?', message: 'The post and its banner image will be deleted.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/pages/${pageId}/history/${entry.id}`, { method: 'DELETE' });
      toast('Deleted.');
      onChanged?.(null, entry);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return { copy, publish, remove };
}

const canPublish = (entry) => entry.status !== 'published' && entry.post_caption && entry.banner_image_path;

export function CaptionModal({ entry, onClose }) {
  const toast = useToast();
  return (
    <Modal
      title="Caption"
      onClose={onClose}
      actions={
        <button type="button" className="btn btn-primary" onClick={async () => { await copyText(entry.post_caption); toast('Caption copied.', 'success'); }}>
          <Copy size={16} /> Copy caption
        </button>
      }
    >
      <div className="caption font-bn text-[15px] leading-relaxed text-slate-800">{entry.post_caption}</div>
    </Modal>
  );
}

function BannerImage({ entry, className }) {
  if (!entry.banner_image_path) {
    return <div className={`grid place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 ${className}`}>No banner</div>;
  }
  return (
    <a href={entry.banner_image_path} target="_blank" rel="noreferrer" className="block shrink-0">
      <img src={entry.banner_image_path} alt="" loading="lazy" className={`rounded-xl border border-slate-200 bg-slate-100 object-cover ${className}`} />
    </a>
  );
}

/** Large card with banner + full caption, used for the latest preview / run result. */
export function PostCard({ pageId, entry, timezone, onChanged }) {
  const { copy, publish, remove } = usePostActions(pageId, onChanged);
  const [editing, setEditing] = useState(false);
  return (
    <div className="card grid gap-5 p-5 md:grid-cols-2">
      <BannerImage entry={entry} className="aspect-square w-full" />
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={entry.status} />
          <span className="text-xs text-slate-500">#{entry.id} · {formatDate(entry.created_at, timezone)}</span>
          {entry.status === 'scheduled' && <span className="flex items-center gap-1 text-xs font-semibold text-violet-700"><CalendarClock size={13} /> {formatDate(entry.scheduled_at, timezone)}</span>}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Topic</div>
          <div className="font-bn font-semibold text-slate-900">{entry.topic}</div>
        </div>
        {entry.error_message && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{entry.error_message}</div>}
        {entry.post_caption && (
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">Caption</div>
            <div className="caption max-h-80 overflow-y-auto rounded-xl bg-slate-50 p-3 font-bn text-[15px] leading-relaxed text-slate-800 ring-1 ring-slate-200">{entry.post_caption}</div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {entry.status !== 'published' && entry.post_caption && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}><PencilLine size={16} /> Review, edit &amp; schedule</button>
          )}
          {canPublish(entry) && (
            <AsyncButton className="btn-fb" busyLabel="Publishing…" onClick={() => publish(entry)}><Send size={16} /> Publish now</AsyncButton>
          )}
          {entry.post_caption && <button type="button" className="btn btn-secondary" onClick={() => copy(entry)}><Copy size={16} /> Copy caption</button>}
          {entry.fb_post_url && <a className="btn btn-secondary" href={entry.fb_post_url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> View on Facebook</a>}
          {entry.status !== 'published' && <button type="button" className="btn btn-danger-soft" onClick={() => remove(entry)}><Trash2 size={16} /> Discard</button>}
        </div>
      </div>
      {editing && <PostEditor pageId={pageId} entry={entry} timezone={timezone} onClose={() => setEditing(false)} onChanged={(next) => onChanged?.(next)} />}
    </div>
  );
}

/** Compact row used in the history list. */
export function HistoryRow({ pageId, entry, timezone, onChanged }) {
  const { copy, publish, remove } = usePostActions(pageId, onChanged);
  const [showCaption, setShowCaption] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <div className="card flex gap-4 p-4">
      <BannerImage entry={entry} className="h-20 w-20 sm:h-28 sm:w-28" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={entry.status} />
          <span className="text-xs text-slate-500">#{entry.id} · {formatDate(entry.created_at, timezone)}</span>
          {entry.status === 'scheduled' && <span className="flex items-center gap-1 text-xs font-semibold text-violet-700"><CalendarClock size={13} /> {formatDate(entry.scheduled_at, timezone)}</span>}
        </div>
        <div className="font-bn font-semibold leading-snug text-slate-900">{entry.banner_headline || entry.topic}</div>
        <div className="truncate font-bn text-xs text-slate-500">{entry.topic}</div>
        {entry.error_message && <div className="line-clamp-2 text-xs text-red-600">{entry.error_message}</div>}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {entry.status !== 'published' && entry.post_caption && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(true)}><PencilLine size={14} /> Review &amp; edit</button>
          )}
          {entry.post_caption && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCaption(true)}><FileText size={14} /> Caption</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(entry)}><Copy size={14} /> Copy</button>
            </>
          )}
          {entry.fb_post_url && <a className="btn btn-secondary btn-sm" href={entry.fb_post_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Facebook</a>}
          {canPublish(entry) && <AsyncButton className="btn-fb btn-sm" busyLabel="Publishing…" onClick={() => publish(entry)}><Send size={14} /> Publish</AsyncButton>}
          {entry.status !== 'published' && <button type="button" className="btn btn-danger-soft btn-sm" onClick={() => remove(entry)}><Trash2 size={14} /> Delete</button>}
        </div>
      </div>
      {showCaption && <CaptionModal entry={entry} onClose={() => setShowCaption(false)} />}
      {editing && <PostEditor pageId={pageId} entry={entry} timezone={timezone} onClose={() => { setEditing(false); onChanged?.(entry); }} onChanged={() => {}} />}
    </div>
  );
}
