import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

const ToastContext = createContext(() => {});

const STYLES = {
  info: ['border-slate-200 bg-white text-slate-800', Info, 'text-sky-600'],
  success: ['border-emerald-200 bg-white text-slate-800', CheckCircle2, 'text-emerald-600'],
  error: ['border-red-200 bg-white text-slate-800', XCircle, 'text-red-600'],
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, type }]);
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), type === 'error' ? 9000 : 4500);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 left-4 right-4 z-[70] space-y-2 sm:left-auto sm:w-96" aria-live="polite">
        {toasts.map((item) => {
          const [style, Icon, iconColor] = STYLES[item.type] || STYLES.info;
          return (
            <div key={item.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${style}`}>
              <Icon size={18} className={`mt-0.5 shrink-0 ${iconColor}`} />
              <span className="min-w-0 break-words">{item.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
