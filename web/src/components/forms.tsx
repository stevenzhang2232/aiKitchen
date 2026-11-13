import { useState } from 'react';
import {
  fromBase, formatAmount, LOCATIONS, shortDate, todayLocal, unitKind, UNITS,
  type Batch, type Food, type Location, type Unit,
} from '@kitchen/core';
import { FieldError, Modal } from './Modal';
import { ApiError } from '../api';

export const LOCATION_LABEL: Record<Location, string> = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' };
export const UNIT_LABEL: Record<Unit, string> = { g: 'g', kg: 'kg', pcs: 'pcs', serving: 'serving' };
const UNIT_HELP: Record<Unit, string> = {
  g: 'Grams. One click adds 100 g.',
  kg: 'Kilograms. One click adds 1 kg.',
  pcs: 'Pieces. One click adds 1 piece.',
  serving: 'Servings. One click adds 1 serving.',
};

function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
}

/** Run a submit handler and keep the dialog open with the message if it fails. */
function useSubmit(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, busy, submit };
}

export function UnitPicker({ food, onPick, onClose }: { food: Food; onPick: (u: Unit) => Promise<void>; onClose: () => void }) {
  const [unit, setUnit] = useState<Unit>(food.suggestedUnit);
  const { error, busy, submit } = useSubmit(onClose);
  return (
    <Modal
      title={`How do you measure ${food.name}?`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => submit(() => onPick(unit))}>
            Use {UNIT_LABEL[unit]}
          </button>
        </>
      }
    >
      <p className="muted">Pick the unit you’ll usually use. You can still add other units with “Add with details”.</p>
      <div className="radio-list" role="radiogroup" aria-label="Unit">
        {UNITS.map((u) => (
          <label key={u} className={unit === u ? 'radio-card selected' : 'radio-card'}>
            <input type="radio" name="unit" value={u} checked={unit === u} onChange={() => setUnit(u)} />
            <span className="radio-title">{UNIT_LABEL[u]}</span>
            <span className="muted small">{UNIT_HELP[u]}</span>
          </label>
        ))}
      </div>
      <FieldError message={error} />
    </Modal>
  );
}

type ExpiryMode = 'none' | 'date' | 'days';

export function ExpiryFields({
  mode, setMode, expiryDate, setExpiryDate, startDate, setStartDate, keepDays, setKeepDays, noneLabel,
}: {
  mode: ExpiryMode; setMode: (m: ExpiryMode) => void;
  expiryDate: string; setExpiryDate: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  keepDays: string; setKeepDays: (v: string) => void;
  noneLabel: string;
}) {
  return (
    <fieldset className="fieldset">
      <legend>Shelf life</legend>
      <div className="seg" role="radiogroup" aria-label="Shelf life">
        <label className={mode === 'none' ? 'seg-item on' : 'seg-item'}>
          <input type="radio" name="expiry-mode" checked={mode === 'none'} onChange={() => setMode('none')} />
          {noneLabel}
        </label>
        <label className={mode === 'date' ? 'seg-item on' : 'seg-item'}>
          <input type="radio" name="expiry-mode" checked={mode === 'date'} onChange={() => setMode('date')} />
          Use-by date
        </label>
        <label className={mode === 'days' ? 'seg-item on' : 'seg-item'}>
          <input type="radio" name="expiry-mode" checked={mode === 'days'} onChange={() => setMode('days')} />
          Start date + days
        </label>
      </div>
      {mode === 'date' && (
        <label className="field">
          <span>Use by</span>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} aria-label="Use by" />
        </label>
      )}
      {mode === 'days' && (
        <div className="row">
          <label className="field">
            <span>Starting from</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Starting from" />
          </label>
          <label className="field">
            <span>Keeps for (days)</span>
            <input type="number" min={0} step={1} value={keepDays} onChange={(e) => setKeepDays(e.target.value)} aria-label="Keeps for (days)" />
          </label>
        </div>
      )}
    </fieldset>
  );
}

function expiryPayload(mode: ExpiryMode, expiryDate: string, startDate: string, keepDays: string): Record<string, unknown> | string {
  if (mode === 'date') {
    if (!expiryDate) return 'Enter a use-by date.';
    return { expiryDate };
  }
  if (mode === 'days') {
    if (!startDate) return 'Enter a start date.';
    if (keepDays === '' || !Number.isInteger(Number(keepDays)) || Number(keepDays) < 0) return 'Days must be a whole number of 0 or more.';
    return { startDate, keepDays: Number(keepDays) };
  }
  return {};
}

export function AddDetailsForm({
  food, title, onSubmit, onClose,
}: {
  food: Food;
  title?: string;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<Unit>(food.defaultUnit ?? food.suggestedUnit);
  const [location, setLocation] = useState<Location>(food.defaultLocation);
  const [mode, setMode] = useState<ExpiryMode>('none');
  const [expiryDate, setExpiryDate] = useState('');
  const [startDate, setStartDate] = useState(todayLocal());
  const [keepDays, setKeepDays] = useState('3');
  const { error, setError, busy, submit } = useSubmit(onClose);

  const onSave = () => {
    const n = Number(qty);
    if (!(n > 0)) return setError('Enter an amount greater than 0.');
    const exp = expiryPayload(mode, expiryDate, startDate, keepDays);
    if (typeof exp === 'string') return setError(exp);
    submit(() => onSubmit({ foodId: food.id, qty: n, unit, location, ...exp }));
  };

  return (
    <Modal
      title={title ?? `Add ${food.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={onSave}>
            Add to fridge
          </button>
        </>
      }
    >
      <div className="row">
        <label className="field grow">
          <span>Amount</span>
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Amount" />
        </label>
        <label className="field">
          <span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit">
            {UNITS.map((u) => (
              <option key={u} value={u}>{UNIT_LABEL[u]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Stored in</span>
          <select value={location} onChange={(e) => setLocation(e.target.value as Location)} aria-label="Stored in">
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>{LOCATION_LABEL[l]}</option>
            ))}
          </select>
        </label>
      </div>
      <ExpiryFields
        mode={mode} setMode={setMode} expiryDate={expiryDate} setExpiryDate={setExpiryDate}
        startDate={startDate} setStartDate={setStartDate} keepDays={keepDays} setKeepDays={setKeepDays}
        noneLabel="Let AI suggest"
      />
      <FieldError message={error} />
    </Modal>
  );
}

function batchLabel(b: Batch) {
  const exp = b.expiryDate ? `use by ${shortDate(b.expiryDate)}` : 'no use-by date';
  return `${formatAmount(b.qty, b.unit)} · added ${shortDate(b.addedDate)} · ${exp}`;
}

function BatchSelect({ batches, value, onChange }: { batches: Batch[]; value: number; onChange: (id: number) => void }) {
  if (batches.length === 1) return <p className="muted">{batchLabel(batches[0])}</p>;
  return (
    <label className="field">
      <span>Batch</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Batch">
        {batches.map((b) => (
          <option key={b.id} value={b.id}>{batchLabel(b)}</option>
        ))}
      </select>
    </label>
  );
}

export function AdjustForm({ food, batches, initialBatch, onSubmit, onClose }: {
  food: Food; batches: Batch[]; initialBatch?: number;
  onSubmit: (batchId: number, qty: number, unit: Unit) => Promise<unknown>; onClose: () => void;
}) {
  const [batchId, setBatchId] = useState(initialBatch ?? batches[0].id);
  const batch = batches.find((b) => b.id === batchId) ?? batches[0];
  const [qty, setQty] = useState(String(fromBase(batch.qty, batch.unit)));
  const [unit, setUnit] = useState<Unit>(batch.unit);
  const { error, setError, busy, submit } = useSubmit(onClose);
  const choose = (id: number) => {
    const b = batches.find((x) => x.id === id)!;
    setBatchId(id);
    setUnit(b.unit);
    setQty(String(fromBase(b.qty, b.unit)));
  };
  const compatible = UNITS.filter((u) => unitKind(u) === unitKind(batch.unit));
  return (
    <Modal
      title={`Adjust ${food.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const n = Number(qty);
              if (qty === '' || !(n >= 0)) return setError('Enter an amount of 0 or more.');
              submit(() => onSubmit(batchId, n, unit));
            }}
          >
            Save amount
          </button>
        </>
      }
    >
      <BatchSelect batches={batches} value={batchId} onChange={choose} />
      <div className="row">
        <label className="field grow">
          <span>New amount</span>
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="New amount" />
        </label>
        <label className="field">
          <span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit">
            {compatible.map((u) => (
              <option key={u} value={u}>{UNIT_LABEL[u]}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">Setting 0 removes this batch.</p>
      <FieldError message={error} />
    </Modal>
  );
}

export function MoveForm({ food, batches, initialBatch, onSubmit, onClose }: {
  food: Food; batches: Batch[]; initialBatch?: number;
  onSubmit: (batchId: number, location: Location) => Promise<unknown>; onClose: () => void;
}) {
  const [batchId, setBatchId] = useState(initialBatch ?? batches[0].id);
  const batch = batches.find((b) => b.id === batchId) ?? batches[0];
  const [location, setLocation] = useState<Location>(batch.location === 'fridge' ? 'freezer' : 'fridge');
  const { error, busy, submit } = useSubmit(onClose);
  return (
    <Modal
      title={`Move ${food.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => submit(() => onSubmit(batchId, location))}>
            Move
          </button>
        </>
      }
    >
      <BatchSelect batches={batches} value={batchId} onChange={setBatchId} />
      <p className="muted small">Now in: {LOCATION_LABEL[batch.location]}</p>
      <label className="field">
        <span>Move to</span>
        <select value={location} onChange={(e) => setLocation(e.target.value as Location)} aria-label="Move to">
          {LOCATIONS.map((l) => (
            <option key={l} value={l}>{LOCATION_LABEL[l]}</option>
          ))}
        </select>
      </label>
      <FieldError message={error} />
    </Modal>
  );
}

export function UseForm({ food, batches, onSubmit, onClose }: {
  food: Food; batches: Batch[];
  onSubmit: (amount: number, unit: Unit) => Promise<unknown>; onClose: () => void;
}) {
  const units = [...new Set(batches.map((b) => b.unit))];
  const [unit, setUnit] = useState<Unit>(units[0]);
  const [qty, setQty] = useState(unit === 'g' ? '100' : '1');
  const { error, setError, busy, submit } = useSubmit(onClose);
  const options = UNITS.filter((u) => units.some((x) => unitKind(x) === unitKind(u)));
  const available = batches.filter((b) => unitKind(b.unit) === unitKind(unit)).reduce((a, b) => a + b.qty, 0);
  return (
    <Modal
      title={`Use ${food.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const n = Number(qty);
              if (!(n > 0)) return setError('Enter an amount greater than 0.');
              submit(() => onSubmit(n, unit));
            }}
          >
            Use
          </button>
        </>
      }
    >
      <p className="muted">Available: {formatAmount(available, unit)}. The batch that expires first is used first.</p>
      <div className="row">
        <label className="field grow">
          <span>Amount used</span>
          <input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Amount used" />
        </label>
        <label className="field">
          <span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} aria-label="Unit">
            {options.map((u) => (
              <option key={u} value={u}>{UNIT_LABEL[u]}</option>
            ))}
          </select>
        </label>
      </div>
      <FieldError message={error} />
    </Modal>
  );
}

export function RemoveForm({ food, batches, initialBatch, onSubmit, onClose }: {
  food: Food; batches: Batch[]; initialBatch?: number;
  onSubmit: (batchIds: number[]) => Promise<unknown>; onClose: () => void;
}) {
  const [batchId, setBatchId] = useState<number | 'all'>(initialBatch ?? (batches.length === 1 ? batches[0].id : 'all'));
  const { error, busy, submit } = useSubmit(onClose);
  return (
    <Modal
      title={`Remove ${food.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => submit(() => onSubmit(batchId === 'all' ? batches.map((b) => b.id) : [batchId]))}
          >
            Remove
          </button>
        </>
      }
    >
      {batches.length > 1 ? (
        <label className="field">
          <span>What to remove</span>
          <select
            value={String(batchId)}
            onChange={(e) => setBatchId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            aria-label="What to remove"
          >
            <option value="all">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{batchLabel(b)}</option>
            ))}
          </select>
        </label>
      ) : (
        <p>{batchLabel(batches[0])}</p>
      )}
      <p className="muted small">Removing deletes the record. To record eating it, use “Use” instead.</p>
      <FieldError message={error} />
    </Modal>
  );
}

export function DatesForm({ food, batch, onSubmit, onClose }: {
  food: Food; batch: Batch;
  onSubmit: (body: { expiry: Record<string, unknown> | null; addedDate: string }) => Promise<unknown>; onClose: () => void;
}) {
  const [mode, setMode] = useState<ExpiryMode>(batch.expiryDate ? 'date' : 'none');
  const [expiryDate, setExpiryDate] = useState(batch.expiryDate ?? '');
  const [startDate, setStartDate] = useState(batch.addedDate);
  const [keepDays, setKeepDays] = useState('3');
  const [addedDate, setAddedDate] = useState(batch.addedDate);
  const { error, setError, busy, submit } = useSubmit(onClose);
  return (
    <Modal
      title={`Dates for ${food.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              if (!addedDate) return setError('Enter the date added.');
              const exp = expiryPayload(mode, expiryDate, startDate, keepDays);
              if (typeof exp === 'string') return setError(exp);
              submit(() => onSubmit({ expiry: mode === 'none' ? null : exp, addedDate }));
            }}
          >
            Save dates
          </button>
        </>
      }
    >
      <label className="field">
        <span>Date added</span>
        <input type="date" value={addedDate} max={todayLocal()} onChange={(e) => setAddedDate(e.target.value)} aria-label="Date added" />
      </label>
      <ExpiryFields
        mode={mode} setMode={setMode} expiryDate={expiryDate} setExpiryDate={setExpiryDate}
        startDate={startDate} setStartDate={setStartDate} keepDays={keepDays} setKeepDays={setKeepDays}
        noneLabel={batch.expirySource === 'ai' ? 'Keep AI suggestion' : 'No date'}
      />
      <FieldError message={error} />
    </Modal>
  );
}
