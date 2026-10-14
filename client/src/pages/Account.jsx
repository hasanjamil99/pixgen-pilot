import { useState } from 'react';
import { Lock, Save, UserCircle2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toasts.jsx';
import { AsyncButton, Badge, Field, formatDate, PageHeader } from '../components/ui.jsx';

export default function Account() {
  const { user, setUser, replaceSession } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.name || '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');

  const saveProfile = async () => {
    try {
      const data = await api('/me', { method: 'PUT', body: { name: name.trim() } });
      setUser(data.user);
      toast('Profile saved.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const changePassword = async () => {
    if (next !== repeat) return toast('The new passwords do not match.', 'error');
    try {
      const data = await api('/me/password', { method: 'PUT', body: { currentPassword: current, newPassword: next } });
      replaceSession(data);
      setCurrent('');
      setNext('');
      setRepeat('');
      toast('Password changed. Other devices have been signed out.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
    return undefined;
  };

  return (
    <div>
      <PageHeader icon={UserCircle2} title="My account" description="Your profile and password." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-4 p-5">
          <h2 className="text-base font-semibold text-slate-900">Profile</h2>
          <Field label="Name"><input className="input" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label="Email" hint="Ask the administrator to change your email."><input className="input" value={user.email} disabled /></Field>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge status={user.role} /> Member since {formatDate(user.created_at)}
          </div>
          <div className="flex justify-end"><AsyncButton busyLabel="Saving…" onClick={saveProfile}><Save size={16} /> Save</AsyncButton></div>
        </div>

        <div className="card space-y-4 p-5">
          <h2 className="text-base font-semibold text-slate-900">Change password</h2>
          <Field label="Current password"><input type="password" className="input" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
          <Field label="New password" hint="At least 8 characters."><input type="password" className="input" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></Field>
          <Field label="Repeat new password"><input type="password" className="input" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} /></Field>
          <div className="flex justify-end"><AsyncButton busyLabel="Changing…" onClick={changePassword} disabled={!current || !next}><Lock size={16} /> Change password</AsyncButton></div>
        </div>
      </div>
    </div>
  );
}
