import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatTime, initials } from '../lib/format';
import { useToast } from '../components/Toast';

export default function Admin() {
  const { toast } = useToast();
  const [titles, setTitles] = useState(null);
  const [users, setUsers] = useState(null);
  const [report, setReport] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState('');
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => (titles || []).find((title) => title.id === selectedId) || null,
    [titles, selectedId]
  );

  const loadTitles = async () => {
    const payload = await api('/admin/titles');
    setTitles(payload.titles);
    if (!selectedId && payload.titles.length) {
      setSelectedId(payload.titles[0].id);
      setDraft(JSON.stringify(payload.titles[0].timeline, null, 2));
    }
  };

  const loadReport = async () => {
    const payload = await api('/admin/recommendations/report');
    setReport(payload);
  };

  useEffect(() => {
    Promise.all([loadTitles(), api('/admin/users').then((data) => setUsers(data.users)), loadReport()]).catch(
      (requestError) => setError(requestError.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected) {
      setDraft(JSON.stringify(selected.timeline, null, 2));
      setValidation(null);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const parseDraft = () => {
    const parsed = JSON.parse(draft);
    if (!Array.isArray(parsed)) throw new Error('Timeline must be a JSON array of events');
    return parsed;
  };

  const validate = async () => {
    if (!selected) return;
    setBusy(true);
    setValidation(null);
    try {
      const timeline = parseDraft();
      const result = await api(`/admin/titles/${selected.id}/timeline/validate`, {
        method: 'POST',
        body: { timeline },
      });
      setValidation(result);
      toast(
        result.valid
          ? `Valid: ${result.counts.events} events (${result.counts.variationPoints} variation points)`
          : `Validation found ${result.errors?.length || 0} issues`,
        result.valid ? 'success' : 'error'
      );
    } catch (requestError) {
      setValidation({
        valid: false,
        errors: [{ path: 'json', message: requestError.message }],
      });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const timeline = parseDraft();
      const result = await api(`/admin/titles/${selected.id}/timeline`, {
        method: 'PUT',
        body: { timeline },
      });
      setValidation({
        valid: true,
        counts: {
          events: result.counts.events,
          trivia: result.counts.trivia,
          variationPoints: result.counts.variationPoints,
        },
      });
      toast(`Timeline published: ${result.counts.events} events`, 'success');
      await loadTitles();
      setDraft(JSON.stringify(result.timeline, null, 2));
    } catch (requestError) {
      if (requestError.details) {
        setValidation({ valid: false, errors: requestError.details });
      }
      toast(requestError.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId, role) => {
    try {
      const result = await api(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: { role },
      });
      setUsers((current) =>
        current.map((user) => (user.id === userId ? { ...user, role: result.user.role } : user))
      );
      toast(`Role updated to ${result.user.role}`, 'success');
    } catch (requestError) {
      toast(requestError.message, 'error');
    }
  };

  const retrain = async () => {
    setBusy(true);
    try {
      const result = await api('/admin/recommendations/retrain', { method: 'POST' });
      toast(`Model rebuilt in ${result.run.durationMs}ms`, 'success');
      await loadReport();
    } catch (requestError) {
      toast(requestError.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="page">
        <div className="form-error">{error}</div>
      </div>
    );
  }

  if (!titles || !users || !report) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <span>Loading the admin console…</span>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Metadata studio</h1>
          <p className="sub">
            Timelines are validated server-side before they go live. Publishing updates every open
            room on that title without a restart.
          </p>
        </div>
        <div className="head-actions">
          <span className="badge">{titles.length} titles</span>
          <span className="badge">{users.length} accounts</span>
        </div>
      </header>

      <div className="admin-grid">
        <div className="card" style={{ padding: 12 }}>
          <div className="eyebrow" style={{ padding: '4px 8px 8px' }}>
            Catalogue
          </div>
          <div className="admin-list">
            {titles.map((title) => (
              <button
                key={title.id}
                type="button"
                className={`admin-item ${title.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(title.id)}
              >
                <span className="name">{title.name}</span>
                <span className="meta">
                  {formatTime(title.durationSeconds)} · {title.timeline?.length || 0} events
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 18 }}>{selected?.name || 'Select a title'}</h2>
                <div className="faint" style={{ fontSize: 12 }}>
                  {selected?.year} · {selected?.genres?.join(' · ')} · {selected?.license}
                </div>
              </div>
              <div className="counts">
                <span className="badge">{selected?.timeline?.length || 0} events</span>
                <span className="badge badge-blue">live metadata</span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="timeline-json">Timeline JSON (PRD §7.3.1 shape)</label>
              <textarea
                id="timeline-json"
                style={{ minHeight: 340 }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="timeline-tools" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={validate} disabled={busy}>
                Validate
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={busy}>
                Publish timeline
              </button>
              <button
                className="btn btn-quiet btn-sm"
                type="button"
                onClick={() => selected && setDraft(JSON.stringify(selected.timeline, null, 2))}
                disabled={busy}
              >
                Restore
              </button>
              <span className="faint" style={{ fontSize: 11, marginLeft: 'auto' }}>
                Validation checks ids, ranges, glossary fields and variation options.
              </span>
            </div>

            {validation && (
              <div style={{ marginTop: 12 }}>
                <div className={`notice ${validation.valid ? '' : 'form-error'}`}>
                  {validation.valid ? (
                    <span>
                      ✓ Valid — {validation.counts?.events ?? 0} events ·{' '}
                      {validation.counts?.trivia ?? 0} trivia ·{' '}
                      {validation.counts?.variationPoints ?? 0} variation points
                    </span>
                  ) : (
                    <span>{validation.errors?.length || 1} issue(s) found — fix before publishing.</span>
                  )}
                </div>
                {!validation.valid && validation.errors?.length > 0 && (
                  <div className="errors">
                    {validation.errors.map((issue, index) => (
                      <div key={`${issue.path}-${index}`} className="error-row">
                        {issue.path}: {issue.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ fontSize: 17 }}>Recommender</h2>
              <button className="btn btn-ghost btn-sm" type="button" onClick={retrain} disabled={busy}>
                Retrain model
              </button>
            </div>
            <div className="kpis">
              <div className="kpi">
                <div className="kpi-value">{report.live?.precisionAt5 ?? '—'}</div>
                <div className="kpi-label">Precision@5 (leave-one-out)</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{report.live?.items ?? 0}</div>
                <div className="kpi-label">Catalogue items</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{report.live?.interactions ?? 0}</div>
                <div className="kpi-label">Interactions</div>
              </div>
              <div className="kpi">
                <div className="kpi-value">{report.live?.buildMs ?? 0}ms</div>
                <div className="kpi-label">Last build</div>
              </div>
            </div>
            {report.latestRun && (
              <p className="faint" style={{ fontSize: 11, marginTop: 10 }}>
                Last recorded run: {new Date(report.latestRun.createdAt).toLocaleString()} ·{' '}
                {report.latestRun.method}
              </p>
            )}
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <h2 style={{ fontSize: 17, marginBottom: 10 }}>Accounts</h2>
            <table className="simple">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Interactions</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>
                          {initials(user.displayName)}
                        </div>
                        {user.displayName}
                      </div>
                    </td>
                    <td className="muted">{user.email}</td>
                    <td>
                      <select
                        className="role-select"
                        value={user.role}
                        onChange={(event) => changeRole(user.id, event.target.value)}
                        aria-label={`Role for ${user.displayName}`}
                      >
                        <option value="viewer">viewer</option>
                        <option value="host">host</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="muted">{user.interactions}</td>
                    <td className="faint">{new Date(user.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
