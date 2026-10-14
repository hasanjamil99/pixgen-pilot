import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, Eye, ListOrdered, ListTodo, Send, Sparkles, Wand2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useConfirm } from '../components/Dialog.jsx';
import { PostCard } from '../components/PostActions.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, Field, formatDate, PageHeader, StatCard } from '../components/ui.jsx';
import { usePageById, usePages } from '../pagesContext.jsx';

const SOURCE_LABEL = { queue: 'your Content queue', idea: 'your Post ideas', autopilot: 'Gemini (queue and ideas are empty)' };

function LastRun({ schedule }) {
  if (schedule.running) return <span className="text-violet-600">Running now ({schedule.running.trigger})…</span>;
  const last = schedule.lastRun;
  if (!last) return <span className="text-slate-500">No runs since the server started.</span>;
  return (
    <span className={last.ok ? 'text-emerald-600' : 'text-red-600'}>
      {last.ok ? <CheckCircle2 size={14} className="mr-1 inline" /> : <XCircle size={14} className="mr-1 inline" />}
      {formatDate(last.finishedAt, schedule.timezone)} · {last.ok ? last.message : last.message}
    </span>
  );
}

export default function PageAutopilot() {
  const { pageId } = useParams();
  const page = usePageById(pageId);
  const { refreshPages } = usePages();
  const toast = useToast();
  const confirm = useConfirm();
  const [topic, setTopic] = useState('');
  const [result, setResult] = useState(null);
  const [next, setNext] = useState(null);
  const resultRef = useRef(null);
  const queuePending = page?.queue.pending;
  const ideasNew = page?.ideas?.new;

  useEffect(() => {
    if (!pageId) return;
    api(`/pages/${pageId}/next-topic`).then(setNext).catch(() => setNext(null));
  }, [pageId, queuePending, ideasNew, result]);

  if (!page) return <div className="card p-6 text-sm text-slate-500">Loading page…</div>;
  const timezone = page.schedule.timezone;

  const showResult = (entry) => {
    setResult(entry);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const preview = async () => {
    try {
      const data = await api(`/pages/${page.id}/preview`, { method: 'POST', body: { topic: topic.trim() } });
      showResult(data.entry);
      setTopic('');
      toast('Preview ready. Nothing was posted yet.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      refreshPages();
    }
  };

  const runNow = async () => {
    const ok = await confirm({
      title: 'Post to Facebook now?',
      message: `PixGen Pilot writes a new post for "${page.name}"${next?.topic ? ` about "${next.topic}"` : ''} and publishes it to Facebook immediately, without a review step.`,
      confirmLabel: 'Write and publish',
    });
    if (!ok) return;
    try {
      const data = await api(`/pages/${page.id}/run-now`, { method: 'POST' });
      showResult(data.entry);
      toast('Published to Facebook.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      refreshPages();
    }
  };

  return (
    <div>
      <PageHeader icon={Sparkles} title="Autopilot" description={<>Your daily Bangla post for <span className="font-bn font-semibold text-slate-700">{page.name}</span>, written and posted automatically.</>} />

      {!page.fb_connected && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 sm:flex-row sm:items-center">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="flex-1">This page is not connected to Facebook yet. You can still generate previews.</span>
          <Link to={`/pages/${page.id}/facebook`} className="btn btn-secondary btn-sm">Connect Facebook</Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Topics in queue" value={page.queue.pending} icon={ListTodo} tone="amber" />
        <StatCard label="Published" value={page.history.published} icon={Send} tone="emerald" />
        <StatCard label="Previews" value={page.history.preview_only} icon={Wand2} tone="sky" />
        <StatCard label="Failed" value={page.history.failed} icon={XCircle} tone="red" />
      </div>

      <div className="card mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">How your autopilot works</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${page.autopilot_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {page.autopilot_enabled ? 'Autopilot is ON' : 'Autopilot is OFF'}
          </span>
        </div>
        <ol className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            [CalendarClock, 'Every day on time', page.schedule.nextRun ? `Next: ${formatDate(page.schedule.nextRun, timezone)}` : 'Turn it on in Brand & schedule', `/pages/${page.id}/settings`, 'Change time'],
            [ListOrdered, 'Picks a topic', '1. Content queue → 2. Post ideas → 3. Gemini invents one from your niche', `/pages/${page.id}/queue`, 'Open queue'],
            [Wand2, 'Writes the post', 'Gemini writes a Bangla caption, PixGen Pilot designs the 1080×1080 banner', `/pages/${page.id}/settings`, 'Banner style'],
            [Send, 'Posts to Facebook', page.fb_connected ? `On ${page.fb_page_name || 'your page'}` : 'Connect Facebook first', `/pages/${page.id}/facebook`, page.fb_connected ? 'Connection' : 'Connect'],
          ].map(([Icon, title, text, to, cta], index) => (
            <li key={title} className="relative rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-violet-600 shadow-sm"><Icon size={15} /></span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Step {index + 1}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{text}</p>
              <Link to={to} className="mt-2 inline-block text-xs font-semibold text-violet-600 hover:underline">{cta} →</Link>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-col gap-1 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-3">
          <span className="font-semibold text-violet-800">Next topic:</span>
          <span className="font-bn text-slate-800">
            {next ? (next.topic || 'Gemini will invent a fresh topic from your page niche') : '…'}
          </span>
          {next && <span className="text-xs text-slate-500 sm:ml-auto">from {SOURCE_LABEL[next.source]}</span>}
        </div>
        <p className="mt-3 text-xs text-slate-500">Last run: <LastRun schedule={page.schedule} /></p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2"><Eye size={18} className="text-violet-600" /><h2 className="text-base font-semibold text-slate-900">Create a post to review</h2></div>
          <p className="mt-1 text-sm text-slate-500"><b className="text-slate-700">Nothing is posted.</b> You get the caption and banner, then you can edit it, schedule it, or publish it.</p>
          <Field label="Topic (optional)" hint={next ? `Leave empty to use the next topic above${next.source === 'autopilot' ? ' (Gemini picks one)' : ''}.` : ''} className="mt-4">
            <input className="input font-bn" placeholder="যেমন: বিয়ের আগে যে ৫টি প্রশ্ন করা জরুরি" maxLength={500} value={topic} onChange={(event) => setTopic(event.target.value)} />
          </Field>
          <div className="mt-auto pt-4">
            <AsyncButton className="btn-primary w-full" busyLabel="Writing… (up to a minute)" onClick={preview}><Wand2 size={16} /> Create post to review</AsyncButton>
          </div>
        </div>
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2"><Send size={18} className="text-fb" /><h2 className="text-base font-semibold text-slate-900">Post to Facebook now</h2></div>
          <p className="mt-1 text-sm text-slate-500">Does today's autopilot job immediately: uses the <b className="text-slate-700">next topic</b> above, writes the post and banner, and <b className="text-slate-700">publishes it to Facebook straight away</b> (no review step).</p>
          <p className="mt-3 text-xs text-slate-400">Want to check it first? Use "Create post to review" instead.</p>
          <div className="mt-auto pt-4">
            <AsyncButton className="btn-fb w-full" busyLabel="Writing and publishing…" onClick={runNow} disabled={!page.fb_connected}><Send size={16} /> Post to Facebook now</AsyncButton>
          </div>
        </div>
      </div>

      {result && (
        <div ref={resultRef} className="mt-8 scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Latest result</h2>
          <PostCard pageId={page.id} entry={result} timezone={timezone} onChanged={(entry) => { setResult(entry); refreshPages(); }} />
        </div>
      )}
    </div>
  );
}
