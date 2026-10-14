import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X } from 'lucide-react';

const DialogContext = createContext(null);

/** Modal shell used for confirmations, forms and the caption viewer. */
export function Modal({ title, onClose, children, actions, wide = false }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
        {actions && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">{actions}</div>}
      </div>
    </div>
  );
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback(
    ({ title, message, confirmLabel = 'Confirm', danger = false }) =>
      new Promise((resolve) => setDialog({ title, message, confirmLabel, danger, resolve })),
    [],
  );

  const close = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  return (
    <DialogContext.Provider value={confirm}>
      {children}
      {dialog && (
        <Modal
          title={dialog.title}
          onClose={() => close(false)}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => close(false)}>Cancel</button>
              <button type="button" className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{dialog.confirmLabel}</button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-slate-600">{dialog.message}</p>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

export function useConfirm() {
  return useContext(DialogContext);
}
