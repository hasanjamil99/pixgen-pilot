import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, ClipboardPaste, ExternalLink, Plug, RefreshCw, Unplug } from 'lucide-react';
import { Facebook } from '../components/FacebookIcon.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useConfirm } from '../components/Dialog.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, Field, formatDate, PageHeader } from '../components/ui.jsx';
import { usePageById, usePages } from '../pagesContext.jsx';

function PagePicker({ pageId, pages, onConnected, onReconnect }) {
  const toast = useToast();
  const [selected, setSelected] = useState(pages.find((page) => page.canPost)?.id || null);
  const [query, setQuery] = useState('');
  const filtered = pages.filter((page) => !query.trim() || page.name.toLowerCase().includes(query.trim().toLowerCase()) || page.id.includes(query.trim()));

  const connect = async () => {
    try {
      const data = await api(`/pages/${pageId}/facebook/select`, { method: 'POST', body: { fbPageId: selected } });
      toast(`Connected to ${data.page.fb_page_name}.`, 'success');
      onConnected();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Choose the Facebook Page to connect</h2>
          <p className="mt-1 text-sm text-slate-500">Pages you manage directly and through your Business Portfolios. Pick the one this PixGen Pilot page should post to.</p>
        </div>
        {pages.length > 8 && <input className="input !w-64" placeholder="Search pages…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      </div>
      <div className="mt-4 grid max-h-[28rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {filtered.map((page) => (
          <button
            key={page.id}
            type="button"
            disabled={!page.canPost}
            onClick={() => setSelected(page.id)}
            className={clsx(
              'flex items-center gap-3 rounded-xl border p-3 text-left transition',
              selected === page.id ? 'border-violet bg-violet-50 ring-2 ring-violet/20' : 'border-slate-200 hover:bg-slate-50',
              !page.canPost && 'cursor-not-allowed opacity-50 hover:bg-white',
            )}
          >
            {page.picture ? <img src={page.picture} alt="" className="h-10 w-10 shrink-0 rounded-full" /> : <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fb/10 text-fb"><Facebook size={18} /></div>}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{page.name}</p>
              <p className="truncate text-xs text-slate-500">
                {page.category || 'Page'} · {page.id}
                {page.business && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">via {page.business}</span>}
              </p>
              {!page.canPost && <p className="text-[11px] text-amber-700">No posting access for your account</p>}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          Don't see your page?{' '}
          <button type="button" className="font-semibold text-violet-600 hover:underline" onClick={onReconnect}>Reconnect and choose more pages</button>
          {' '}(click <b>Edit access</b> in Facebook's window).
        </p>
        <AsyncButton className="btn-fb" busyLabel="Connecting…" onClick={connect} disabled={!selected}><Plug size={16} /> Connect this page</AsyncButton>
      </div>
    </div>
  );
}

export default function PageFacebook() {
  const { pageId } = useParams();
  const page = usePageById(pageId);
  const { refreshPages } = usePages();
  const { isSuperAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [integrations, setIntegrations] = useState(null);
  const [token, setToken] = useState('');
  const [choices, setChoices] = useState(null);
  const [check, setCheck] = useState(null);

  useEffect(() => {
    api('/integrations').then(setIntegrations).catch(() => {});
  }, []);

  // Coming back from Facebook login.
  useEffect(() => {
    const fb = params.get('fb');
    const fbError = params.get('fb_error');
    if (!fb && !fbError) return;
    if (fbError) toast(fbError, 'error');
    if (fb === 'connected') {
      toast('Facebook Page connected.', 'success');
      refreshPages();
    }
    if (fb === 'choose') {
      api(`/pages/${pageId}/facebook/accounts`).then((data) => setChoices(data.pages)).catch((error) => toast(error.message, 'error'));
    }
    setParams({}, { replace: true });
  }, [params, pageId, refreshPages, setParams, toast]);

  if (!page) return <div className="card p-6 text-sm text-slate-500">Loading page…</div>;

  const loginAvailable = integrations?.facebook.loginAvailable;

  const continueWithFacebook = async () => {
    try {
      const { url } = await api('/integrations/facebook/oauth/start', { method: 'POST', body: { pageId: page.id } });
      window.location.href = url;
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const chooseAnother = async () => {
    try {
      const data = await api(`/pages/${page.id}/facebook/accounts`);
      setChoices(data.pages);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const submitToken = async () => {
    try {
      const data = await api(`/pages/${page.id}/facebook/token`, { method: 'POST', body: { token: token.trim() } });
      setToken('');
      if (data.connected) {
        toast(`Connected to ${data.page.fb_page_name}.`, 'success');
        await refreshPages();
      } else {
        setChoices(data.pages);
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const testConnection = async () => {
    try {
      const data = await api(`/pages/${page.id}/facebook/check`);
      setCheck({ ok: true, text: `Working: "${data.page.name}" (ID ${data.page.id}).` });
      refreshPages();
    } catch (error) {
      setCheck({ ok: false, text: error.message });
    }
  };

  const disconnect = async () => {
    if (!(await confirm({ title: 'Disconnect Facebook?', message: 'Autopilot stops publishing to this page until you connect it again.', confirmLabel: 'Disconnect', danger: true }))) return;
    try {
      await api(`/pages/${page.id}/facebook`, { method: 'DELETE' });
      setCheck(null);
      toast('Disconnected.');
      refreshPages();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const facebookButton = (label) =>
    loginAvailable ? (
      <AsyncButton className="btn-fb !px-6 !py-3 text-base" busyLabel="Opening Facebook…" onClick={continueWithFacebook}><Facebook size={20} /> {label}</AsyncButton>
    ) : (
      <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
        {isSuperAdmin
          ? <>Facebook login is not set up yet. <Link to="/admin/settings" className="font-semibold underline">Set it up in Platform settings</Link> (one time for everyone).</>
          : 'Facebook login is not set up yet. Ask the administrator.'}
      </div>
    );

  return (
    <div>
      <PageHeader icon={Facebook} title="Facebook connection" description={<>Which Facebook Page <span className="font-bn font-semibold text-slate-700">{page.name}</span> publishes to.</>} />

      {page.fb_connected ? (
        <div className="card p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 size={28} /></div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Connected</p>
                <p className="text-lg font-semibold text-slate-900">{page.fb_page_name || 'Facebook Page'}</p>
                <p className="text-xs text-slate-500">Page ID {page.fb_page_id}{page.fb_connected_at ? ` · since ${formatDate(page.fb_connected_at, page.schedule.timezone)}` : ''} · <a href={`https://www.facebook.com/${page.fb_page_id}`} target="_blank" rel="noreferrer" className="font-semibold text-fb hover:underline">open <ExternalLink size={11} className="inline" /></a></p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <AsyncButton className="btn-secondary" busyLabel="Checking…" onClick={testConnection}><RefreshCw size={16} /> Test</AsyncButton>
              {integrations?.facebook.userConnected && <AsyncButton className="btn-secondary" busyLabel="Loading…" onClick={chooseAnother}>Switch page</AsyncButton>}
              <button type="button" className="btn btn-danger-soft" onClick={disconnect}><Unplug size={16} /> Disconnect</button>
            </div>
          </div>
          {check && <p className={clsx('mt-4 rounded-lg px-3 py-2 text-sm', check.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{check.text}</p>}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-fb text-white shadow-lg shadow-fb/30"><Facebook size={34} /></div>
            <h2 className="mt-5 text-xl font-bold text-slate-900">Connect your Facebook Page</h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">Log in with Facebook, tick the page you want PixGen Pilot to post to, and you're done. No tokens or settings to copy.</p>
            <div className="mt-6">{facebookButton('Continue with Facebook')}</div>
          </div>
          <div className="grid border-t border-slate-100 bg-slate-50/60 text-xs text-slate-500 sm:grid-cols-3">
            {[['1', 'Log in with Facebook'], ['2', 'Tick your page and allow posting'], ['3', 'Pick it here, autopilot starts']].map(([n, text]) => (
              <div key={n} className="flex items-center gap-2 px-5 py-3"><span className="grid h-5 w-5 place-items-center rounded-full bg-white font-bold text-slate-700 ring-1 ring-slate-200">{n}</span>{text}</div>
            ))}
          </div>
        </div>
      )}

      {choices && <div className="mt-6"><PagePicker pageId={page.id} pages={choices} onReconnect={continueWithFacebook} onConnected={() => { setChoices(null); refreshPages(); }} /></div>}

      <details className="card mt-6 p-5">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700"><ClipboardPaste size={16} /> Advanced: connect with an access token instead</summary>
        <div className="mt-4">
          <Field hint={<>A <b>Page</b> token connects directly. A <b>User</b> token (from Graph API Explorer) lists your pages to choose from. Permissions needed: <code>pages_show_list</code>, <code>pages_manage_posts</code>, <code>pages_read_engagement</code> (and <code>business_management</code> for Business Portfolio pages).</>}>
            <textarea rows={3} className="input font-mono text-xs" placeholder="EAAG…" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <div className="mt-3 flex justify-end">
            <AsyncButton busyLabel="Checking token…" onClick={submitToken} disabled={!token.trim()}><Plug size={16} /> Connect with token</AsyncButton>
          </div>
        </div>
      </details>
    </div>
  );
}
