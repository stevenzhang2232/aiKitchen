import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './appState';
import { FridgePage, Onboarding, type FridgeFilter } from './fridge/FridgePage';
import { CookPage } from './cook/CookPage';
import { SettingsPage } from './settings/SettingsPage';

export type Tab = 'fridge' | 'cook' | 'settings';

function readHash(): Tab {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h === 'cook' || h === 'settings' ? h : 'fridge';
}

function ToastBar() {
  const { toast, dismissToast, run, showToast } = useApp();
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone === "error" ? "toast-error" : ""}`} role="status" aria-live="polite" data-testid="toast">
      <span>{toast.message}</span>
      {toast.undoId && (
        <button
          className="link"
          onClick={async () => {
            const id = toast.undoId!;
            dismissToast();
            await run(() => fetch(`/api/undo/${id}`, { method: 'POST' }).then((r) => {
              if (!r.ok) throw new Error('undo failed');
            }));
            showToast({ message: 'Undone' });
          }}
        >
          Undo
        </button>
      )}
      <button className="icon-btn" aria-label="Dismiss" onClick={dismissToast}>×</button>
    </div>
  );
}

function Shell() {
  const { state, loadError, alertCount, refresh } = useApp();
  const [tab, setTabState] = useState<Tab>(readHash);
  const [fridgeFilter, setFridgeFilter] = useState<FridgeFilter>('all');
  const [cookIntent, setCookIntent] = useState<{ toCookId: number } | null>(null);

  useEffect(() => {
    const onHash = () => setTabState(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setTab = (t: Tab) => {
    window.location.hash = `/${t}`;
    setTabState(t);
  };

  if (!state) {
    return (
      <div className="center-page">
        {loadError ? (
          <>
            <p>{loadError}</p>
            <button onClick={refresh}>Try again</button>
          </>
        ) : (
          <p className="muted">Loading your fridge…</p>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Virtual Fridge</span>
        <nav className="tabs" aria-label="Main">
          {(['fridge', 'cook', 'settings'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'tab active' : 'tab'} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
              {t === 'fridge' ? 'Fridge' : t === 'cook' ? 'AI cook' : 'Settings'}
            </button>
          ))}
        </nav>
        {alertCount > 0 && (
          <button
            className="alert-badge"
            onClick={() => {
              setFridgeFilter('eat-first');
              setTab('fridge');
            }}
          >
            {alertCount} {alertCount === 1 ? 'item' : 'items'} to eat first
          </button>
        )}
      </header>
      <main className="page">
        {tab === 'fridge' && (state.onboarded ? <FridgePage filter={fridgeFilter} setFilter={setFridgeFilter} /> : <Onboarding />)}
        {tab === 'cook' && <CookPage intent={cookIntent} clearIntent={() => setCookIntent(null)} goTo={setTab} />}
        {tab === 'settings' && (
          <SettingsPage
            onContinueToCook={(id) => {
              setCookIntent({ toCookId: id });
              setTab('cook');
            }}
          />
        )}
      </main>
      <ToastBar />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
