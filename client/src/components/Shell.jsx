import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function Shell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <div className="brand-name">
              Watch<span>Spaces</span>
            </div>
            <span className="brand-tag">AI watch parties</span>
          </div>
        </div>

        <nav className="nav" aria-label="Main">
          <NavLink
            to="/"
            end
            aria-label="Home"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon" aria-hidden="true">
              ⌂
            </span>
            <span>Home</span>
          </NavLink>
          <NavLink
            to="/browse"
            aria-label="Browse"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon" aria-hidden="true">
              ▤
            </span>
            <span>Browse</span>
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              aria-label="Admin"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon" aria-hidden="true">
                ⚙
              </span>
              <span>Admin</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{initials(user?.displayName) || '?'}</div>
            <div className="user-meta">
              <div className="user-name">{user?.displayName}</div>
              <div className="user-role">{user?.role}</div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <span>Sign out</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
