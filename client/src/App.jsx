import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { AppShell } from './components/AppShell.jsx';
import { LogoMark } from './components/Logo.jsx';
import { EmptyState } from './components/ui.jsx';
import { PagesProvider } from './pagesContext.jsx';
import Account from './pages/Account.jsx';
import AdminPlatform from './pages/AdminPlatform.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ImportPages from './pages/ImportPages.jsx';
import Integrations from './pages/Integrations.jsx';
import Login from './pages/Login.jsx';
import PageAutopilot from './pages/PageAutopilot.jsx';
import PageFacebook from './pages/PageFacebook.jsx';
import PageHistory from './pages/PageHistory.jsx';
import PageIdeas from './pages/PageIdeas.jsx';
import PagePlanner from './pages/PagePlanner.jsx';
import PageQueue from './pages/PageQueue.jsx';
import PageSettings from './pages/PageSettings.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50">
        <LogoMark className="h-12 w-12 animate-pulse" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function SuperAdminOnly({ children }) {
  const { isSuperAdmin } = useAuth();
  return isSuperAdmin ? children : <Navigate to="/" replace />;
}

function NotFound() {
  return <EmptyState icon={Compass} title="Page not found">That address does not exist in PixGen Pilot.</EmptyState>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <PagesProvider>
              <AppShell />
            </PagesProvider>
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="pages/import" element={<ImportPages />} />
        <Route path="pages/:pageId" element={<PageAutopilot />} />
        <Route path="pages/:pageId/ideas" element={<PageIdeas />} />
        <Route path="pages/:pageId/planner" element={<PagePlanner />} />
        <Route path="pages/:pageId/queue" element={<PageQueue />} />
        <Route path="pages/:pageId/history" element={<PageHistory />} />
        <Route path="pages/:pageId/facebook" element={<PageFacebook />} />
        <Route path="pages/:pageId/settings" element={<PageSettings />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="account" element={<Account />} />
        <Route path="admin/settings" element={<SuperAdminOnly><AdminPlatform /></SuperAdminOnly>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
