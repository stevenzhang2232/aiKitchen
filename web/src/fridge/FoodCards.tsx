import { Fragment, useState } from 'react';
import {
  daysLeftLabel, expiryInfo, formatAmount, formatKindAmounts, shortDate, storedLabel,
  type Batch, type FoodCard, type Unit,
} from '@kitchen/core';
import { api } from '../api';
import { useApp, useAppState } from '../appState';
import { FoodImage } from '../components/FoodImage';
import { Modal } from '../components/Modal';
import { AddDetailsForm, AdjustForm, DatesForm, LOCATION_LABEL, MoveForm, RemoveForm, UseForm } from '../components/forms';

export function expiryText(card: FoodCard): { text: string; tone: 'ok' | 'soon' | 'expired' | 'muted' } {
  const first = card.batches[0];
  const left = daysLeftLabel(card.expiry);
  if (card.expiry.state === 'expired') return { text: left!, tone: 'expired' };
  if (card.expiry.state === 'soon') return { text: `Eat first · ${left}`, tone: 'soon' };
  if (card.expiry.state === 'ok') {
    if (first.expirySource === 'ai') return { text: `AI suggestion: use by ${shortDate(first.expiryDate!)}`, tone: 'ok' };
    return { text: `Use by ${shortDate(first.expiryDate!)} · ${left}`, tone: 'ok' };
  }
  if (card.pendingAi) return { text: 'Checking shelf life…', tone: 'muted' };
  return { text: 'No suggestion available', tone: 'muted' };
}

function batchExpiry(b: Batch, today: string) {
  if (b.expiryDate) {
    const info = expiryInfo(b.expiryDate, today);
    const prefix = b.expirySource === 'ai' ? 'AI suggestion: use by' : 'Use by';
    return { text: `${prefix} ${shortDate(b.expiryDate)} · ${daysLeftLabel(info)}`, tone: info.state };
  }
  if (b.aiStatus === 'pending') return { text: 'Checking shelf life…', tone: 'unknown' as const };
  return { text: 'No suggestion available', tone: 'unknown' as const };
}

type Action = { kind: 'restock' | 'adjust' | 'move' | 'use' | 'remove' | 'dates' | 'source'; batchId?: number };

function BatchPanel({ card }: { card: FoodCard }) {
  const { run, showToast } = useApp();
  const state = useAppState();
  const [action, setAction] = useState<Action | null>(null);
  const close = () => setAction(null);
  const food = card.food;
  const sourceBatch = action?.batchId ? card.batches.find((b) => b.id === action.batchId) : undefined;
  return (
    <div className="batch-panel" aria-label={`${food.name} batches`}>
      <div className="batch-head">
        <strong>{food.name}</strong>
        <span className="muted small">Soonest to expire first</span>
      </div>
      <ul className="batch-list">
        {card.batches.map((b) => {
          const exp = batchExpiry(b, state.today);
          return (
            <li key={b.id} className="batch-row" data-testid="batch-row">
              <span className="batch-qty">{formatAmount(b.qty, b.unit)}</span>
              <span>{LOCATION_LABEL[b.location]}</span>
              <span className={`tone-${exp.tone}`}>{exp.text}</span>
              <span className="muted small">{storedLabel(b.addedDate, state.today)}</span>
              <span className="batch-actions">
                {b.expirySource === 'ai' && (
                  <button className="link" onClick={() => setAction({ kind: 'source', batchId: b.id })}>Sources</button>
                )}
                {!b.expiryDate && b.aiStatus !== 'pending' && state.ai?.configured && (
                  <button className="link" onClick={() => run(() => api.post(`/api/batches/${b.id}/shelf-life`))}>Ask AI again</button>
                )}
                <button className="link" onClick={() => setAction({ kind: 'dates', batchId: b.id })}>Dates</button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="batch-buttons">
        <button onClick={() => setAction({ kind: 'restock' })}>Restock</button>
        <button onClick={() => setAction({ kind: 'adjust' })}>Adjust</button>
        <button onClick={() => setAction({ kind: 'move' })}>Move</button>
        <button onClick={() => setAction({ kind: 'use' })}>Use</button>
        <button onClick={() => setAction({ kind: 'remove' })}>Remove</button>
      </div>

      {action?.kind === 'restock' && (
        <AddDetailsForm
          food={food}
          title={`Restock ${food.name}`}
          onClose={close}
          onSubmit={async (body) => {
            const r = await api.addBatch(body);
            await run(async () => undefined);
            showToast({ message: `Restocked ${food.name}`, undoId: r.undoId });
          }}
        />
      )}
      {action?.kind === 'adjust' && (
        <AdjustForm
          food={food}
          batches={card.batches}
          onClose={close}
          onSubmit={async (id, qty, unit: Unit) => {
            await api.post(`/api/batches/${id}/adjust`, { qty, unit });
            await run(async () => undefined);
          }}
        />
      )}
      {action?.kind === 'move' && (
        <MoveForm
          food={food}
          batches={card.batches}
          onClose={close}
          onSubmit={async (id, location) => {
            await api.post(`/api/batches/${id}/move`, { location });
            await run(async () => undefined);
          }}
        />
      )}
      {action?.kind === 'use' && (
        <UseForm
          food={food}
          batches={card.batches}
          onClose={close}
          onSubmit={async (amount, unit) => {
            const r = await api.post<{ deducted: number; shortfall: number }>(`/api/foods/${food.id}/use`, { amount, unit });
            await run(async () => undefined);
            if (r.shortfall > 0) showToast({ message: `Only part was in stock, so ${food.name} is now used up.` });
          }}
        />
      )}
      {action?.kind === 'remove' && (
        <RemoveForm
          food={food}
          batches={card.batches}
          onClose={close}
          onSubmit={async (ids) => {
            for (const id of ids) await api.del(`/api/batches/${id}`);
            await run(async () => undefined);
          }}
        />
      )}
      {action?.kind === 'dates' && sourceBatch && (
        <DatesForm
          food={food}
          batch={sourceBatch}
          onClose={close}
          onSubmit={async ({ expiry, addedDate }) => {
            if (addedDate !== sourceBatch.addedDate) await api.post(`/api/batches/${sourceBatch.id}/added-date`, { date: addedDate });
            if (expiry) await api.post(`/api/batches/${sourceBatch.id}/expiry`, expiry);
            else if (sourceBatch.expirySource === 'user') await api.post(`/api/batches/${sourceBatch.id}/expiry`, { clear: true });
            await run(async () => undefined);
          }}
        />
      )}
      {action?.kind === 'source' && sourceBatch && (
        <Modal title={`Shelf life of ${food.name}`} onClose={close}>
          <p>
            AI suggestion: use by <strong>{shortDate(sourceBatch.expiryDate!)}</strong> ({LOCATION_LABEL[sourceBatch.location].toLowerCase()}).
          </p>
          {sourceBatch.aiNote && <p className="muted">{sourceBatch.aiNote}</p>}
          {sourceBatch.aiSources.length ? (
            <ul className="source-list">
              {sourceBatch.aiSources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No source links were returned for this suggestion.</p>
          )}
          <p className="muted small">This is a cautious estimate. Use “Dates” to set your own date; yours always takes priority.</p>
        </Modal>
      )}
    </div>
  );
}

export function FoodCards({ cards }: { cards: FoodCard[] }) {
  const state = useAppState();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card-grid" data-testid="card-grid">
      {cards.map((card) => {
        const exp = expiryText(card);
        const alert = card.expiry.state === 'soon' || card.expiry.state === 'expired';
        const isOpen = open === card.food.id;
        return (
          <Fragment key={card.food.id}>
            <button
              className={`food-card state-${card.expiry.state}${isOpen ? ' open' : ''}`}
              data-testid="food-card"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : card.food.id)}
            >
              <FoodImage food={card.food} />
              <span className="card-name">
                {card.food.name}
                {alert && (
                  <span className="alert-mark" aria-label="Needs attention" title="Needs attention">!</span>
                )}
              </span>
              <span className="card-qty">
                {formatKindAmounts(card.totals, card.batches.find((b) => b.unit === 'kg') ? 'kg' : 'g')}
                {card.batches.length > 1 && <span className="muted"> · {card.batches.length} batches</span>}
              </span>
              <span className={`card-exp tone-${exp.tone}`}>{exp.text}</span>
              <span className="card-stored muted">{storedLabel(card.oldestAdded, state.today)}</span>
            </button>
            {isOpen && <BatchPanel card={card} />}
          </Fragment>
        );
      })}
    </div>
  );
}
