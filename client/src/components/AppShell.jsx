import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarClock, CalendarDays, ChevronDown, ChevronsUpDown, Globe, Lightbulb, History, KeyRound, LayoutDashboard, ListTodo, LogOut, Menu, Plus, Settings2, Sparkles, UserCircle2, X } from 'lucide-react';
import { Facebook } from './FacebookIcon.jsx';
import { useAuth } from '../auth.jsx';
import { readLastPageId, rememberPage, usePages } from '../pagesContext.jsx';
import { Logo, LogoMark } from './Logo.jsx';
import { NewPageModal } from './NewPageModal.jsx';
import { formatDate } from './ui.jsx';

function initials(name, email) {
  const source = (name || email || '?').trim();
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function Avatar({ user, size = 'h-9 w-9 text-sm' }) {
  return (
    <div className={clsx('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-pilot to-violet font-semibold text-white', size)}>
      {initials(user.name, user.email)}
    </div>
  );
}

function NavItem({ to, icon: Icon, label, end, badge }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
          isActive ? 'bg-white text-ink shadow-md' : 'text-slate-300 hover:bg-white/10 hover:text-white',
        )
      }
    >
      <Icon size={18} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full bg-gradient-to-r from-pilot to-violet px-1.5 text-[11px] font-bold text-white">{badge}</span> : null}
    </NavLink>
  );
}

function SectionLabel({ children }) {
  return <p className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{children}</p>;
}

function PageSwitcher({ pages, current, onNew }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="relative mx-4 mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-2.5 text-left ring-1 ring-white/10 transition hover:bg-white/10"
      >
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-fb/90 text-white"><Facebook size={16} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Facebook Page</p>
          <p className="truncate font-bn text-sm font-semibold text-white">{current ? current.name : pages?.length ? 'Choose a page' : 'No pages yet'}</p>
        </div>
        <ChevronsUpDown size={16} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <div className="max-h-72 overflow-y-auto">
            {(pages || []).map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => navigate(`/pages/${page.id}`)}
                className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50', current?.id === page.id && 'bg-sky-50')}
              >
                <span className={clsx('h-2 w-2 shrink-0 rounded-full', page.fb_connected ? 'bg-emerald-500' : 'bg-slate-300')} />
                <span className="min-w-0 flex-1 truncate font-bn text-slate-800">{page.name}</span>
                {page.queue.pending > 0 && <span className="text-xs text-slate-400">{page.queue.pending} queued</span>}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); onNew(); }} className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-sm font-semibold text-violet hover:bg-violet-50">
            <Plus size={16} /> Add a page
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { user, logout, isSuperAdmin } = useAuth();
  const { pages } = usePages();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const pageMatch = useMatch('/pages/:pageId/*');

  // Current page: the one in the URL, else the last one used, else the first.
  const current = useMemo(() => {
    if (!pages?.length) return null;
    const fromUrl = pageMatch && /^\d+$/.test(pageMatch.params.pageId) ? Number(pageMatch.params.pageId) : null;
    return pages.find((page) => page.id === fromUrl) || pages.find((page) => page.id === readLastPageId()) || pages[0];
  }, [pages, pageMatch]);

  useEffect(() => {
    if (current) rememberPage(current.id);
  }, [current]);

  useEffect(() => {
    setOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const base = current ? `/pages/${current.id}` : null;

  const sidebar = (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Link to="/"><Logo light /></Link>
        <button className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <PageSwitcher pages={pages} current={current} onNew={() => setCreating(true)} />

      <nav className="flex-1 space-y-0.5 px-3">
        <SectionLabel>Workspace</SectionLabel>
        <NavItem to="/" end icon={LayoutDashboard} label="Dashboard" />
        {base && (
          <>
            <SectionLabel>This page</SectionLabel>
            <NavItem to={base} end icon={Sparkles} label="Autopilot" />
            <NavItem to={`${base}/ideas`} icon={Lightbulb} label="Post ideas" badge={current.ideas?.new || null} />
            <NavItem to={`${base}/planner`} icon={CalendarDays} label="Content planner" badge={current.history?.scheduled || null} />
            <NavItem to={`${base}/queue`} icon={ListTodo} label="Content queue" badge={current.queue.pending || null} />
            <NavItem to={`${base}/history`} icon={History} label="Post history" />
            <NavItem to={`${base}/facebook`} icon={Facebook} label="Facebook connection" />
            <NavItem to={`${base}/settings`} icon={Settings2} label="Brand & schedule" />
          </>
        )}
        <SectionLabel>Account</SectionLabel>
        <NavItem to="/integrations" icon={KeyRound} label="Integrations" />
        <NavItem to="/account" icon={UserCircle2} label="My account" />
        {isSuperAdmin && (
          <>
            <SectionLabel>Administration</SectionLabel>
            <NavItem to="/admin/settings" icon={Globe} label="Platform settings" />
          </>
        )}
      </nav>

      <div className="p-4">
        <div className="rounded-xl bg-gradient-to-br from-pilot to-violet p-3.5 text-white shadow-lg">
          <p className="flex items-center gap-1.5 text-xs font-bold"><CalendarClock size={14} /> Next automatic post</p>
          <p className="mt-1 text-[12px] leading-snug text-white/90">
            {current?.schedule?.nextRun
              ? <>{formatDate(current.schedule.nextRun, current.schedule.timezone)} · <span className="font-bn">{current.name}</span></>
              : current ? 'Autopilot is off for this page.' : 'Add a page to start your Bangla autopilot.'}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {open && <div className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={clsx(
          'sidebar-bg fixed inset-y-0 left-0 z-50 w-72 transform overflow-y-auto overscroll-contain transition-transform lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {sidebar}
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
                <Menu size={20} />
              </button>
              <div className="lg:hidden"><LogoMark className="h-8 w-8" /></div>
              {current && pageMatch && /^\d+$/.test(pageMatch.params.pageId) && (
                <div className="hidden min-w-0 items-center gap-2 sm:flex">
                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', current.fb_connected ? 'bg-emerald-500' : 'bg-amber-400')} />
                  <span className="truncate font-bn text-sm font-semibold text-slate-700">{current.name}</span>
                  {!current.fb_connected && <Link to={`${base}/facebook`} className="text-xs font-semibold text-amber-600 hover:underline">Not connected</Link>}
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => setMenuOpen((value) => !value)} className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-slate-100">
                <Avatar user={user} size="h-8 w-8 text-xs" />
                <span className="hidden text-sm font-semibold text-slate-700 sm:block">{(user.name || user.email).split(' ')[0]}</span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl">
                  <div className="border-b border-slate-100 px-4 py-2.5">
                    <p className="truncate text-sm font-semibold">{user.name || 'Account'}</p>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                    {isSuperAdmin && <p className="mt-1 text-[11px] font-semibold text-violet">Super admin</p>}
                  </div>
                  <NavLink to="/account" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><UserCircle2 size={16} /> My account</NavLink>
                  <NavLink to="/integrations" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"><KeyRound size={16} /> Integrations</NavLink>
                  <button
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-clip px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl"><Outlet context={{ openNewPage: () => setCreating(true) }} /></div>
        </main>
        <footer className="px-6 py-4 text-center text-[11px] text-slate-400">
          PixGen Pilot · Bangla Facebook autopilot · {new Date().getFullYear()}
        </footer>
      </div>

      {creating && <NewPageModal onClose={() => setCreating(false)} />}
    </div>
  );
}
