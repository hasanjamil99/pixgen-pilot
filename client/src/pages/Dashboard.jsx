import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, CalendarClock, Download, Lightbulb, CheckCircle2, Circle, KeyRound, ListTodo, Plus, Send, Sparkles } from 'lucide-react';
import { Facebook } from '../components/FacebookIcon.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { usePages } from '../pagesContext.jsx';
import { Badge, formatDate, PageHeader, StatCard } from '../components/ui.jsx';

function Step({ done, title, children, to, cta }) {
  return (
    <div className="flex items-start gap-3 py-3">
      {done ? <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-500" /> : <Circle size={20} className="mt-0.5 shrink-0 text-slate-300" />}
      <div className="min-w-0 flex-1">
        <p className={clsx('text-sm font-semibold', done ? 'text-slate-500 line-through' : 'text-slate-900')}>{title}</p>
        <p className="text-xs text-slate-500">{children}</p>
      </div>
      {!done && to && <Link to={to} className="btn btn-secondary btn-sm shrink-0">{cta} <ArrowRight size={14} /></Link>}
    </div>
  );
}

function PageCard({ page }) {
  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fb/10 text-fb"><Facebook size={20} /></div>
          <div className="min-w-0">
            <Link to={`/pages/${page.id}`} className="block truncate font-bn font-semibold text-slate-900 hover:text-violet-700">{page.name}</Link>
            <p className="truncate text-xs text-slate-500">{page.fb_connected ? page.fb_page_name || `Page ${page.fb_page_id}` : 'Not connected to Facebook'}</p>
          </div>
        </div>
        <Badge status={page.fb_connected ? 'active' : 'pending'}>{page.fb_connected ? 'connected' : 'setup needed'}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 py-2"><p className="font-display text-lg font-bold">{page.queue.pending}</p><p className="text-[11px] text-slate-500">queued</p></div>
        <div className="rounded-xl bg-slate-50 py-2"><p className="font-display text-lg font-bold text-emerald-600">{page.history.published}</p><p className="text-[11px] text-slate-500">published</p></div>
        <div className="rounded-xl bg-slate-50 py-2"><p className="font-display text-lg font-bold text-red-500">{page.history.failed}</p><p className="text-[11px] text-slate-500">failed</p></div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <CalendarClock size={14} />
        {page.schedule.nextRun ? `Next post ${formatDate(page.schedule.nextRun, page.schedule.timezone)}` : 'Autopilot off'}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs font-semibold">
        <Link to={`/pages/${page.id}/ideas`} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-violet-700 hover:bg-violet-50"><Lightbulb size={14} /> Ideas{page.ideas?.new ? ` (${page.ideas.new})` : ''}</Link>
        <Link to={`/pages/${page.id}/queue`} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-slate-600 hover:bg-slate-50"><ListTodo size={14} /> Queue</Link>
        <Link to={`/pages/${page.id}`} className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-slate-600 hover:bg-slate-50">Open <ArrowRight size={14} /></Link>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { pages } = usePages();
  const { openNewPage } = useOutletContext();
  const [integrations, setIntegrations] = useState(null);

  useEffect(() => {
    api('/integrations').then(setIntegrations).catch(() => {});
  }, []);

  const list = pages || [];
  const totals = list.reduce(
    (acc, page) => ({
      queued: acc.queued + page.queue.pending,
      published: acc.published + page.history.published,
      connected: acc.connected + (page.fb_connected ? 1 : 0),
    }),
    { queued: 0, published: 0, connected: 0 },
  );
  const first = list[0];
  const steps = [
    { done: Boolean(integrations?.gemini.configured), title: 'Add your Gemini API key', text: 'Gemini writes your Bangla posts and banner text.', to: '/integrations', cta: 'Add key' },
    { done: totals.connected > 0, title: 'Add your Facebook Pages', text: 'Import them from Facebook: log in once and tick every page you want to manage.', to: '/pages/import', cta: 'Import pages' },
    { done: totals.queued > 0 || totals.published > 0, title: 'Pick post ideas', text: 'Let Gemini suggest Bangla topics, or write your own, and add them to the queue.', to: first ? `/pages/${first.id}/ideas` : null, cta: 'Post ideas' },
    { done: totals.published > 0, title: 'Preview and publish your first post', text: 'Generate a preview, check it, then publish — or let the daily schedule do it.', to: first ? `/pages/${first.id}` : null, cta: 'Open autopilot' },
  ];
  const allDone = steps.every((step) => step.done);

  return (
    <div>
      <PageHeader
        title={`Welcome${user.name ? `, ${user.name.split(' ')[0]}` : ''}`}
        description="Your Bangla Facebook autopilot: Gemini writes the post, PixGen Pilot designs the banner and publishes it on schedule."
        actions={
          <>
            <Link to="/pages/import" className="btn btn-fb"><Download size={16} /> Import pages from Facebook</Link>
            <button type="button" className="btn btn-secondary" onClick={openNewPage}><Plus size={16} /> Add manually</button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pages" value={list.length} icon={Facebook} tone="sky" />
        <StatCard label="Connected" value={totals.connected} icon={CheckCircle2} tone="emerald" />
        <StatCard label="Topics queued" value={totals.queued} icon={ListTodo} tone="amber" />
        <StatCard label="Posts published" value={totals.published} icon={Send} tone="violet" />
      </div>

      {!allDone && (
        <div className="card mt-6 p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Sparkles size={18} className="text-violet" /> Getting started</h2>
          <div className="mt-2 divide-y divide-slate-100">
            {steps.map((step) =>
              step.onClick && !step.done ? (
                <div key={step.title} className="flex items-start gap-3 py-3">
                  <Circle size={20} className="mt-0.5 shrink-0 text-slate-300" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                    <p className="text-xs text-slate-500">{step.text}</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={step.onClick}>{step.cta} <ArrowRight size={14} /></button>
                </div>
              ) : (
                <Step key={step.title} done={step.done} title={step.title} to={step.to} cta={step.cta}>{step.text}</Step>
              ),
            )}
          </div>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">Your pages</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((page) => <PageCard key={page.id} page={page} />)}
        <Link to="/pages/import" className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-fb hover:text-fb">
          <Download size={22} />
          <span className="text-sm font-semibold">Import pages from Facebook</span>
          <span className="text-xs text-slate-400">Add several at once</span>
        </Link>
      </div>

      {integrations && !integrations.gemini.configured && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <KeyRound size={18} className="shrink-0" />
          <span className="flex-1">Add your Gemini API key before generating posts.</span>
          <Link to="/integrations" className="btn btn-secondary btn-sm">Integrations</Link>
        </div>
      )}
    </div>
  );
}
