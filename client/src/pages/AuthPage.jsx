import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const DEMO_ACCOUNTS = [
  { label: 'Host', email: 'host@watchspaces.dev', password: 'Host123!' },
  { label: 'Viewer', email: 'viewer@watchspaces.dev', password: 'Viewer123!' },
  { label: 'Admin', email: 'admin@watchspaces.dev', password: 'Admin123!' },
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    accountType: 'viewer',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
      } else {
        await register({
          email: form.email.trim(),
          password: form.password,
          displayName: form.displayName.trim(),
          accountType: form.accountType,
        });
      }
      navigate(location.state?.from || '/', { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Could not sign you in');
    } finally {
      setBusy(false);
    }
  };

  const useDemo = async (account) => {
    setError('');
    setBusy(true);
    setForm((current) => ({ ...current, email: account.email, password: account.password }));
    try {
      await login(account.email, account.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Demo sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-art">
        <div>
          <div className="brand" style={{ padding: 0 }}>
            <div className="brand-mark">W</div>
            <div>
              <div className="brand-name">
                Watch<span>Spaces</span>
              </div>
              <span className="brand-tag">AI watch parties</span>
            </div>
          </div>

          <h1 className="auth-headline" style={{ marginTop: 42 }}>
            Same film.
            <br />
            Same second.
            <br />
            <em>Smarter together.</em>
          </h1>
          <p className="auth-sub">
            Host a synchronized watch party, ask a co-pilot that only answers from the scene in
            front of you, and vote on pre-approved caption and story variations — together, live.
          </p>

          <div className="auth-features">
            <div className="auth-feature">
              <span className="glyph" aria-hidden="true">
                ⏱
              </span>
              <div>
                <strong>Authoritative playback sync.</strong> The server owns the room clock;
                clients measure drift and correct smoothly without visible jumps.
              </div>
            </div>
            <div className="auth-feature">
              <span className="glyph" aria-hidden="true">
                ✦
              </span>
              <div>
                <strong>Grounded co-pilot.</strong> Every answer cites authored timeline entries —
                or declines. No hallucinated plot.
              </div>
            </div>
            <div className="auth-feature">
              <span className="glyph" aria-hidden="true">
                ⚖
              </span>
              <div>
                <strong>Group variation votes.</strong> Hosts open a vote; the room picks from
                pre-approved options; the result applies everywhere.
              </div>
            </div>
          </div>
        </div>

        <div className="auth-marquee">
          <span>Open-licensed films</span>
          <span>·</span>
          <span>Socket.io room state</span>
          <span>·</span>
          <span>MERN reference build</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="lead">
            {mode === 'login'
              ? 'Pick up your rooms, rails and watch history.'
              : 'Viewers join parties. Hosts can create and run them.'}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <div className="field">
                <label htmlFor="displayName">Display name</label>
                <input
                  id="displayName"
                  value={form.displayName}
                  onChange={update('displayName')}
                  placeholder="Ada Lovelace"
                  minLength={2}
                  maxLength={60}
                  required
                  autoComplete="name"
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={update('email')}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={form.password}
                onChange={update('password')}
                placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
                minLength={mode === 'register' ? 8 : 1}
                required
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />
            </div>

            {mode === 'register' && (
              <div className="field">
                <label htmlFor="accountType">Account type</label>
                <select id="accountType" value={form.accountType} onChange={update('accountType')}>
                  <option value="viewer">Viewer — join watch parties</option>
                  <option value="host">Host — create and run watch parties</option>
                </select>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="auth-toggle">
            {mode === 'login' ? 'New to WatchSpaces?' : 'Already have an account?'}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
            >
              {mode === 'login' ? 'Create one' : 'Sign in'}
            </button>
          </div>

          <div className="demo-accounts">
            <div className="demo-label">Seeded demo accounts</div>
            <div className="demo-row">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="demo-chip"
                  onClick={() => useDemo(account)}
                  disabled={busy}
                >
                  {account.label}
                </button>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 11 }}>
              Host123! · Viewer123! · Admin123! — seeded on first server start.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
