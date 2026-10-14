import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { usePages } from '../pagesContext.jsx';
import { Modal } from './Dialog.jsx';
import { useToast } from './Toasts.jsx';
import { AsyncButton, Field } from './ui.jsx';
import { Facebook } from './FacebookIcon.jsx';

export function NewPageModal({ onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { refreshPages } = usePages();
  const [name, setName] = useState('');
  const [niche, setNiche] = useState('');

  const create = async () => {
    try {
      const { page } = await api('/pages', {
        method: 'POST',
        body: { name: name.trim(), brand_name: name.trim(), page_niche: niche.trim() || undefined },
      });
      await refreshPages();
      toast('Page added. Now connect it to Facebook.', 'success');
      onClose();
      navigate(`/pages/${page.id}/facebook`);
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <Modal
      title="Add a Facebook Page"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <AsyncButton busyLabel="Adding…" onClick={create} disabled={!name.trim()}>Add page</AsyncButton>
        </>
      }
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => { onClose(); navigate('/pages/import'); }}
          className="flex w-full items-center gap-3 rounded-xl border border-fb/30 bg-blue-50/60 p-3 text-left transition hover:bg-blue-50"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-fb text-white"><Facebook size={18} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Import from Facebook</span>
            <span className="block text-xs text-slate-500">Log in once and add several Facebook Pages, already connected.</span>
          </span>
        </button>
        <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or add one manually<span className="h-px flex-1 bg-slate-200" /></div>
        <Field label="Page name" hint="Shown on the banner as the brand name. Write it in Bangla to keep banners fully Bangla.">
          <input className="input font-bn" autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="যেমন: প্রযুক্তি পাতা" />
        </Field>
        <Field label="What is the page about? (niche)" hint="Gemini invents daily topics from this when the queue is empty. You can change it later.">
          <textarea className="input font-bn" rows={3} maxLength={1000} value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="যেমন: প্রযুক্তি, এআই, ছোট ব্যবসা ও ডিজিটাল দক্ষতা" />
        </Field>
      </div>
    </Modal>
  );
}
