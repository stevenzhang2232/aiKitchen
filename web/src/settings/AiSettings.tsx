import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../appState';

interface Cfg {
  baseUrl: string;
  model: string;
  visionModel: string;
  webSearch: boolean;
  hasKey: boolean;
  apiKeyMasked: string;
  capabilities: { configured: boolean; search: boolean; vision: boolean };
}

export function AiSettings() {
  const { refresh, state } = useApp();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<Cfg>('/api/ai-config').then(setCfg);
  useEffect(() => {
    load();
  }, []);
  if (!cfg) return <p className="muted">Loading…</p>;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api.put('/api/ai-config', { ...cfg, apiKey: key });
      setKey('');
      await load();
      await refresh();
      setMsg({ text: 'Saved', tone: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : 'Could not save.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ message: string }>('/api/ai-config/test');
      setMsg({ text: r.message, tone: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : 'The test failed.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const caps = cfg.capabilities;
  return (
    <section className="panel stack" aria-label="AI model">
      <h2>AI model</h2>
      <p className="muted small">
        Used for recipe ideas, shelf-life suggestions and receipt scanning. Your key is stored only on this computer in
        data/config.json and is never included in backups. Fridge features work without it.
      </p>
      {state?.ai?.model === 'built-in test AI' && <p className="muted small">The app is running with the built-in test AI.</p>}
      <label className="field">
        <span>Provider address</span>
        <input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} aria-label="Provider address" />
      </label>
      <label className="field">
        <span>API key {cfg.hasKey && <span className="muted">(saved: {cfg.apiKeyMasked})</span>}</span>
        <input
          type="password"
          value={key}
          autoComplete="off"
          placeholder={cfg.hasKey ? 'Leave empty to keep the saved key' : 'sk-...'}
          onChange={(e) => setKey(e.target.value)}
          aria-label="API key"
        />
      </label>
      <div className="row">
        <label className="field grow">
          <span>Model</span>
          <input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} aria-label="Model" />
        </label>
        <label className="field grow">
          <span>Vision model (receipts)</span>
          <input value={cfg.visionModel} onChange={(e) => setCfg({ ...cfg, visionModel: e.target.value })} aria-label="Vision model" />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={cfg.webSearch} onChange={(e) => setCfg({ ...cfg, webSearch: e.target.checked })} />
        Search the web for shelf-life information (Qwen / DashScope only)
      </label>
      <p className="muted small">
        Status: {caps.configured ? 'ready' : 'not set up'} · Web search: {caps.search ? 'on' : 'off (suggestions come without sources)'} ·
        Receipt scanning: {caps.vision ? 'on' : 'off'}
      </p>
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>Save</button>
        <button disabled={busy} onClick={test}>Test connection</button>
        {cfg.hasKey && (
          <button
            disabled={busy}
            onClick={async () => {
              await api.put('/api/ai-config', { clearKey: true });
              await load();
              await refresh();
              setMsg({ text: 'Key removed', tone: 'ok' });
            }}
          >
            Remove key
          </button>
        )}
      </div>
      {msg && (
        <p className={msg.tone === 'error' ? 'field-error' : 'ok-text'} role="status">
          {msg.text}
        </p>
      )}
    </section>
  );
}
