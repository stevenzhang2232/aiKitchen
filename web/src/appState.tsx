import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildFoodCards, countAlerts, type Food } from '@kitchen/core';
import { api, ApiError, type AppState } from './api';

export interface Toast {
  id: number;
  message: string;
  undoId?: string;
  tone?: 'info' | 'error';
}

interface Ctx {
  state: AppState | null;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Run an action, then refresh. Errors are shown as a toast; returns undefined on failure. */
  run: <T>(fn: () => Promise<T>, opts?: { silent?: boolean }) => Promise<T | undefined>;
  toast: Toast | null;
  showToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: () => void;
  foodById: Map<number, Food>;
  alertCount: number;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      setState(s);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const showToast = useCallback((t: Omit<Toast, 'id'>) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++toastSeq.current;
    setToast({ ...t, id });
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), t.undoId ? 8000 : 5000);
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { silent?: boolean } = {}) => {
      try {
        const result = await fn();
        await refresh();
        return result;
      } catch (e) {
        if (!opts.silent) showToast({ message: e instanceof ApiError ? e.message : 'Something went wrong. Try again.', tone: 'error' });
        await refresh();
        if (opts.silent) throw e;
        return undefined;
      }
    },
    [refresh, showToast],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While shelf-life lookups are running, poll for their results.
  const pending = state?.batches.some((b) => b.aiStatus === 'pending') ?? false;
  useEffect(() => {
    if (!pending) return;
    const h = setInterval(refresh, 2500);
    return () => clearInterval(h);
  }, [pending, refresh]);

  const foodById = useMemo(() => new Map((state?.foods ?? []).map((f) => [f.id, f])), [state?.foods]);
  const alertCount = useMemo(
    () => (state ? countAlerts(buildFoodCards(state.foods, state.batches, state.today)) : 0),
    [state],
  );

  const value: Ctx = { state, loadError, refresh, run, toast, showToast, dismissToast, foodById, alertCount };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}

/** Non-null state for components rendered after loading. */
export function useAppState(): AppState {
  const { state } = useApp();
  if (!state) throw new Error('state not loaded');
  return state;
}
