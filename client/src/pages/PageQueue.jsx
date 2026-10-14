import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ListTodo, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useConfirm } from '../components/Dialog.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, Badge, Field, formatDate, PageHeader } from '../components/ui.jsx';
import { usePageById, usePages } from '../pagesContext.jsx';

export default function PageQueue() {
  const { pageId } = useParams();
  const page = usePageById(pageId);
  const { refreshPages } = usePages();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('');
  const [topics, setTopics] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState(0);
  const timezone = page?.schedule.timezone;

  const load = useCallback(async () => {
    try {
      const data = await api(`/pages/${pageId}/queue${filter ? `?status=${encodeURIComponent(filter)}` : ''}`);
      setItems(data.items);
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [pageId, filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    load();
    refreshPages();
  };

  const add = async () => {
    if (!topics.trim()) return toast('Add at least one topic.', 'error');
    try {
      const data = await api(`/pages/${pageId}/queue`, { method: 'POST', body: { topics, category: category.trim() || null, priority: Number(priority) || 0 } });
      toast(`Added ${data.added} topic${data.added === 1 ? '' : 's'}.`, 'success');
      setTopics('');
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
    return undefined;
  };

  const remove = async (item) => {
    if (!(await confirm({ title: 'Delete topic?', message: 'This topic will be removed from the queue.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/pages/${pageId}/queue/${item.id}`, { method: 'DELETE' });
      toast('Topic deleted.');
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const retry = async (item) => {
    try {
      await api(`/pages/${pageId}/queue/${item.id}/retry`, { method: 'POST' });
      toast('Topic moved back to pending.', 'success');
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const clearCompleted = async () => {
    try {
      const data = await api(`/pages/${pageId}/queue/completed`, { method: 'DELETE' });
      toast(`Removed ${data.deleted} completed topic${data.deleted === 1 ? '' : 's'}.`);
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div>
      <PageHeader icon={ListTodo} title="Content queue" description="Topics waiting to be posted, highest priority first. When the queue is empty, Gemini invents a fresh topic from the page niche." />

      <div className="card space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">Add topics</h2>
        <Field label="Topics" hint="One topic per line.">
          <textarea rows={5} className="input font-bn" value={topics} onChange={(event) => setTopics(event.target.value)} placeholder={'স্মার্টফোনে সময় বাঁচানোর ৫টি কৌশল\nছোট ব্যবসায় এআই ব্যবহারের সহজ উপায়'} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category (optional)" className="sm:col-span-2">
            <input className="input font-bn" maxLength={150} value={category} onChange={(event) => setCategory(event.target.value)} />
          </Field>
          <Field label="Priority" hint="Higher goes first.">
            <input type="number" step="1" className="input" value={priority} onChange={(event) => setPriority(event.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <AsyncButton busyLabel="Adding…" onClick={add}><Plus size={16} /> Add to queue</AsyncButton>
        </div>
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Queue</h2>
        <div className="flex gap-2">
          <select className="input !w-auto !py-1.5" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
            <option value="completed">Completed</option>
          </select>
          <AsyncButton className="btn-secondary btn-sm" onClick={clearCompleted}>Clear completed</AsyncButton>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Topic</th><th>Priority</th><th>Status</th><th>Added</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items?.map((item) => (
              <tr key={item.id}>
                <td className="min-w-[16rem]">
                  <div className="font-bn text-slate-900">{item.topic}</div>
                  {item.category && <div className="mt-0.5 font-bn text-xs text-slate-500">{item.category}</div>}
                  {item.error_message && <div className="mt-1 text-xs text-red-600">{item.error_message}</div>}
                </td>
                <td>{item.priority}</td>
                <td><Badge status={item.status} /></td>
                <td className="whitespace-nowrap text-slate-500">{formatDate(item.created_at, timezone)}</td>
                <td className="space-x-1 whitespace-nowrap text-right">
                  {item.status === 'failed' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => retry(item)}><RotateCcw size={14} /> Retry</button>}
                  {(item.status === 'pending' || item.status === 'failed') && <button type="button" className="btn btn-danger-soft btn-sm" onClick={() => remove(item)}><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items && items.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {filter ? 'No topics with this status.' : 'The queue is empty. Autopilot will brainstorm a fresh topic from your page niche.'}
          </p>
        )}
      </div>
    </div>
  );
}
