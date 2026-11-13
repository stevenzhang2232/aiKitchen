import { useState } from 'react';
import { formatAmount, quickAddBase, type Food, type Unit } from '@kitchen/core';
import { api, ApiError } from '../api';
import { useApp } from '../appState';
import { AddDetailsForm, UnitPicker } from '../components/forms';

/**
 * Shared "add" behaviour for clicks, drags and search results:
 * asks for a unit the first time, adds one step, and shows an Undo toast.
 */
export function useAddFlow() {
  const { run, showToast, state } = useApp();
  const [unitFor, setUnitFor] = useState<Food | null>(null);
  const [detailsFor, setDetailsFor] = useState<Food | null>(null);

  const announce = (food: Food, unit: Unit, undoId: string, batchId: number, amount?: string) => {
    const ai = state?.ai?.configured;
    const what = amount ?? formatAmount(quickAddBase(unit), unit);
    showToast({
      message: `Added ${food.name} +${what}${ai ? ' · AI is estimating shelf life…' : ''}`,
      undoId,
    });
    void batchId;
  };

  const doQuickAdd = async (food: Food, unit: Unit) => {
    const r = await run(() => api.quickAdd(food.id));
    if (r) announce(food, unit, r.undoId, r.batchId);
  };

  const quickAdd = async (food: Food) => {
    if (food.isSeasoning) {
      await run(() => api.post(`/api/seasonings/${food.id}`, { have: true }));
      showToast({ message: `${food.name}: marked as have` });
      return;
    }
    if (!food.defaultUnit) {
      setUnitFor(food);
      return;
    }
    await doQuickAdd(food, food.defaultUnit);
  };

  const elements = (
    <>
      {unitFor && (
        <UnitPicker
          food={unitFor}
          onClose={() => setUnitFor(null)}
          onPick={async (unit) => {
            await api.setUnit(unitFor.id, unit);
            const r = await api.quickAdd(unitFor.id).catch((e: unknown) => {
              throw e instanceof ApiError ? e : new ApiError('Could not add.', 500);
            });
            await run(async () => undefined);
            announce(unitFor, unit, r.undoId, r.batchId);
          }}
        />
      )}
      {detailsFor && (
        <AddDetailsForm
          food={detailsFor}
          onClose={() => setDetailsFor(null)}
          onSubmit={async (body) => {
            const r = await api.addBatch(body);
            await run(async () => undefined);
            announce(detailsFor, body.unit as Unit, r.undoId, r.batchId, formatAmount(Number(body.qty) * (body.unit === 'kg' ? 1000 : 1), body.unit as Unit));
          }}
        />
      )}
    </>
  );

  return { quickAdd, addWithDetails: setDetailsFor, elements };
}
