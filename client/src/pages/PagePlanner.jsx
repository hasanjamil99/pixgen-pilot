import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Clock,
  Lightbulb,
  PencilLine,
  Plus,
  Radar,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { Modal, useConfirm } from '../components/Dialog.jsx';
import { PostEditor } from '../components/PostEditor.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, EmptyState, Field, PageHeader, zonedInputParts } from '../components/ui.jsx';
import { usePageById, usePages } from '../pagesContext.jsx';

const dayLabel = (iso, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const timeLabel = (iso, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const shortDate = (iso, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function StepTitle({ n, title, done, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold', done ? 'bg-emerald-500 text-white' : 'bg-gradient-to-br from-pilot to-violet text-white')}>
        {done ? <CheckCircle2 size={16} /> : n}
      </span>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {children && <p className="mt-0.5 text-sm text-slate-500">{children}</p>}
      </div>
    </div>
  );
}

function Choice({ checked, onClick, title, text }) {
  return (
    <button type="button" onClick={onClick} className={clsx('flex-1 rounded-xl border p-3 text-left transition', checked ? 'border-violet bg-violet-50 ring-2 ring-violet/20' : 'border-slate-200 hover:bg-slate-50')}>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-0.5 text-xs text-slate-500">{text}</p>
    </button>
  );
}

/** A planned post is only a topic + time until it is written the day before. */
function PlannedEditor({ pageId, entry, timezone, onClose, onDone }) {
  const toast = useToast();
  const [topic, setTopic] = useState(entry.topic);
  const [when, setWhen] = useState(zonedInputParts(entry.scheduled_at, timezone));

  const run = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message, 'success');
      onDone();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <Modal title="Planned post" onClose={onClose}>
      <p className="text-sm text-slate-500">This post will be written by Gemini about 24 hours before it is published. You can change the topic or time now, or write it right away.</p>
      <div className="mt-4 space-y-4">
        <Field label="Topic"><textarea rows={3} className="input font-bn" maxLength={500} value={topic} onChange={(event) => setTopic(event.target.value)} /></Field>
        <Field label={`Publish at (${timezone})`}>
          <div className="flex gap-2">
            <input type="date" className="input !w-auto" value={when.date} onChange={(event) => setWhen((w) => ({ ...w, date: event.target.value }))} />
            <input type="time" className="input !w-auto" value={when.time} onChange={(event) => setWhen((w) => ({ ...w, time: event.target.value }))} />
          </div>
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <AsyncButton className="btn-danger-soft" onClick={() => run(() => api(`/pages/${pageId}/history/${entry.id}/unschedule`, { method: 'POST' }), 'Removed from the plan and moved back to Post ideas.')}>
          <X size={16} /> Remove from plan
        </AsyncButton>
        <div className="flex flex-wrap gap-2">
          <AsyncButton className="btn-secondary" busyLabel="Writing…" onClick={() => run(() => api(`/pages/${pageId}/history/${entry.id}/regenerate`, { method: 'POST' }), 'Post written. Open it to review.')}>
            <Wand2 size={16} /> Write it now
          </AsyncButton>
          <AsyncButton
            busyLabel="Saving…"
            onClick={() => run(async () => {
              if (topic.trim() !== entry.topic) await api(`/pages/${pageId}/history/${entry.id}`, { method: 'PUT', body: { topic: topic.trim() } });
              await api(`/pages/${pageId}/history/${entry.id}/schedule`, { method: 'POST', body: when });
            }, 'Saved.')}
          >
            Save
          </AsyncButton>
        </div>
      </div>
    </Modal>
  );
}

export default function PagePlanner() {
  const { pageId } = useParams();
  const page = usePageById(pageId);
  const { refreshPages } = usePages();
  const toast = useToast();
  const confirm = useConfirm();
  const timezone = page?.schedule.timezone || 'Asia/Dhaka';

  const [ideas, setIdeas] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [research, setResearch] = useState(null);
  const [rows, setRows] = useState(null);
  const [job, setJob] = useState(null);
  const [editing, setEditing] = useState(null);

  const [startDate, setStartDate] = useState(() => zonedInputParts(new Date(Date.now() + 24 * 3600 * 1000), timezone).date);
  const [times, setTimes] = useState(['10:00']);
  const [write, setWrite] = useState('day_before');
  const [approval, setApproval] = useState(null);

  const loadIdeas = useCallback(async () => {
    const data = await api(`/pages/${pageId}/ideas?status=new`);
    // Oldest first, so the plan follows the order ideas were suggested.
    const list = [...data.ideas].reverse();
    setIdeas(list);
    setSelected(new Set(list.map((idea) => idea.id)));
  }, [pageId]);

  const loadPlan = useCallback(async () => {
    const data = await api(`/pages/${pageId}/scheduled`);
    setRows(data.rows);
    setJob(data.job);
    return data.job;
  }, [pageId]);

  const loadResearch = useCallback(async () => {
    const data = await api(`/pages/${pageId}/research`);
    setResearch(data);
    return data;
  }, [pageId]);

  useEffect(() => {
    Promise.all([loadIdeas(), loadPlan(), loadResearch()]).catch((error) => toast(error.message, 'error'));
  }, [loadIdeas, loadPlan, loadResearch, toast]);

  useEffect(() => {
    if (page && approval === null) setApproval(page.plan_approval || 'auto');
  }, [page, approval]);

  // Poll research and "write now" jobs.
  useEffect(() => {
    if (research?.job?.status !== 'running') return undefined;
    const timer = setInterval(async () => {
      const next = await loadResearch().catch(() => null);
      if (next?.job && next.job.status !== 'running') {
        if (next.job.status === 'done') toast(`${next.job.ideasAdded} ideas ready. Tick the ones you like and schedule them.`, 'success');
        else toast(next.job.error || 'Research failed.', 'error');
        loadIdeas();
        refreshPages();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [research?.job?.status, loadResearch, loadIdeas, refreshPages, toast]);

  useEffect(() => {
    if (job?.status !== 'running') return undefined;
    const timer = setInterval(async () => {
      const next = await loadPlan().catch(() => null);
      if (next && next.status !== 'running') {
        refreshPages();
        toast(next.status === 'done' ? `${next.created.length} posts written. Review them below.` : 'Writing stopped; the rest will be written automatically the day before.', next.status === 'done' ? 'success' : 'info');
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [job?.status, loadPlan, refreshPages, toast]);

  const researchRunning = research?.job?.status === 'running';
  const needsApproval = (rows || []).filter((row) => row.status === 'scheduled' && !row.approved).length;

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of rows || []) {
      const key = zonedInputParts(row.scheduled_at, timezone).date;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return [...map.entries()];
  }, [rows, timezone]);

  const startResearch = async () => {
    try {
      const data = await api(`/pages/${pageId}/research`, { method: 'POST', body: { count: 30 } });
      setResearch((current) => ({ ...current, job: data.job }));
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const quickIdeas = async () => {
    try {
      const data = await api(`/pages/${pageId}/ideas/generate`, { method: 'POST', body: { count: 30 } });
      toast(`${data.ideas.length} ideas ready.`, 'success');
      await loadIdeas();
      refreshPages();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const toggle = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const days = Math.ceil(selected.size / Math.max(times.length, 1));

  const approve = async () => {
    const ok = await confirm({
      title: `Schedule ${selected.size} posts?`,
      message: `${selected.size} ideas get a date from ${startDate}, ${times.length} per day at ${times.join(' and ')} (${timezone}), about ${days} day${days === 1 ? '' : 's'}. ${write === 'now' ? 'All posts are written now.' : 'Each post is written about 24 hours before it is published.'} ${approval === 'manual' ? 'Each written post waits for your approval.' : 'Posts publish automatically at their time.'}`,
      confirmLabel: 'Approve & schedule',
    });
    if (!ok) return;
    try {
      const data = await api(`/pages/${pageId}/plan/approve`, { method: 'POST', body: { ideaIds: [...selected], startDate, times, write, approval } });
      toast(`${data.planned} posts scheduled from ${shortDate(data.from, timezone)} to ${shortDate(data.to, timezone)}.`, 'success');
      if (data.job) setJob(data.job);
      await Promise.all([loadIdeas(), loadPlan()]);
      refreshPages();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const approveAll = async () => {
    try {
      const data = await api(`/pages/${pageId}/scheduled/approve-all`, { method: 'POST' });
      toast(`${data.approved} posts approved.`, 'success');
      loadPlan();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const approveOne = async (row) => {
    try {
      await api(`/pages/${pageId}/history/${row.id}/approve`, { method: 'POST' });
      loadPlan();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const remove = async (row) => {
    if (!(await confirm({ title: 'Remove this post from the plan?', message: row.status === 'planned' ? 'Its topic goes back to Post ideas.' : 'The written post is deleted and will not be published.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      if (row.status === 'planned') await api(`/pages/${pageId}/history/${row.id}/unschedule`, { method: 'POST' });
      else await api(`/pages/${pageId}/history/${row.id}`, { method: 'DELETE' });
      await Promise.all([loadPlan(), loadIdeas()]);
      refreshPages();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const cancelJob = async () => {
    try {
      const data = await api(`/pages/${pageId}/plan`, { method: 'DELETE' });
      setJob(data.job);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const setTime = (index, value) => setTimes((current) => current.map((time, i) => (i === index ? value : time)));

  return (
    <div>
      <PageHeader icon={CalendarDays} title="Content planner" description={<>Plan a month for <span className="font-bn font-semibold text-slate-700">{page?.name || '…'}</span>: get ideas, tick the ones you like, schedule them. Posts are written the day before and publish on their own.</>} />

      {page && !page.fb_connected && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 sm:flex-row sm:items-center">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="flex-1">Connect this page to Facebook so planned posts can be published.</span>
          <Link to={`/pages/${pageId}/facebook`} className="btn btn-secondary btn-sm">Connect Facebook</Link>
        </div>
      )}

      {/* Step 1 + 2 */}
      <div className="card p-5">
        <StepTitle n={1} title="Get ideas" done={(ideas?.length || 0) > 0}>
          One click: Gemini studies your page (and competitors) and suggests 30 ideas. Or pick from ideas you already have.
        </StepTitle>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <AsyncButton busyLabel="Starting…" onClick={startResearch} disabled={researchRunning}><Radar size={16} /> Research my page & get 30 ideas</AsyncButton>
          <AsyncButton className="btn-secondary" busyLabel="Thinking… (up to a minute)" onClick={quickIdeas} disabled={researchRunning}><Sparkles size={16} /> Quick 30 ideas</AsyncButton>
          <Link to={`/pages/${pageId}/ideas`} className="btn btn-ghost"><Lightbulb size={16} /> Manage ideas</Link>
          {researchRunning && <span className="flex items-center gap-2 text-sm text-violet-700"><span className="spinner" /> {research.job.step || 'Researching…'} (1–3 minutes)</span>}
        </div>

        {ideas && ideas.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-600"><b>{selected.size}</b> of {ideas.length} ideas selected</span>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set(ideas.map((idea) => idea.id)))}>Select all</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            </div>
            <div className="grid max-h-80 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 md:grid-cols-2">
              {ideas.map((idea) => (
                <label key={idea.id} className={clsx('flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm', selected.has(idea.id) ? 'bg-violet-50' : 'hover:bg-slate-50')}>
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-violet-600" checked={selected.has(idea.id)} onChange={() => toggle(idea.id)} />
                  <span className="min-w-0">
                    <span className="block font-bn font-medium leading-snug text-slate-900">{idea.topic}</span>
                    {idea.category && <span className="font-bn text-xs text-violet-600">{idea.category}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {ideas && ideas.length === 0 && !researchRunning && <p className="mt-4 text-sm text-slate-500">No new ideas yet. Click one of the buttons above.</p>}

        <div className="mt-6 border-t border-slate-100 pt-5">
          <StepTitle n={2} title="Choose dates and approve">When to post, when to write, and whether posts need your OK.</StepTitle>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <Field label="Start date">
              <input type="date" className="input" value={startDate} min={zonedInputParts(new Date(), timezone).date} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field label={`Posting times per day (${timezone})`}>
              <div className="flex flex-wrap items-center gap-2">
                {times.map((time, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <input type="time" className="input !w-auto" value={time} onChange={(event) => setTime(index, event.target.value)} />
                    {times.length > 1 && <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={() => setTimes((c) => c.filter((_, i) => i !== index))} aria-label="Remove time"><X size={14} /></button>}
                  </div>
                ))}
                {times.length < 3 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTimes((c) => [...c, c.length === 1 ? '20:00' : '15:00'])}><Plus size={14} /> Add a time</button>}
              </div>
            </Field>
            <Field label="When should posts be written?">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Choice checked={write === 'day_before'} onClick={() => setWrite('day_before')} title="1 day before (recommended)" text="Spreads Gemini use over the month — fits free API limits." />
                <Choice checked={write === 'now'} onClick={() => setWrite('now')} title="All right now" text="Everything is ready to review today. Uses a lot of quota at once." />
              </div>
            </Field>
            <Field label="Publishing">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Choice checked={approval === 'auto'} onClick={() => setApproval('auto')} title="Automatically" text="Written posts publish at their time. You can still edit or remove them." />
                <Choice checked={approval === 'manual'} onClick={() => setApproval('manual')} title="After my approval" text="Only posts you approve are published; others are skipped." />
              </div>
            </Field>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">{selected.size} posts · about {days} day{days === 1 ? '' : 's'} · days with a planned post skip the daily autopilot.</p>
            <AsyncButton busyLabel="Scheduling…" onClick={approve} disabled={selected.size === 0 || !startDate || times.some((t) => !t)}>
              <CalendarCheck2 size={16} /> Approve & schedule {selected.size || ''} posts
            </AsyncButton>
          </div>
        </div>
      </div>

      {job?.status === 'running' && (
        <div className="card mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Writing posts… {job.done} of {job.total}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={cancelJob}><Square size={14} /> Stop (the rest are written the day before)</button>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-pilot to-violet transition-all" style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%` }} />
          </div>
        </div>
      )}

      {/* Step 3 */}
      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <StepTitle n={3} title={`Upcoming posts ${rows ? `(${rows.length})` : ''}`}>Open any post to review or edit it before its time.</StepTitle>
        {needsApproval > 0 && <AsyncButton className="btn-dark" onClick={approveAll}><CheckCheck size={16} /> Approve all ({needsApproval})</AsyncButton>}
      </div>

      {rows && rows.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Nothing planned yet">Get ideas above, tick them and click Approve &amp; schedule.</EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map(([date, items]) => (
            <div key={date}>
              <p className="mb-2 text-sm font-semibold text-slate-700">{dayLabel(items[0].scheduled_at, timezone)}</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((row) => {
                  const planned = row.status === 'planned';
                  const writeAt = new Date(new Date(row.scheduled_at).getTime() - 24 * 3600 * 1000);
                  return (
                    <div key={row.id} className="card flex gap-3 p-3">
                      <button type="button" className="shrink-0" onClick={() => setEditing(row)}>
                        {planned ? (
                          <div className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-violet-300 bg-violet-50/50 text-center text-[10px] font-semibold leading-tight text-violet-600"><span><PencilLine size={16} className="mx-auto mb-1" />Written<br />{shortDate(writeAt.toISOString(), timezone)}</span></div>
                        ) : (
                          <img src={row.banner_image_path} alt="" loading="lazy" className="h-24 w-24 rounded-lg border border-slate-200 bg-slate-100 object-cover" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="flex items-center gap-1 text-xs font-semibold text-violet-700"><Clock size={12} /> {timeLabel(row.scheduled_at, timezone)}</span>
                          {planned && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">topic only</span>}
                          {!planned && (row.approved
                            ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">ready</span>
                            : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">needs approval</span>)}
                        </div>
                        <p className="mt-1 line-clamp-2 font-bn text-sm font-semibold leading-snug text-slate-900">{planned ? row.topic : row.banner_headline || row.topic}</p>
                        {row.error_message && <p className="mt-0.5 line-clamp-2 text-[11px] text-red-600">{row.error_message}</p>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(row)}><PencilLine size={13} /> {planned ? 'Edit' : 'Review'}</button>
                          {!planned && !row.approved && <button type="button" className="btn btn-secondary btn-sm" onClick={() => approveOne(row)}><CheckCircle2 size={13} /> Approve</button>}
                          <button type="button" className="btn btn-danger-soft btn-sm !px-2" onClick={() => remove(row)} aria-label="Remove"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && editing.status === 'planned' && (
        <PlannedEditor pageId={Number(pageId)} entry={editing} timezone={timezone} onClose={() => setEditing(null)} onDone={() => { setEditing(null); loadPlan(); loadIdeas(); refreshPages(); }} />
      )}
      {editing && editing.status !== 'planned' && (
        <PostEditor pageId={Number(pageId)} entry={editing} timezone={timezone} onClose={() => { setEditing(null); loadPlan(); refreshPages(); }} onChanged={() => {}} />
      )}
    </div>
  );
}
