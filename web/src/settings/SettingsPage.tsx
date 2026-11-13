import { useState } from 'react';
import { formatAmount, toBase, type Unit } from '@kitchen/core';
import { api, ApiError } from '../api';
import { useApp, useAppState } from '../appState';
import { FieldError, Modal } from '../components/Modal';
import { draftFrom, TasteFields, type TasteDraft } from '../components/TasteFields';
import { AiSettings } from './AiSettings';

type Section = 'ai' | 'taste' | 'pack' | 'tocook' | 'history' | 'backup';

const MODE_NAME: Record<string, string> = { dish: 'I want a dish', suggest: 'Suggest for me', pick: 'Pick ingredients' };

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function TasteSection() {
  const state = useAppState();
  const { refresh, showToast } = useApp();
  const [draft, setDraft] = useState<TasteDraft>(draftFrom(state.taste));
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel stack" aria-label="Taste preferences">
      <h2>Taste preferences</h2>
      <p className="muted small">Used by “I want a dish” and “Suggest for me”. You can also change them when choosing how many people are eating.</p>
      <TasteFields value={draft} onChange={setDraft} />
      <FieldError message={error} />
      <div className="row">
        <button
          className="primary"
          onClick={async () => {
            try {
              await api.put('/api/taste', draft);
              await refresh();
              showToast({ message: 'Taste preferences saved' });
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Could not save.');
            }
          }}
        >
          Save
        </button>
      </div>
    </section>
  );
}

function PackSection() {
  const state = useAppState();
  const { run, showToast } = useApp();
  const seasonings = state.foods.filter((f) => f.isSeasoning).sort((a, b) => a.name.localeCompare(b.name));
  const [picked, setPicked] = useState<number[]>(state.pack);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <section className="panel stack" aria-label="Seasoning pack">
      <h2>Seasoning pack</h2>
      <p className="muted small">“Add seasoning pack” on the Fridge page marks all of these as have. Seasonings are only tracked as have / don’t have.</p>
      <p className="small">In your pack ({picked.length}): {picked.map((id) => seasonings.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || 'none'}</p>
      <div className="check-grid">
        {seasonings.map((s) => (
          <div key={s.id} className="check-item">
            <label className="check">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} aria-label={s.name} />
              {s.name}
            </label>
            {s.custom && (
              <button className="link small" onClick={() => setRenaming({ id: s.id, name: s.name })} aria-label={`Rename ${s.name}`}>Rename</button>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <label className="field grow">
          <span>Add a seasoning that isn’t listed</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Chili crisp" aria-label="New seasoning name" />
        </label>
        <button
          onClick={async () => {
            if (!newName.trim()) return setError('Enter a name.');
            setError(null);
            const r = await run(() => api.post<{ food: { id: number } }>('/api/foods', { name: newName, isSeasoning: true }));
            if (r) {
              setPicked((p) => (p.includes(r.food.id) ? p : [...p, r.food.id]));
              setNewName('');
            }
          }}
        >
          Add to list
        </button>
      </div>
      <FieldError message={error} />
      <div className="row">
        <button
          className="primary"
          onClick={async () => {
            const r = await run(() => api.put('/api/seasoning-pack', { foodIds: picked }));
            if (r) showToast({ message: 'Seasoning pack saved' });
          }}
        >
          Save pack
        </button>
        <button onClick={() => setPicked(state.pack)}>Undo changes</button>
      </div>
      {renaming && (
        <Modal
          title="Rename seasoning"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button onClick={() => setRenaming(null)}>Cancel</button>
              <button
                className="primary"
                onClick={async () => {
                  const r = await run(() => api.post(`/api/foods/${renaming.id}/rename`, { name: renaming.name }));
                  if (r) setRenaming(null);
                }}
              >
                Save name
              </button>
            </>
          }
        >
          <label className="field">
            <span>Name</span>
            <input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} aria-label="Seasoning name" />
          </label>
        </Modal>
      )}
    </section>
  );
}

function ToCookSection({ onContinue }: { onContinue: (id: number) => void }) {
  const state = useAppState();
  const { run } = useApp();
  return (
    <section className="panel stack" aria-label="To cook">
      <h2>To cook</h2>
      <p className="muted small">Dishes you chose “Buy first” for. When you’ve shopped, continue to check your fridge again and get the recipe.</p>
      {!state.toCook.length && <p className="muted">Nothing saved. Dishes appear here when ingredients are missing and you choose “Buy first”.</p>}
      <ul className="row-list">
        {state.toCook.map((t) => (
          <li key={t.id} className="list-row" data-testid="to-cook-row">
            <div className="grow">
              <strong>{t.dishName}</strong> · {t.servings} {t.servings === 1 ? 'person' : 'people'}
              <div className="muted small">
                Missing: {t.missing.map((m) => m.name + (m.amount && m.unit ? ` (about ${formatAmount(toBase(m.amount, m.unit as Unit), m.unit as Unit)})` : '')).join(', ') || 'nothing'} · saved {when(t.savedAt)}
              </div>
            </div>
            <button className="primary" onClick={() => onContinue(t.id)}>Continue</button>
            <button className="icon-btn" aria-label={`Delete ${t.dishName}`} onClick={() => run(() => api.del(`/api/to-cook/${t.id}`))}>🗑</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistorySection() {
  const state = useAppState();
  const { run } = useApp();
  return (
    <section className="panel stack" aria-label="History">
      <h2>History</h2>
      {!state.history.length && <p className="muted">Dishes you confirm with “I cooked it” are listed here.</p>}
      <ul className="row-list">
        {state.history.map((h) => (
          <li key={h.id} className="list-row" data-testid="history-row">
            <details className="grow">
              <summary>
                <strong>{h.dishName}</strong> · {when(h.cookedAt)} · {h.servings} {h.servings === 1 ? 'person' : 'people'} · {MODE_NAME[h.mode] ?? h.mode}
              </summary>
              <div className="small history-detail">
                <p>Taken from the fridge: {h.deductions.map((d) => `${d.name} ${formatAmount(toBase(d.amount, d.unit), d.unit)}`).join(', ') || 'nothing'}</p>
                {h.missing.length > 0 && <p className="tone-soon">Cooked without: {h.missing.map((m) => m.name).join(', ')}</p>}
              </div>
            </details>
            <button className="icon-btn" aria-label={`Delete ${h.dishName} from history`} onClick={() => run(() => api.del(`/api/history/${h.id}`))}>🗑</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TABLE_LABEL: Record<string, string> = {
  batches: 'fridge batches', history: 'history entries', to_cook: 'To cook dishes', foods: 'foods (incl. catalog)', cart_items: 'cart items',
};

function BackupSection() {
  const { run, showToast } = useApp();
  const [pending, setPending] = useState<{ backup: unknown; counts: Record<string, number>; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="panel stack" aria-label="Backup">
      <h2>Backup</h2>
      <p className="muted small">
        Your data is saved on this computer in the app’s data folder. Export a backup file to keep a copy; your AI key is not included.
      </p>
      <div className="row">
        <a className="button-like primary" href="/api/backup/export" download>Export backup</a>
        <label className="button-like">
          Import backup…
          <input
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            aria-label="Import backup file"
            onChange={async (e) => {
              setError(null);
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              let backup: unknown;
              try {
                backup = JSON.parse(await f.text());
              } catch {
                return setError('This file is not a Virtual Fridge backup. Your current data is unchanged.');
              }
              const check = await api.post<{ ok: boolean; errors: string[]; counts: Record<string, number> }>('/api/backup/preview', { backup });
              if (!check.ok) return setError(`This file can’t be restored: ${check.errors[0]} Your current data is unchanged.`);
              setPending({ backup, counts: check.counts, name: f.name });
            }}
          />
        </label>
      </div>
      <FieldError message={error} />
      {pending && (
        <Modal
          title="Replace all data with this backup?"
          onClose={() => setPending(null)}
          footer={
            <>
              <button onClick={() => setPending(null)}>Cancel</button>
              <button
                className="danger"
                onClick={async () => {
                  const r = await run(() => api.post<{ safetyCopy: string }>('/api/backup/import', { backup: pending.backup }));
                  setPending(null);
                  if (r) showToast({ message: `Backup restored. Your previous data was saved to ${r.safetyCopy}` });
                }}
              >
                Replace my data
              </button>
            </>
          }
        >
          <p><strong>{pending.name}</strong> contains:</p>
          <ul>
            {Object.entries(TABLE_LABEL).map(([k, label]) => (
              <li key={k}>{pending.counts[k] ?? 0} {label}</li>
            ))}
          </ul>
          <p>Everything currently in the app will be replaced. A copy of your current data is saved first, just in case.</p>
        </Modal>
      )}
    </section>
  );
}

export function SettingsPage({ onContinueToCook }: { onContinueToCook: (id: number) => void }) {
  const state = useAppState();
  const [section, setSection] = useState<Section>('ai');
  const items: [Section, string][] = [
    ['ai', 'AI model'],
    ['taste', 'Taste preferences'],
    ['pack', 'Seasoning pack'],
    ['tocook', `To cook (${state.toCook.length})`],
    ['history', 'History'],
    ['backup', 'Backup'],
  ];
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {items.map(([id, label]) => (
          <button key={id} className={section === id ? 'tab active' : 'tab'} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {section === 'ai' && <AiSettings />}
        {section === 'taste' && <TasteSection />}
        {section === 'pack' && <PackSection />}
        {section === 'tocook' && <ToCookSection onContinue={onContinueToCook} />}
        {section === 'history' && <HistorySection />}
        {section === 'backup' && <BackupSection />}
      </div>
    </div>
  );
}
