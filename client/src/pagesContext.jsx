import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useToast } from './components/Toasts.jsx';

const PagesContext = createContext(null);
const LAST_PAGE_KEY = 'pgpLastPage';

export function readLastPageId() {
  try {
    return Number(localStorage.getItem(LAST_PAGE_KEY)) || null;
  } catch {
    return null;
  }
}

export function rememberPage(id) {
  try {
    localStorage.setItem(LAST_PAGE_KEY, String(id));
  } catch {
    // only a convenience
  }
}

/** The signed-in user's pages (with queue/history counts and schedule), shared by the shell and the screens. */
export function PagesProvider({ children }) {
  const toast = useToast();
  const [pages, setPages] = useState(null);

  const refreshPages = useCallback(async () => {
    try {
      const data = await api('/pages');
      setPages(data.pages);
      return data.pages;
    } catch (error) {
      toast(error.message, 'error');
      return null;
    }
  }, [toast]);

  useEffect(() => {
    refreshPages();
    const timer = setInterval(refreshPages, 60000);
    return () => clearInterval(timer);
  }, [refreshPages]);

  const value = useMemo(() => ({ pages, refreshPages, setPages }), [pages, refreshPages]);
  return <PagesContext.Provider value={value}>{children}</PagesContext.Provider>;
}

export function usePages() {
  return useContext(PagesContext);
}

/** The page for a route param, from the shared list. */
export function usePageById(pageId) {
  const { pages } = usePages();
  const id = Number(pageId);
  return pages?.find((page) => page.id === id) || null;
}
