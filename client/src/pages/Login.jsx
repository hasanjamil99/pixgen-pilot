import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CalendarClock, Image, Languages } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components/Logo.jsx';

const FEATURES = [
  [Languages, 'Bangla posts written by Gemini, every single day'],
  [Image, 'Branded 1080×1080 banners with perfect Bangla text'],
  [CalendarClock, 'Published to your Facebook Pages on schedule'],
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="sidebar-bg relative hidden flex-col justify-between p-12 text-white lg:flex">
        <Logo light size="lg" />
        <div>
          <h1 className="max-w-md font-display text-4xl font-bold leading-tight">Your Facebook Page, on autopilot — in Bangla.</h1>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3 text-slate-200">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 ring-1 ring-white/10"><Icon size={18} /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} PixGen Pilot</p>
      </div>

      <div className="flex items-center justify-center bg-slate-50 px-4 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Welcome back. Sign in to manage your pages.</p>
          <div className="mt-8 space-y-4">
            <label className="block">
              <span className="label">Email</span>
              <input type="email" className="input" autoComplete="username" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input type="password" className="input" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={busy}>
              {busy && <span className="spinner" />}Sign in
            </button>
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">Accounts are created by the administrator.</p>
        </form>
      </div>
    </div>
  );
}
