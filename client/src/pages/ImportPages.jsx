import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, Download, RefreshCw, Search } from 'lucide-react';
import { api } from '../api.js';
import { Facebook } from '../components/FacebookIcon.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, EmptyState, PageHeader } from '../components/ui.jsx';
import { usePages } from '../pagesContext.jsx';

export default function ImportPages() {
  const toast = useToast();
  const navigate = useNavigate();
  const { refreshPages } = usePages();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api('/integrations/facebook/pages'));
    } catch (error) {
      toast(error.message, 'error');
      setData({ loggedIn: false, pages: [] });
    }
  }, [toast]);

  useEffect(() => {
    const fbError = params.get('fb_error');
    if (fbError) toast(fbError, 'error');
    if (params.get('fb') === 'connected') toast('Facebook login saved. Pick the pages to add.', 'success');
    if (fbError || params.get('fb')) setParams({}, { replace: true });
    load();
  }, [load, params, setParams, toast]);

  const continueWithFacebook = async () => {
    try {
      const { url } = await api('/integrations/facebook/oauth/start', { method: 'POST', body: { target: 'import' } });
      window.location.href = url;
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importSelected = async () => {
    try {
      const result = await api('/integrations/facebook/import', { method: 'POST', body: { fbPageIds: [...selected] } });
      await refreshPages();
      setSelected(new Set());
      if (result.created.length) toast(`Added and connected ${result.created.length} page${result.created.length === 1 ? '' : 's'}.`, 'success');
      if (result.skipped.length) toast(`Skipped ${result.skipped.length}: ${result.skipped.map((item) => `${item.name || item.id} (${item.reason})`).join(', ')}`, 'info');
      if (result.created.length === 1) navigate(`/pages/${result.created[0].id}/settings`);
      else load();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const pages = (data?.pages || []).filter((page) => !query.trim() || page.name.toLowerCase().includes(query.trim().toLowerCase()) || page.id.includes(query.trim()));
  const available = pages.filter((page) => page.canPost && !page.connectedTo);

  return (
    <div>
      <PageHeader
        icon={Download}
        title="Import pages from Facebook"
        description="Add several Facebook Pages at once. Each one becomes its own PixGen Pilot page with its own queue, ideas, brand and schedule."
        actions={data?.loggedIn && <AsyncButton className="btn-secondary" busyLabel="Opening Facebook…" onClick={continueWithFacebook}><RefreshCw size={16} /> Choose more pages on Facebook</AsyncButton>}
      />

      {!data ? (
        <div className="card p-6 text-sm text-slate-500">Loading your Facebook pages…</div>
      ) : !data.loggedIn ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-fb text-white shadow-lg shadow-fb/30"><Facebook size={34} /></div>
          <h2 className="mt-5 text-xl font-bold text-slate-900">Log in with Facebook to see your pages</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">In Facebook's window, tick every Page (and Business Portfolio) you want to manage here.</p>
          <AsyncButton className="btn-fb mt-6 !px-6 !py-3 text-base" busyLabel="Opening Facebook…" onClick={continueWithFacebook}><Facebook size={20} /> Continue with Facebook</AsyncButton>
        </div>
      ) : data.pages.length === 0 ? (
        <EmptyState icon={Facebook} title="No pages shared" action={<AsyncButton className="btn-fb" onClick={continueWithFacebook}>Choose pages on Facebook</AsyncButton>}>
          Facebook did not share any pages. Log in again and tick the pages you want.
        </EmptyState>
      ) : (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set(available.map((page) => page.id)))} disabled={available.length === 0}>Select all available</button>
              {selected.size > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>}
            </div>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input !w-64 !pl-9" placeholder="Search pages…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {pages.map((page) => {
              const disabled = !page.canPost || Boolean(page.connectedTo);
              const checked = selected.has(page.id);
              return (
                <button
                  key={page.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(page.id)}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    checked ? 'border-violet bg-violet-50 ring-2 ring-violet/20' : 'border-slate-200 hover:bg-slate-50',
                    disabled && 'cursor-default hover:bg-white',
                  )}
                >
                  <span className={clsx('grid h-5 w-5 shrink-0 place-items-center rounded border', checked ? 'border-violet bg-violet text-white' : 'border-slate-300 bg-white', disabled && 'opacity-40')}>
                    {checked && <CheckCircle2 size={14} />}
                  </span>
                  {page.picture ? <img src={page.picture} alt="" className="h-10 w-10 shrink-0 rounded-full" /> : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fb/10 text-fb"><Facebook size={18} /></div>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{page.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {page.category || 'Page'}
                      {page.business && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">via {page.business}</span>}
                    </p>
                    {page.connectedTo && (
                      <p className="text-[11px] font-semibold text-emerald-700">
                        Connected · <Link to={`/pages/${page.connectedTo.id}`} className="underline" onClick={(event) => event.stopPropagation()}>{page.connectedTo.name}</Link>
                      </p>
                    )}
                    {!page.canPost && !page.connectedTo && <p className="text-[11px] text-amber-700">No posting access for your account</p>}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">New pages start with the default niche and a 10:00 schedule. Adjust each under Brand &amp; schedule.</p>
            <AsyncButton busyLabel="Adding pages…" onClick={importSelected} disabled={selected.size === 0}>
              <Download size={16} /> Add {selected.size || ''} page{selected.size === 1 ? '' : 's'}
            </AsyncButton>
          </div>
        </div>
      )}
    </div>
  );
}
