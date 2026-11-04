import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Shell from './components/Shell';
import { useAuth } from './lib/auth';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import Browse from './pages/Browse';
import Room from './pages/Room';
import Admin from './pages/Admin';

function FullPageSpinner({ label = 'Loading WatchSpaces…' }) {
  return (
    <div className="page-loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function Protected({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <FullPageSpinner />;
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return (
      <div className="page">
        <div className="center-card">
          <div className="icon" aria-hidden="true">
            ⚿
          </div>
          <h1>Admins only</h1>
          <p>This area manages catalogue timelines and account roles.</p>
          <a className="btn btn-ghost" href="/">
            Back home
          </a>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { user, ready } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={
          !ready ? <FullPageSpinner /> : user ? <Navigate to="/" replace /> : <AuthPage />
        }
      />
      <Route
        element={
          <Protected>
            <Shell />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="browse" element={<Browse />} />
        <Route
          path="admin"
          element={
            <AdminOnly>
              <Admin />
            </AdminOnly>
          }
        />
      </Route>
      <Route
        path="/watch/:id"
        element={
          <Protected>
            <Room />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
