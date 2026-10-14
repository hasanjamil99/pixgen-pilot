import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { History } from 'lucide-react';
import { api } from '../api.js';
import { HistoryRow } from '../components/PostActions.jsx';
import { useToast } from '../components/Toasts.jsx';
import { EmptyState, PageHeader } from '../components/ui.jsx';
import { usePageById, usePages } from '../pagesContext.jsx';

const PAGE_SIZE = 10;

export default function PageHistory() {
  const { pageId } = useParams();
  const page = usePageById(pageId);
  const { refreshPages } = usePages();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);

  useEffect(() => {
    setOffset(0);
  }, [pageId]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset });
      if (filter) params.set('status', filter);
      const result = await api(`/pages/${pageId}/history?${params}`);
      if (result.rows.length === 0 && offset > 0) {
        setOffset(Math.max(0, offset - PAGE_SIZE));
        return;
      }
      setData(result);
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [pageId, filter, offset, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const from = data && data.total > 0 ? data.offset + 1 : 0;
  const to = data ? data.offset + data.rows.length : 0;

  return (
    <div>
      <PageHeader
        icon={History}
        title="Post history"
        description="Every post, preview and failed attempt for this page."
        actions={
          <select className="input !w-auto" value={filter} onChange={(event) => { setFilter(event.target.value); setOffset(0); }}>
            <option value="">All posts</option>
            <option value="published">Published</option>
            <option value="preview_only">Previews</option>
            <option value="scheduled">Scheduled</option>
            <option value="failed">Failed</option>
          </select>
        }
      />

      <div className="space-y-3">
        {data?.rows.map((row) => (
          <HistoryRow key={row.id} pageId={pageId} entry={row} timezone={page?.schedule.timezone} onChanged={() => { load(); refreshPages(); }} />
        ))}
      </div>

      {data && data.rows.length === 0 && <EmptyState icon={History} title="No posts yet">Generate a preview from the Autopilot screen to see it here.</EmptyState>}

      {data && data.total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>{from}–{to} of {data.total}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={to >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
