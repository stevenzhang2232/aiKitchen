import { useEffect, useMemo, useState } from 'react';
import {
  buildInventory, estimateServings, formatAmount, preferredUnitForKind, round, subtractInventory,
  type CookMode, type Food, type Inventory, type Unit, type UnitKind,
} from '@kitchen/core';
import type { Tab } from '../App';
import { api, ApiError, type CartItem, type MissingItem } from '../api';
import { useApp, useAppState } from '../appState';
import { FoodImage } from '../components/FoodImage';
import { FieldError, Modal } from '../components/Modal';
import { draftFrom, TasteFields, tasteSummary, type TasteDraft } from '../components/TasteFields';

interface PresentedDish {
  name: string;
  minutes: number;
  servings: number;
  ingredients: { foodId: number; name: string; amount: number; unit: Unit; display: string; howTo?: string }[];
  seasonings: number[];
  seasoningNames: string[];
  missing: MissingItem[];
  steps: string[];
  deductions: { foodId: number; name: string; unit: Unit; amount: number; available: number }[];
}

interface SuggestResult {
  status: 'ok' | 'missing' | 'cannot';
  dishes?: PresentedDish[];
  reason?: string;
  problems?: string[];
  servings?: number;
}

interface Request {
  mode: CookMode;
  dishName?: string;
  toCookId?: number;
  servings: number;
}

const MODE_LABEL: Record<CookMode, string> = { dish: 'I want a dish', suggest: 'Suggest for me', pick: 'Pick ingredients' };

function stepFor(food: Food, kind: UnitKind): number {
  if (kind === 'weight') return food.defaultUnit === 'kg' ? 1000 : 100;
  return 1;
}

function unitFor(food: Food, kind: UnitKind): Unit {
  if (kind === 'weight') return food.defaultUnit === 'kg' ? 'kg' : 'g';
  return preferredUnitForKind(kind);
}

function cartInventory(cart: CartItem[]): Inventory {
  const inv: Inventory = {};
  for (const c of cart) (inv[c.foodId] ??= {})[c.kind] = c.qty;
  return inv;
}

function PickView({ onCook }: { onCook: (estimate: number) => void }) {
  const state = useAppState();
  const { run, foodById } = useApp();
  const fridge = useMemo(() => buildInventory(state.batches), [state.batches]);
  const left = useMemo(() => subtractInventory(fridge, cartInventory(state.cart)), [fridge, state.cart]);
  const rows = Object.entries(fridge)
    .flatMap(([id, amounts]) =>
      (Object.keys(amounts) as UnitKind[]).filter((k) => (amounts[k] ?? 0) > 0).map((kind) => ({ food: foodById.get(Number(id))!, kind })),
    )
    .filter((r) => r.food && !r.food.isSeasoning)
    .sort((a, b) => a.food.name.localeCompare(b.food.name));
  const inCart = (foodId: number, kind: UnitKind) => state.cart.find((c) => c.foodId === foodId && c.kind === kind)?.qty ?? 0;
  const setQty = (foodId: number, kind: UnitKind, qty: number) => {
    const others = state.cart.filter((c) => !(c.foodId === foodId && c.kind === kind));
    const items = qty > 0 ? [...others, { foodId, kind, qty: round(qty, 6) }] : others;
    return run(() => api.put('/api/cart', { items }));
  };
  const estimate = estimateServings(
    state.cart.map((c) => ({ food: foodById.get(c.foodId)!, kind: c.kind, amount: c.qty })).filter((x) => x.food),
  );
  return (
    <div className="pick-layout">
      <section className="panel stack" aria-label="Your stock">
        <h2>Pick what to cook with</h2>
        <p className="muted small">Each + adds 100 g, 1 kg, 1 piece or 1 serving. Amounts here are only held; the fridge changes after you cook.</p>
        {!rows.length && <p className="muted">Your fridge is empty. Add ingredients on the Fridge page first.</p>}
        <ul className="pick-list">
          {rows.map(({ food, kind }) => {
            const unit = unitFor(food, kind);
            const step = stepFor(food, kind);
            const remaining = left[food.id]?.[kind] ?? 0;
            const held = inCart(food.id, kind);
            return (
              <li key={`${food.id}-${kind}`} className="pick-row" data-testid="pick-row">
                <FoodImage food={food} size="sm" />
                <span className="grow">
                  {food.name}
                  <span className="muted small"> · {formatAmount(remaining, unit)} left</span>
                </span>
                <button className="step-btn" aria-label={`Less ${food.name}`} disabled={held <= 0} onClick={() => setQty(food.id, kind, Math.max(0, held - step))}>−</button>
                <span className="pick-qty">{held > 0 ? formatAmount(held, unit) : '0'}</span>
                <button
                  className="step-btn"
                  aria-label={`More ${food.name}`}
                  disabled={remaining <= 1e-6}
                  onClick={() => setQty(food.id, kind, held + Math.min(step, remaining))}
                >
                  +
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <aside className="panel stack cart" aria-label="Cart">
        <h2>Cart ({state.cart.length})</h2>
        {!state.cart.length && <p className="muted small">Nothing picked yet.</p>}
        <ul className="cart-list">
          {state.cart.map((c) => {
            const f = foodById.get(c.foodId);
            if (!f) return null;
            return (
              <li key={`${c.foodId}-${c.kind}`}>
                <span className="grow">{f.name} {formatAmount(c.qty, unitFor(f, c.kind))}</span>
                <button className="icon-btn" aria-label={`Remove ${f.name} from cart`} onClick={() => setQty(c.foodId, c.kind, 0)}>×</button>
              </li>
            );
          })}
        </ul>
        {state.cart.length > 0 && <p className="muted small">Enough for about {estimate} {estimate === 1 ? 'person' : 'people'}.</p>}
        <div className="row">
          <button disabled={!state.cart.length} onClick={() => run(() => api.del('/api/cart'))}>Clear all</button>
          <button className="primary" disabled={!state.cart.length} onClick={() => onCook(estimate)}>Cook these</button>
        </div>
      </aside>
    </div>
  );
}

function ServingsDialog({
  mode, initial, estimate, needTaste, onCancel, onConfirm,
}: {
  mode: CookMode;
  initial: number;
  estimate?: number;
  needTaste: boolean;
  onCancel: () => void;
  onConfirm: (servings: number) => Promise<void>;
}) {
  const state = useAppState();
  const { refresh } = useApp();
  const [servings, setServings] = useState(initial);
  const [editTaste, setEditTaste] = useState(needTaste);
  const [taste, setTaste] = useState<TasteDraft>(draftFrom(state.taste));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!(servings >= 1 && servings <= 20)) return setError('Enter 1 to 20 people.');
    setBusy(true);
    try {
      if (editTaste) {
        await api.put('/api/taste', taste);
        await refresh();
      }
      await onConfirm(servings);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="How many people are eating?"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel}>{mode === 'pick' ? 'Back to picking' : 'Cancel'}</button>
          <button className="primary" disabled={busy} onClick={submit}>{mode === 'pick' ? 'Confirm' : 'Get dishes'}</button>
        </>
      }
    >
      <div className="row servings-row">
        <button className="step-btn" aria-label="Fewer people" onClick={() => setServings((s) => Math.max(1, s - 1))}>−</button>
        <input
          type="number"
          min={1}
          max={20}
          value={servings}
          onChange={(e) => setServings(Number(e.target.value))}
          aria-label="People eating"
          className="servings-input"
        />
        <button className="step-btn" aria-label="More people" onClick={() => setServings((s) => Math.min(20, s + 1))}>+</button>
        {estimate !== undefined && <span className="muted">Estimated from your picks: {estimate}</span>}
      </div>
      {needTaste && <p className="muted">First time here: tell us your taste. It’s saved as your default.</p>}
      {editTaste ? (
        <TasteFields value={taste} onChange={setTaste} />
      ) : (
        <p className="muted small">
          Taste: {tasteSummary(state.taste)}{' '}
          <button className="link" onClick={() => setEditTaste(true)}>Edit</button>
        </p>
      )}
      <FieldError message={error} />
    </Modal>
  );
}

function ConfirmCooked({
  dish, onCancel, onConfirm,
}: {
  dish: PresentedDish;
  onCancel: () => void;
  onConfirm: (lines: { foodId: number; amount: number; unit: Unit }[]) => Promise<void>;
}) {
  const [amounts, setAmounts] = useState(dish.deductions.map((d) => String(d.amount)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Did you cook it?"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Not yet</button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              const nums = amounts.map(Number);
              if (nums.some((n) => !(n >= 0))) return setError('Amounts must be 0 or more.');
              setBusy(true);
              try {
                await onConfirm(dish.deductions.map((d, i) => ({ foodId: d.foodId, unit: d.unit, amount: nums[i] })));
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Could not update the fridge.');
                setBusy(false);
              }
            }}
          >
            Yes, update my fridge
          </button>
        </>
      }
    >
      <p>These amounts will be taken from your fridge (soonest-expiring first). Change them if you used a different amount.</p>
      {!dish.deductions.length && <p className="muted">Nothing from the fridge is used.</p>}
      <div className="stack">
        {dish.deductions.map((d, i) => (
          <label key={d.foodId + d.unit} className="deduct-row">
            <span className="grow">{d.name}</span>
            <input
              type="number"
              min={0}
              step="any"
              value={amounts[i]}
              onChange={(e) => setAmounts((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={`Amount of ${d.name} used`}
            />
            <span className="muted">{d.unit} (of {d.available})</span>
          </label>
        ))}
      </div>
      {dish.missing.length > 0 && <p className="muted small">Missing items ({dish.missing.map((m) => m.name).join(', ')}) aren’t in the fridge, so nothing is taken for them.</p>}
      <FieldError message={error} />
    </Modal>
  );
}

function Recipe({ dish, onBack, onCooked }: { dish: PresentedDish; onBack: () => void; onCooked: () => void }) {
  return (
    <article className="panel stack recipe" aria-label={`Recipe: ${dish.name}`}>
      <div className="row space">
        <h2>{dish.name}</h2>
        <span className="muted">{dish.servings} {dish.servings === 1 ? 'person' : 'people'} · about {dish.minutes} min</span>
      </div>
      <section>
        <h3>Ingredients</h3>
        <ul className="ing-list">
          {dish.ingredients.map((i) => (
            <li key={`${i.foodId}-${i.unit}`}>
              <strong>{i.name}</strong>: {i.howTo ? `${i.howTo} (${i.display})` : i.display}
            </li>
          ))}
          {dish.missing.map((m) => (
            <li key={`m-${m.name}`} className="tone-soon">
              <strong>{m.name}</strong>
              {m.amount ? `: about ${formatAmount(m.amount, (m.unit ?? 'g') as Unit)}` : ''} — missing, not in your fridge
            </li>
          ))}
        </ul>
        {dish.seasoningNames.length > 0 && <p className="muted small">Seasonings: {dish.seasoningNames.join(', ')}</p>}
      </section>
      <section>
        <h3>Steps</h3>
        <ol className="steps">
          {dish.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </section>
      <div className="row">
        <button onClick={onBack}>Back</button>
        <button className="primary" onClick={onCooked}>I cooked it</button>
      </div>
    </article>
  );
}

export function CookPage({ intent, clearIntent, goTo }: { intent: { toCookId: number } | null; clearIntent: () => void; goTo: (t: Tab) => void }) {
  const state = useAppState();
  const { run, showToast } = useApp();
  const [view, setView] = useState<'choose' | 'pick' | 'loading' | 'result' | 'recipe'>('choose');
  const [dishName, setDishName] = useState('');
  const [dishError, setDishError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ mode: CookMode; dishName?: string; toCookId?: number; initial: number; estimate?: number } | null>(null);
  const [req, setReq] = useState<Request | null>(null);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [chosen, setChosen] = useState<PresentedDish | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lastServings, setLastServings] = useState(2);

  useEffect(() => {
    if (!intent) return;
    const item = state.toCook.find((x) => x.id === intent.toCookId);
    clearIntent();
    if (!item) return;
    setDishName(item.dishName);
    setView('choose');
    setAsk({ mode: 'dish', dishName: item.dishName, toCookId: item.id, initial: item.servings });
  }, [intent, state.toCook, clearIntent]);

  const fetchDishes = async (r: Request) => {
    setReq(r);
    setView('loading');
    setError(null);
    setResult(null);
    try {
      const res = await api.post<SuggestResult>('/api/cook/suggest', r);
      setResult(res);
      setView('result');
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, code: e.code } : { message: 'Something went wrong.' });
      setView('result');
    }
  };

  const startDish = () => {
    if (!dishName.trim()) return setDishError('Type the dish you want to cook.');
    setDishError(null);
    setAsk({ mode: 'dish', dishName: dishName.trim(), initial: lastServings });
  };

  const reset = () => {
    setView('choose');
    setResult(null);
    setChosen(null);
    setReq(null);
    setError(null);
  };

  const saveToCook = async (dish: PresentedDish) => {
    const r = await run(() =>
      api.post('/api/to-cook', { dishName: dish.name, servings: req!.servings, missing: dish.missing, taste: state.taste }),
    );
    if (r) {
      if (req?.toCookId) await api.del(`/api/to-cook/${req.toCookId}`).catch(() => undefined);
      await run(async () => undefined);
      showToast({ message: `Saved “${dish.name}” to To cook in Settings` });
      reset();
    }
  };

  const confirmCooked = async (lines: { foodId: number; amount: number; unit: Unit }[]) => {
    const dish = chosen!;
    const r = await api.post<{ summary: string }>('/api/cook/confirm', {
      mode: req!.mode,
      servings: req!.servings,
      toCookId: req!.toCookId,
      dish: { name: dish.name, minutes: dish.minutes, servings: dish.servings, ingredients: dish.ingredients, seasonings: dish.seasonings, missing: dish.missing, steps: dish.steps },
      lines,
    });
    await run(async () => undefined);
    setConfirming(false);
    showToast({ message: `Enjoy! Fridge updated${r.summary ? `: ${r.summary}` : ''}` });
    reset();
  };

  return (
    <div className="stack cook">
      {view === 'choose' && (
        <div className="mode-grid">
          <section className="panel stack mode-card" aria-label="I want a dish">
            <h2>I want a dish</h2>
            <p className="muted small">Name a dish. AI checks your fridge and tells you what’s missing.</p>
            <input value={dishName} onChange={(e) => setDishName(e.target.value)} placeholder="Tomato scrambled eggs" aria-label="Dish name" onKeyDown={(e) => e.key === 'Enter' && startDish()} />
            <FieldError message={dishError} />
            <button className="primary" onClick={startDish}>Check my fridge</button>
          </section>
          <section className="panel stack mode-card" aria-label="Suggest for me">
            <h2>Suggest for me</h2>
            <p className="muted small">1 to 3 dishes from what you have, using what expires soonest first.</p>
            <button className="primary" onClick={() => setAsk({ mode: 'suggest', initial: lastServings })}>Suggest dishes</button>
          </section>
          <section className="panel stack mode-card" aria-label="Pick ingredients">
            <h2>Pick ingredients</h2>
            <p className="muted small">Choose ingredients and amounts, then AI cooks with them.</p>
            <button className="primary" onClick={() => setView('pick')}>
              Pick ingredients{state.cart.length ? ` (${state.cart.length} in cart)` : ''}
            </button>
          </section>
        </div>
      )}

      {view === 'pick' && (
        <>
          <div className="row"><button onClick={() => setView('choose')}>Back</button></div>
          <PickView onCook={(estimate) => setAsk({ mode: 'pick', initial: Math.max(1, estimate), estimate })} />
        </>
      )}

      {view === 'loading' && (
        <div className="panel"><p>Asking the AI for {req?.mode === 'dish' ? `“${req.dishName}”` : 'dishes'}… This can take up to a minute.</p></div>
      )}

      {view === 'result' && (
        <div className="stack">
          <div className="row">
            <button onClick={() => (req?.mode === 'pick' ? setView('pick') : reset())}>{req?.mode === 'pick' ? 'Back to picking' : 'Start over'}</button>
            {req && <span className="muted">{MODE_LABEL[req.mode]} · {req.servings} {req.servings === 1 ? 'person' : 'people'}</span>}
          </div>
          {error && (
            <div className="panel stack" role="alert">
              <p>{error.message}</p>
              <p className="muted small">Your fridge is not affected.</p>
              <div className="row">
                {error.code === 'ai-not-configured' ? (
                  <button className="primary" onClick={() => goTo('settings')}>Open Settings</button>
                ) : (
                  req && <button className="primary" onClick={() => fetchDishes(req)}>Try again</button>
                )}
              </div>
            </div>
          )}
          {result?.status === 'cannot' && (
            <div className="panel stack" role="alert">
              <p><strong>Can’t make this with what you have.</strong> {result.reason}</p>
              {result.problems && result.problems.length > 0 && (
                <details>
                  <summary className="muted small">Why</summary>
                  <ul className="small">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </details>
              )}
              {req && <div className="row"><button onClick={() => fetchDishes(req)}>Try again</button></div>}
            </div>
          )}
          {result?.status === 'missing' && result.dishes && (
            <div className="panel stack" role="region" aria-label="Missing ingredients">
              <h2>{result.dishes[0].name}: missing {result.dishes[0].missing.length} {result.dishes[0].missing.length === 1 ? 'item' : 'items'}</h2>
              <ul>
                {result.dishes[0].missing.map((m) => (
                  <li key={m.name}>{m.name}{m.amount ? ` — about ${formatAmount(m.amount, (m.unit ?? 'g') as Unit)}` : ''}</li>
                ))}
              </ul>
              <div className="row">
                <button onClick={() => saveToCook(result.dishes![0])}>Buy first</button>
                <button
                  className="primary"
                  onClick={() => {
                    setChosen(result.dishes![0]);
                    setView('recipe');
                  }}
                >
                  Cook anyway
                </button>
              </div>
              <p className="muted small">“Buy first” saves this dish to Settings → To cook. “Cook anyway” only takes what you have from the fridge.</p>
            </div>
          )}
          {result?.status === 'ok' && result.dishes && (
            <div className="dish-grid">
              {result.dishes.map((d) => (
                <button
                  key={d.name}
                  className="panel dish-card"
                  onClick={() => {
                    setChosen(d);
                    setView('recipe');
                  }}
                >
                  <strong>{d.name}</strong>
                  <span className="muted">About {d.minutes} min</span>
                  <span className="small">{d.ingredients.map((i) => i.name).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'recipe' && chosen && (
        <Recipe dish={chosen} onBack={() => setView('result')} onCooked={() => setConfirming(true)} />
      )}

      {ask && (
        <ServingsDialog
          mode={ask.mode}
          initial={ask.initial}
          estimate={ask.estimate}
          needTaste={ask.mode !== 'pick' && !state.taste}
          onCancel={() => setAsk(null)}
          onConfirm={async (servings) => {
            const a = ask;
            setAsk(null);
            setLastServings(servings);
            await fetchDishes({ mode: a.mode, servings, dishName: a.dishName, toCookId: a.toCookId });
          }}
        />
      )}
      {confirming && chosen && <ConfirmCooked dish={chosen} onCancel={() => setConfirming(false)} onConfirm={confirmCooked} />}
    </div>
  );
}
