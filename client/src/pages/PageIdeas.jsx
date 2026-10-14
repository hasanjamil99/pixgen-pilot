import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ExternalLink, Lightbulb, ListPlus, PenLine, Radar, RotateCcw, Save, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { api } from '../api.js';
import { PostCard } from '../components/PostActions.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, Badge, EmptyState, Field, formatDate, PageHeader, Toggle } from '../components/ui.jsx';
import { usePageById, usePages } from '../pagesContext.jsx';

const TABS = [
  ['new', 'New'],
  ['queued', 'Queued'],
  ['used', 'Used'],
  ['dismissed', 'Dismissed'],
];

const HINTS = ['ঈদ উপলক্ষে', 'নতুনদের জন্য সহজ টিপস', 'সাধারণ ভুল ও সমাধান', 'প্রশ্ন-উত্তর ধরনের পোস্ট', 'অনুপ্রেরণামূলক গল্প'];

const STATUS_STYLE = { new: 'pending', queued: 'processing', used: 'published', dismissed: 'disabled' };

function IdeaCard({ idea, onQueue, onPreview, onStatus }) {
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        {idea.category ? <span className="rounded-full bg-violet-50 px-2 py-0.5 font-bn text-[11px] font-semibold text-violet-700">{idea.category}</span> : <span />}
        <Badge status={STATUS_STYLE[idea.status]}>{idea.status}</Badge>
      </div>
      <p className="mt-3 font-bn text-[15px] font-semibold leading-snug text-slate-900">{idea.topic}</p>
      {idea.angle && <p className="mt-1.5 font-bn text-sm leading-relaxed text-slate-500">{idea.angle}</p>}
      <p className="mt-3 text-[11px] text-slate-400">{formatDate(idea.created_at)}</p>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        {idea.status === 'new' && (
          <>
            <AsyncButton className="btn-primary btn-sm" busyLabel="Adding…" onClick={() => onQueue(idea)}><ListPlus size={14} /> Add to queue</AsyncButton>
            <AsyncButton className="btn-secondary btn-sm" busyLabel="Generating…" onClick={() => onPreview(idea)}><Wand2 size={14} /> Preview now</AsyncButton>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus(idea, 'dismissed')}><X size={14} /> Dismiss</button>
          </>
        )}
        {idea.status === 'dismissed' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus(idea, 'new')}><RotateCcw size={14} /> Restore</button>}
        {(idea.status === 'queued' || idea.status === 'used') && (
          <AsyncButton className="btn-secondary btn-sm" busyLabel="Generating…" onClick={() => onPreview(idea)}><Wand2 size={14} /> Preview again</AsyncButton>
        )}
      </div>
    </div>
  );
}

function InsightList({ title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item) => <li key={item} className="flex gap-2 font-bn text-sm text-slate-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />{item}</li>)}
      </ul>
    </div>
  );
}

function AutoResearch({ page, onIdeasAdded }) {
  const toast = useToast();
  const { refreshPages } = usePages();
  const [state, setState] = useState(null);
  const [competitors, setCompetitors] = useState(page.competitors || '');
  const [count, setCount] = useState(10);

  const load = useCallback(async () => {
    try {
      const data = await api(`/pages/${page.id}/research`);
      setState(data);
      return data;
    } catch (error) {
      toast(error.message, 'error');
      return null;
    }
  }, [page.id, toast]);

  useEffect(() => {
    load();
    setCompetitors(page.competitors || '');
  }, [load, page.competitors]);

  useEffect(() => {
    if (state?.job?.status !== 'running') return undefined;
    const timer = setInterval(async () => {
      const next = await load();
      if (next?.job && next.job.status !== 'running') {
        if (next.job.status === 'done') toast(`Research done: ${next.job.ideasAdded} new ideas.`, 'success');
        else toast(next.job.error || 'Research failed.', 'error');
        onIdeasAdded();
        refreshPages();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [state?.job?.status, load, onIdeasAdded, refreshPages, toast]);

  const save = async (fields, message) => {
    try {
      await api(`/pages/${page.id}`, { method: 'PUT', body: fields });
      await refreshPages();
      if (message) toast(message, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const start = async () => {
    try {
      if ((competitors || '') !== (page.competitors || '')) await api(`/pages/${page.id}`, { method: 'PUT', body: { competitors } });
      const data = await api(`/pages/${page.id}/research`, { method: 'POST', body: { count } });
      setState((current) => ({ ...current, job: data.job }));
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const research = state?.research;
  const running = state?.job?.status === 'running';

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-4 bg-gradient-to-r from-sky-50 to-violet-50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-violet-600 shadow-sm"><Radar size={22} /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Auto research — no keywords needed</h2>
            <p className="mt-0.5 text-sm text-slate-600">Reads your page's posts and what gets engagement, researches competitors and Bangladesh trends with Google Search, then suggests ideas in your page's style.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select className="input !w-auto !py-2" value={count} onChange={(event) => setCount(Number(event.target.value))} disabled={running}>
            {[5, 10, 20, 30].map((n) => <option key={n} value={n}>{n} ideas</option>)}
          </select>
          <AsyncButton busyLabel="Starting…" onClick={start} disabled={running}><Radar size={16} /> {research ? 'Research again' : 'Research my page'}</AsyncButton>
        </div>
      </div>

      {running && (
        <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-3 text-sm text-violet-700">
          <span className="spinner" /> {state.job.step || 'Working…'} <span className="text-xs text-slate-400">(1–3 minutes)</span>
        </div>
      )}

      <div className="grid gap-6 p-5 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {research ? (
            <>
              <p className="text-xs text-slate-500">
                Last research {formatDate(research.at)} · {research.postsAnalyzed} posts analysed · {research.ideasAdded} ideas added
                {research.trigger === 'weekly' ? ' · weekly' : ''}
              </p>
              {research.facebookError && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Could not read the Facebook page: {research.facebookError}</p>}
              {!research.searchUsed && research.searchError && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Google Search research was not available ({research.searchError}). Ideas are based on your page only.</p>}
              <div className="grid gap-3 sm:grid-cols-3">
                {[['Niche', research.analysis.niche], ['Audience', research.analysis.audience], ['Tone', research.analysis.tone]].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
                    <p className="mt-1 font-bn text-sm text-slate-800">{value || '–'}</p>
                  </div>
                ))}
              </div>
              <InsightList title="Content pillars" items={research.analysis.pillars} />
              <InsightList title="What gets engagement" items={research.analysis.what_works} />
              <InsightList title="Competitors & trends" items={research.analysis.competitor_insights} />
              {research.sources?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Sources</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {research.sources.map((source) => (
                      <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[16rem] items-center gap-1 truncate rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-violet-50 hover:text-violet-700">
                        <ExternalLink size={11} className="shrink-0" /> <span className="truncate">{source.title}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No research yet. Click <b>Research my page</b>: it takes 1–3 minutes and adds ideas below.</p>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Field label="Competitors (optional)" hint="One per line: Facebook page name, link or website. Leave empty and Gemini finds similar pages itself.">
            <textarea rows={4} className="input text-sm" value={competitors} onChange={(event) => setCompetitors(event.target.value)} placeholder={'যেমন: Bibaho.com\nhttps://www.facebook.com/...'} />
          </Field>
          {(competitors || '') !== (page.competitors || '') && (
            <AsyncButton className="btn-secondary btn-sm" onClick={() => save({ competitors }, 'Competitors saved.')}><Save size={14} /> Save competitors</AsyncButton>
          )}
          <div className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <Toggle checked={Boolean(page.auto_research)} onChange={(value) => save({ auto_research: value }, value ? 'Weekly research on (Mondays 09:00).' : 'Weekly research off.')} label="Research automatically every week" description="Every Monday 09:00, new ideas appear by themselves." />
            <Toggle checked={page.use_ideas !== false} onChange={(value) => save({ use_ideas: value }, value ? 'Autopilot will use new ideas.' : 'Autopilot will not use ideas.')} label="Autopilot uses ideas" description="When the queue is empty, the daily post and the planner take the oldest new idea." />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PageIdeas() {
  const { pageId } = useParams();
  const page = usePageById(pageId);
  const { refreshPages } = usePages();
  const toast = useToast();
  const [tab, setTab] = useState('new');
  const [data, setData] = useState(null);
  const [hint, setHint] = useState('');
  const [count, setCount] = useState(10);
  const [custom, setCustom] = useState('');
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/pages/${pageId}/ideas?status=${tab}`));
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [pageId, tab, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    load();
    refreshPages();
  };

  const generate = async () => {
    try {
      const result = await api(`/pages/${pageId}/ideas/generate`, { method: 'POST', body: { hint: hint.trim(), count } });
      toast(`${result.ideas.length} new ideas ready.`, 'success');
      setTab('new');
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const queueIdea = async (idea) => {
    try {
      await api(`/pages/${pageId}/ideas/${idea.id}/queue`, { method: 'POST', body: {} });
      toast('Added to the content queue.', 'success');
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const runPreview = async (topic, ideaId) => {
    try {
      const result = await api(`/pages/${pageId}/preview`, { method: 'POST', body: { topic, ideaId } });
      setPreview(result.entry);
      toast('Preview ready. Nothing was posted yet.', 'success');
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const setStatus = async (idea, status) => {
    try {
      await api(`/pages/${pageId}/ideas/${idea.id}/status`, { method: 'POST', body: { status } });
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const queueCustom = async () => {
    try {
      await api(`/pages/${pageId}/queue`, { method: 'POST', body: { topic: custom.trim() } });
      toast('Your idea was added to the content queue.', 'success');
      setCustom('');
      refreshPages();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const clearDismissed = async () => {
    try {
      const result = await api(`/pages/${pageId}/ideas/dismissed`, { method: 'DELETE' });
      toast(`Removed ${result.deleted} dismissed idea${result.deleted === 1 ? '' : 's'}.`);
      changed();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const counts = data?.counts;

  return (
    <div>
      <PageHeader icon={Lightbulb} title="Post ideas" description={<>Fresh Bangla post ideas for <span className="font-bn font-semibold text-slate-700">{page?.name || '…'}</span>. Take one into the queue, preview it now, or write your own.</>} />

      {page && <div className="mb-6"><AutoResearch page={page} onIdeasAdded={() => { setTab('new'); load(); }} /></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-4 p-5">
          <div className="flex items-center gap-2"><Sparkles size={18} className="text-violet-600" /><h2 className="text-base font-semibold text-slate-900">Quick ideas with a focus</h2></div>
          <p className="text-sm text-slate-500">Based on the page niche. Ideas already posted, queued or suggested are skipped.</p>
          <Field label="Focus (optional)" hint="Steer the ideas, e.g. a season, an offer or a type of post.">
            <input className="input font-bn" maxLength={300} value={hint} onChange={(event) => setHint(event.target.value)} placeholder="যেমন: ঈদ উপলক্ষে" />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {HINTS.map((item) => (
              <button key={item} type="button" className="rounded-full bg-slate-100 px-2.5 py-1 font-bn text-xs text-slate-600 hover:bg-violet-50 hover:text-violet-700" onClick={() => setHint(item)}>{item}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              How many
              <select className="input !w-auto !py-1.5" value={count} onChange={(event) => setCount(Number(event.target.value))}>
                {[5, 10, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <AsyncButton busyLabel="Thinking… (up to a minute)" onClick={generate}><Sparkles size={16} /> Get ideas</AsyncButton>
          </div>
        </div>

        <div className="card space-y-4 p-5">
          <div className="flex items-center gap-2"><PenLine size={18} className="text-fb" /><h2 className="text-base font-semibold text-slate-900">Your own idea</h2></div>
          <p className="text-sm text-slate-500">Write any topic. Gemini turns it into a Bangla post and banner.</p>
          <Field label="Topic">
            <textarea rows={3} className="input font-bn" maxLength={500} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="যেমন: বিয়ের আগে দুই পরিবারের যে ৫টি বিষয় আলোচনা করা জরুরি" />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <AsyncButton className="btn-secondary" busyLabel="Adding…" onClick={queueCustom} disabled={!custom.trim()}><ListPlus size={16} /> Add to queue</AsyncButton>
            <AsyncButton busyLabel="Generating… (up to a minute)" onClick={() => runPreview(custom.trim())} disabled={!custom.trim()}><Wand2 size={16} /> Preview now</AsyncButton>
          </div>
        </div>
      </div>

      {preview && (
        <div ref={previewRef} className="mt-8 scroll-mt-24">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Preview</h2>
          <PostCard pageId={Number(pageId)} entry={preview} timezone={page?.schedule.timezone} onChanged={(entry) => { setPreview(entry); refreshPages(); }} />
        </div>
      )}

      <div className="mb-4 mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium transition', tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              {label}{counts ? <span className="ml-1 text-xs text-slate-400">{counts[key]}</span> : null}
            </button>
          ))}
        </div>
        {tab === 'dismissed' && counts?.dismissed > 0 && <AsyncButton className="btn-secondary btn-sm" onClick={clearDismissed}><Trash2 size={14} /> Delete dismissed</AsyncButton>}
      </div>

      {data && data.ideas.length === 0 ? (
        <EmptyState icon={Lightbulb} title={tab === 'new' ? 'No new ideas yet' : `No ${tab} ideas`}>
          {tab === 'new' ? 'Click "Get ideas" to let Gemini suggest Bangla post topics for this page.' : 'Ideas you act on appear here.'}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onQueue={queueIdea} onPreview={(item) => runPreview(item.topic, item.id)} onStatus={setStatus} />
          ))}
        </div>
      )}
    </div>
  );
}
