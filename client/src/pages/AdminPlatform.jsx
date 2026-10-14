import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, Globe, Image as ImageIcon, Save, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useConfirm } from '../components/Dialog.jsx';
import { Facebook } from '../components/FacebookIcon.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, copyText, Field, PageHeader } from '../components/ui.jsx';

function CopyRow({ label, value }) {
  const toast = useToast();
  return (
    <div>
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <div className="mt-1.5 flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">{value}</code>
        <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await copyText(value); toast('Copied.', 'success'); }}><Copy size={14} /></button>
      </div>
    </div>
  );
}

function PexelsCard() {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [key, setKey] = useState('');
  useEffect(() => {
    api('/admin/pexels').then(setState).catch(() => {});
  }, []);
  const save = async () => {
    try {
      setState(await api('/admin/pexels', { method: 'PUT', body: { apiKey: key.trim() } }));
      setKey('');
      toast('Pexels key saved. Pages can now use stock photos.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };
  const remove = async () => {
    try {
      setState(await api('/admin/pexels', { method: 'DELETE' }));
    } catch (error) {
      toast(error.message, 'error');
    }
  };
  return (
    <div className="card mt-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><ImageIcon size={22} /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Stock photos (Pexels, free)</h2>
            <p className="text-xs text-slate-500">Lets every page use a matching photo as the banner background.</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${state?.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {state?.configured ? `Active · ${state.masked}` : 'Not set up'}
        </span>
      </div>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>Create a free account at <a className="font-semibold text-violet-600 hover:underline" href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">pexels.com/api <ExternalLink size={12} className="inline" /></a> and click <b>Your API key</b>.</li>
        <li>Paste the key here and save.</li>
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <input type="password" className="input max-w-md flex-1 font-mono" autoComplete="off" placeholder={state?.masked || 'Pexels API key'} value={key} onChange={(event) => setKey(event.target.value)} />
        <AsyncButton busyLabel="Checking…" onClick={save} disabled={!key.trim()}><Save size={16} /> Save</AsyncButton>
        {state?.configured && <button type="button" className="btn btn-danger-soft" onClick={remove}><Trash2 size={16} /></button>}
      </div>
    </div>
  );
}

export default function AdminPlatform() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [configId, setConfigId] = useState('');

  const apply = (next) => {
    setData(next);
    setAppId(next.appId || '');
    setConfigId(next.configId || '');
    setAppSecret('');
  };

  useEffect(() => {
    api('/admin/facebook-app').then(apply).catch((error) => toast(error.message, 'error'));
  }, [toast]);

  const save = async () => {
    try {
      apply(await api('/admin/facebook-app', { method: 'PUT', body: { appId: appId.trim(), appSecret: appSecret.trim() || undefined, configId: configId.trim() } }));
      toast('Saved. Everyone can now use "Continue with Facebook".', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove the Facebook App?', message: 'Connected pages keep working, but nobody can use "Continue with Facebook" until you add it again.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      apply(await api('/admin/facebook-app', { method: 'DELETE' }));
      toast('Facebook App removed.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div>
      <PageHeader icon={Globe} title="Platform settings" description="Settings that apply to every account on this PixGen Pilot." />
      {!data ? (
        <div className="card p-6 text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="card p-5 lg:col-span-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-fb/10 text-fb"><Facebook size={22} /></div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Facebook App</h2>
                  <p className="text-xs text-slate-500">Powers "Continue with Facebook" for all users. Set it up once.</p>
                </div>
              </div>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${data.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${data.configured ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                {data.configured ? `Active${data.source === 'env' ? ' (from .env)' : ''}` : 'Not set up'}
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="App ID"><input className="input font-mono" inputMode="numeric" value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="1234567890123456" /></Field>
              <Field label={data.configured ? 'Replace App Secret' : 'App Secret'}>
                <input type="password" className="input font-mono" autoComplete="off" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder={data.maskedSecret || 'App Secret'} />
              </Field>
              <Field label="Login configuration ID (optional)" hint='Only for "Facebook Login for Business". Leave empty for classic Facebook Login.' className="sm:col-span-2">
                <input className="input font-mono" inputMode="numeric" value={configId} onChange={(event) => setConfigId(event.target.value)} />
              </Field>
            </div>

            <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <CopyRow label="Valid OAuth Redirect URI" value={data.redirectUri} />
              <CopyRow label="App domain / Site URL" value={data.siteUrl} />
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {data.configured && data.source === 'dashboard' && <button type="button" className="btn btn-danger-soft" onClick={remove}><Trash2 size={16} /> Remove</button>}
              <AsyncButton busyLabel="Saving…" onClick={save} disabled={!appId.trim()}><Save size={16} /> Save</AsyncButton>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div className="card p-5 text-sm text-slate-600">
              <h3 className="text-base font-semibold text-slate-900">Set up the app (one time, ~10 minutes)</h3>
              <ol className="mt-3 list-decimal space-y-2.5 pl-5">
                <li>Open <a className="font-semibold text-violet-600 hover:underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps <ExternalLink size={12} className="inline" /></a> and click <b>Create App</b>. Name it <b>PixGen Pilot</b>.</li>
                <li>Use case: <b>Manage everything on your Page</b> (or app type <b>Business</b>).</li>
                <li>In <b>Facebook Login → Settings</b>, paste the <b>Valid OAuth Redirect URI</b> from the left and save.</li>
                <li>In <b>App settings → Basic</b>: add <code>{new URL(data.siteUrl).host}</code> to <b>App domains</b>, then copy the <b>App ID</b> and <b>App Secret</b> here.</li>
                <li>Make sure the permissions {data.scopes.map((scope, index) => <span key={scope}>{index > 0 && ', '}<code>{scope}</code></span>)} are added (they come with the use case).</li>
              </ol>
            </div>

            <div className="card border-amber-200 bg-amber-50/60 p-5 text-sm text-amber-900">
              <h3 className="flex items-center gap-2 text-base font-semibold"><AlertTriangle size={18} /> Before customers can log in</h3>
              <p className="mt-2">While the app is in <b>Development</b> mode, only people with a role on the app can use "Continue with Facebook": you (admin) and anyone you add under <b>App roles → Testers</b>.</p>
              <p className="mt-2">To let any customer log in, switch the app to <b>Live</b>. That needs a Privacy Policy URL, Meta's <b>App Review</b> for the page permissions, and <b>Business Verification</b>. Until then, customers can be added as Testers, or paste a Page token.</p>
            </div>
          </div>
        </div>
      )}
      <PexelsCard />
    </div>
  );
}
