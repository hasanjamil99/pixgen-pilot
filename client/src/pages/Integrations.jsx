import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, Save, Trash2, Zap } from 'lucide-react';
import { Facebook } from '../components/FacebookIcon.jsx';
import { api } from '../api.js';
import { useConfirm } from '../components/Dialog.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, Field, formatDate, PageHeader } from '../components/ui.jsx';

const MODEL_SUGGESTIONS = ['gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-2.5-flash', 'gemini-2.5-pro'];

function Status({ ok, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {children}
    </span>
  );
}

function GeminiCard({ data, onChange }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(data.gemini.model);
  const [test, setTest] = useState(null);

  const runTest = async () => {
    try {
      const result = await api('/integrations/gemini/test', { method: 'POST', body: { apiKey: apiKey.trim() || undefined, model } });
      setTest({ ok: true, text: `Key works with ${result.displayName}.` });
    } catch (error) {
      setTest({ ok: false, text: error.message });
    }
  };

  const save = async () => {
    try {
      const next = await api('/integrations/gemini', { method: 'PUT', body: { apiKey: apiKey.trim() || undefined, model } });
      setApiKey('');
      onChange(next);
      toast('Gemini settings saved.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove Gemini key?', message: 'Posts cannot be generated until you add a key again.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      onChange(await api('/integrations/gemini', { method: 'DELETE' }));
      setTest(null);
      toast('Gemini key removed.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sky-100 to-violet-100 text-violet-600"><Bot size={22} /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Google Gemini</h2>
            <p className="text-xs text-slate-500">Writes the Bangla post and banner text.</p>
          </div>
        </div>
        <Status ok={data.gemini.configured}>{data.gemini.configured ? `Key saved · ${data.gemini.masked}` : 'Not set'}</Status>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={data.gemini.configured ? 'Replace API key' : 'API key'} hint={<>Get one at <a className="font-semibold text-violet-600 hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. The project needs billing or credits.</>}>
          <input type="password" className="input font-mono" autoComplete="off" placeholder={data.gemini.configured ? data.gemini.masked : 'AIza… or AQ.…'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </Field>
        <Field label="Model" hint="Any model name from Google AI Studio.">
          <input className="input font-mono" list="gemini-models" value={model} onChange={(event) => setModel(event.target.value)} />
          <datalist id="gemini-models">{MODEL_SUGGESTIONS.map((name) => <option key={name} value={name} />)}</datalist>
        </Field>
      </div>
      {test && <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${test.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{test.text}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {data.gemini.configured && <button type="button" className="btn btn-danger-soft" onClick={remove}><Trash2 size={16} /> Remove key</button>}
        <AsyncButton className="btn-secondary" busyLabel="Testing…" onClick={runTest} disabled={!apiKey.trim() && !data.gemini.configured}><Zap size={16} /> Test</AsyncButton>
        <AsyncButton busyLabel="Saving…" onClick={save}><Save size={16} /> Save</AsyncButton>
      </div>
    </div>
  );
}

function FacebookLoginCard({ data, onChange }) {
  const toast = useToast();
  const fb = data.facebook;

  const forget = async () => {
    try {
      onChange(await api('/integrations/facebook-user', { method: 'DELETE' }));
      toast('Saved Facebook login removed.');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-fb/10 text-fb"><Facebook size={22} /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Facebook</h2>
            <p className="text-xs text-slate-500">Nothing to set up here: open a page → Facebook connection → Continue with Facebook.</p>
          </div>
        </div>
        <Status ok={fb.userConnected}>{fb.userConnected ? 'Logged in' : fb.loginAvailable ? 'Ready' : 'Not available yet'}</Status>
      </div>
      {fb.userConnected && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span className="flex items-center gap-1.5"><CheckCircle2 size={16} className="text-emerald-500" /> Facebook login saved{fb.userTokenExpiresAt ? ` (until ${formatDate(fb.userTokenExpiresAt)})` : ''}. Connected pages keep posting even after it expires.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={forget}>Forget login</button>
        </div>
      )}
      {!fb.loginAvailable && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Facebook login has not been set up on this platform yet.</p>}
    </div>
  );
}

export default function Integrations() {
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    api('/integrations').then(setData).catch((error) => toast(error.message, 'error'));
  }, [toast]);

  return (
    <div>
      <PageHeader icon={KeyRound} title="Integrations" description="Your Gemini API key (encrypted in the database, only shown masked). Every page in your account uses it." />
      {data ? (
        <div className="space-y-6">
          <GeminiCard data={data} onChange={setData} />
          <FacebookLoginCard data={data} onChange={setData} />
        </div>
      ) : (
        <div className="card p-6 text-sm text-slate-500">Loading…</div>
      )}
    </div>
  );
}
