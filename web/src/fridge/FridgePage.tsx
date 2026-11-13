import { useMemo, useState } from 'react';
import {
  DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { buildFoodCards, isAlert, LOCATIONS, searchFoods, type Category, type Food, type Location } from '@kitchen/core';
import { api } from '../api';
import { useApp, useAppState } from '../appState';
import { CATEGORY_LABEL, FoodImage } from '../components/FoodImage';
import { LOCATION_LABEL } from '../components/forms';
import { FoodCards } from './FoodCards';
import { useAddFlow } from './useAddFlow';
import { ReceiptScanner } from './ReceiptScanner';

export type FridgeFilter = 'all' | 'eat-first';

function SearchBar({ onAdd, onDetails }: { onAdd: (f: Food) => void; onDetails: (f: Food) => void }) {
  const state = useAppState();
  const { run } = useApp();
  const [q, setQ] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('vegetable');
  const results = useMemo(() => searchFoods(state.foods, q, 12), [state.foods, q]);
  const have = new Map(state.seasonings.map((s) => [s.foodId, s.have]));
  const create = async (isSeasoning: boolean) => {
    const r = await run(() => api.post<{ food: Food }>('/api/foods', { name: q, category: newCategory, isSeasoning }));
    if (!r) return;
    if (isSeasoning) await run(() => api.post(`/api/seasonings/${r.food.id}`, { have: true }));
    else onAdd(r.food);
  };
  return (
    <div className="search">
      <div className="search-box">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ingredients or seasonings (tomato / 番茄)"
          aria-label="Search ingredients or seasonings"
        />
        {q && (
          <button className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}>×</button>
        )}
      </div>
      {q.trim() && (
        <div className="search-results" role="list" aria-label="Search results">
          {results.map((f) => (
            <div key={f.id} className="search-row" role="listitem">
              <FoodImage food={f} size="sm" />
              <span className="grow">
                {f.name}
                <span className="muted small"> · {CATEGORY_LABEL[f.category]}</span>
              </span>
              {f.isSeasoning ? (
                <button
                  onClick={() => run(() => api.post(`/api/seasonings/${f.id}`, { have: !have.get(f.id) }))}
                  aria-label={have.get(f.id) ? `Mark ${f.name} as don't have` : `Mark ${f.name} as have`}
                >
                  {have.get(f.id) ? 'Have ✓' : 'Mark as have'}
                </button>
              ) : (
                <>
                  <button onClick={() => onDetails(f)} aria-label={`Add ${f.name} with details`}>Details</button>
                  <button className="primary" onClick={() => onAdd(f)} aria-label={`Add ${f.name}`}>Add</button>
                </>
              )}
            </div>
          ))}
          {!results.some((f) => f.name.toLowerCase() === q.trim().toLowerCase()) && (
            <div className="search-row new-row">
              <span className="grow">
                Not listed? Add “{q.trim()}” as
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Category)} aria-label="Category for new ingredient">
                  {(Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => c !== 'seasoning').map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c].toLowerCase()}</option>
                  ))}
                </select>
              </span>
              <button onClick={() => create(false)}>Add ingredient</button>
              <button onClick={() => create(true)}>Add seasoning</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SeasoningRow() {
  const state = useAppState();
  const { run, foodById, showToast } = useApp();
  return (
    <section className="seasonings" aria-label="Seasonings">
      <div className="section-label">
        Seasonings <span className="muted small">· tap to switch have / don’t have</span>
      </div>
      <div className="chip-row">
        {state.seasonings.map((s) => {
          const f = foodById.get(s.foodId);
          if (!f) return null;
          return (
            <button
              key={s.foodId}
              className={s.have ? 'chip on' : 'chip off'}
              aria-pressed={s.have}
              onClick={() => run(() => api.post(`/api/seasonings/${s.foodId}`, { have: !s.have }))}
            >
              {s.have ? '✓ ' : ''}
              {f.name}
            </button>
          );
        })}
        <button
          className="chip add"
          onClick={async () => {
            const r = await run(() => api.post<{ added: number[] }>('/api/seasoning-pack/apply'));
            if (r) showToast({ message: `Added your seasoning pack (${r.added.length} items)` });
          }}
        >
          + Add seasoning pack
        </button>
      </div>
    </section>
  );
}

function FavoriteItem({ food, pinned, onAdd }: { food: Food; pinned: boolean; onAdd: () => void }) {
  const { run } = useApp();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `fav-${food.id}`, data: { foodId: food.id } });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20 } : undefined;
  return (
    <div className={isDragging ? 'fav-item dragging' : 'fav-item'} ref={setNodeRef} style={style} data-testid="fav-item">
      <button className="fav-main" {...listeners} {...attributes} onClick={onAdd} aria-label={`Add one ${food.name}`}>
        <FoodImage food={food} size="sm" />
        <span>{food.name}</span>
      </button>
      <button
        className={pinned ? 'icon-btn pin on' : 'icon-btn pin'}
        aria-label={pinned ? `Unpin ${food.name}` : `Pin ${food.name}`}
        aria-pressed={pinned}
        onClick={() => run(() => api.post(`/api/foods/${food.id}/pin`, { pinned: !pinned }))}
        title={pinned ? 'Pinned' : 'Pin to keep in place'}
      >
        📌
      </button>
    </div>
  );
}

function FavoritesPanel({ onAdd, onClose }: { onAdd: (f: Food) => void; onClose: () => void }) {
  const state = useAppState();
  const { foodById } = useApp();
  const pinned = new Set(state.favoriteStats.filter((s) => s.pinned).map((s) => s.foodId));
  return (
    <aside className="fav-panel" aria-label="Favorites">
      <div className="fav-head">
        <strong>Favorites</strong>
        <button className="icon-btn" aria-label="Close favorites" onClick={onClose}>×</button>
      </div>
      <p className="muted small">Click to add one, or drag into the fridge.</p>
      <div className="fav-list">
        {state.favorites.map((id) => {
          const f = foodById.get(id);
          return f ? <FavoriteItem key={id} food={f} pinned={pinned.has(id)} onAdd={() => onAdd(f)} /> : null;
        })}
        {!state.favorites.length && <p className="muted small">Ingredients you add often will show up here.</p>}
      </div>
    </aside>
  );
}

function FridgeDropZone({ children, active }: { children: React.ReactNode; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'fridge-drop' });
  return (
    <div ref={setNodeRef} className={`fridge-drop${active ? ' drag-active' : ''}${isOver ? ' over' : ''}`} data-testid="fridge-drop">
      {children}
    </div>
  );
}

export function Onboarding() {
  const state = useAppState();
  const { run } = useApp();
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState('');
  const [withPack, setWithPack] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const foods = state.foods.filter((f) => !f.isSeasoning);
  const shown = q.trim() ? searchFoods(foods, q, 16) : state.commonFoods.map((id) => foods.find((f) => f.id === id)!).filter(Boolean);
  const toggle = (id: number) => {
    setError(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 8 ? p : [...p, id]));
  };
  const submit = async () => {
    if (picked.length < 6) return setError('Pick at least 6 ingredients.');
    await run(async () => {
      if (withPack) await api.post('/api/seasoning-pack/apply');
      await api.post('/api/onboarding', { foodIds: picked });
    });
  };
  return (
    <div className="onboarding" role="region" aria-label="Welcome">
      <h1>Welcome to your virtual fridge</h1>
      <p>Pick 6 to 8 ingredients you buy often. They become your favorites for one-click adding. Nothing is added to the fridge yet.</p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search more ingredients"
        aria-label="Search more ingredients"
      />
      <div className="chip-row wrap">
        {shown.map((f) => (
          <button
            key={f.id}
            className={picked.includes(f.id) ? 'chip on' : 'chip'}
            aria-pressed={picked.includes(f.id)}
            onClick={() => toggle(f.id)}
          >
            {f.name}
          </button>
        ))}
      </div>
      <p className="muted">
        {picked.length} of 6–8 picked
        {picked.length > 0 && `: ${picked.map((id) => state.foods.find((f) => f.id === id)?.name).join(', ')}`}
      </p>
      <label className="check">
        <input type="checkbox" checked={withPack} onChange={(e) => setWithPack(e.target.checked)} />
        Also add my basic seasonings (oil, salt, sugar, light soy sauce, dark soy sauce, vinegar)
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="primary big" onClick={submit} disabled={picked.length < 6}>
        Start using my fridge
      </button>
    </div>
  );
}

export function FridgePage({ filter, setFilter }: { filter: FridgeFilter; setFilter: (f: FridgeFilter) => void }) {
  const state = useAppState();
  const [location, setLocation] = useState<Location | 'all'>('all');
  const [panelOpen, setPanelOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { quickAdd, addWithDetails, elements } = useAddFlow();
  const { foodById } = useApp();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const allCards = useMemo(() => buildFoodCards(state.foods, state.batches, state.today, location), [state, location]);
  const cards = filter === 'eat-first' ? allCards.filter(isAlert) : allCards;

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false);
    if (e.over?.id !== 'fridge-drop') return;
    const f = foodById.get(e.active.data.current?.foodId as number);
    if (f) quickAdd(f);
  };

  return (
    <DndContext sensors={sensors} onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={onDragEnd}>
      <div className={panelOpen ? 'fridge-layout with-panel' : 'fridge-layout'}>
        <div className="fridge-main">
          <div className="toolbar">
            <SearchBar onAdd={quickAdd} onDetails={addWithDetails} />
            <select value={location} onChange={(e) => setLocation(e.target.value as Location | 'all')} aria-label="Storage location">
              <option value="all">All places</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{LOCATION_LABEL[l]}</option>
              ))}
            </select>
          </div>
          <SeasoningRow />
          <FridgeDropZone active={dragging}>
            <div className="section-label">
              {filter === 'eat-first' ? 'Eat first' : 'Ingredients'}
              <span className="muted small"> · soonest to expire first</span>
              {filter === 'eat-first' && (
                <button className="link" onClick={() => setFilter('all')}>Show everything</button>
              )}
            </div>
            {cards.length ? (
              <FoodCards cards={cards} />
            ) : (
              <div className="empty">
                {filter === 'eat-first' ? (
                  <p>Nothing needs eating first. Nice.</p>
                ) : (
                  <>
                    <p><strong>Your fridge is empty</strong></p>
                    <p className="muted">Search above, or open your favorites with the + button to add ingredients.</p>
                  </>
                )}
              </div>
            )}
          </FridgeDropZone>
        </div>
        {panelOpen && <FavoritesPanel onAdd={quickAdd} onClose={() => setPanelOpen(false)} />}
      </div>
      <button
        className={panelOpen ? 'fab camera' : 'fab'}
        aria-label={panelOpen ? 'Scan receipt' : 'Add ingredients'}
        title={panelOpen ? 'Scan a receipt' : 'Add ingredients'}
        onClick={() => (panelOpen ? setScanning(true) : setPanelOpen(true))}
      >
        {panelOpen ? '📷' : '+'}
      </button>
      {scanning && <ReceiptScanner onClose={() => setScanning(false)} />}
      {elements}
    </DndContext>
  );
}
