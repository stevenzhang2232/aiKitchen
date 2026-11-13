import type { FastifyInstance } from 'fastify';
import type { Store } from '../store.js';

type Body = Record<string, unknown>;
type IdParams = { id: string };

export function registerFridgeRoutes(app: FastifyInstance, store: Store, extraState: () => Record<string, unknown>) {
  app.get('/api/state', async () => ({ ...store.state(), ...extraState() }));

  app.post<{ Body: Body }>('/api/onboarding', async (req) => {
    store.completeOnboarding(req.body?.foodIds);
    return { ok: true };
  });

  app.post<{ Body: Body }>('/api/foods', async (req) => ({ food: store.createFood(req.body ?? {}) }));

  app.post<{ Params: IdParams; Body: Body }>('/api/foods/:id/unit', async (req) => {
    store.setDefaultUnit(Number(req.params.id), req.body?.unit);
    return { ok: true };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/foods/:id/rename', async (req) => {
    store.renameFood(Number(req.params.id), req.body?.name);
    return { ok: true };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/foods/:id/quick-add', async (req) => store.quickAdd(Number(req.params.id), req.body?.location));

  app.post<{ Params: IdParams; Body: Body }>('/api/foods/:id/use', async (req) => {
    const plan = store.use(Number(req.params.id), req.body?.amount, req.body?.unit);
    return { ok: true, deducted: plan.deducted, shortfall: plan.shortfall };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/foods/:id/pin', async (req) => {
    store.setPinned(Number(req.params.id), req.body?.pinned === true);
    return { ok: true };
  });

  app.post<{ Body: Body }>('/api/batches', async (req) => store.addBatch(req.body ?? {}));

  app.post<{ Params: IdParams }>('/api/undo/:id', async (req) => {
    store.undo(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/batches/:id/adjust', async (req) => {
    store.adjust(Number(req.params.id), req.body?.qty, req.body?.unit);
    return { ok: true };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/batches/:id/move', async (req) => {
    store.move(Number(req.params.id), req.body?.location);
    return { ok: true };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/batches/:id/expiry', async (req) => {
    store.setExpiry(Number(req.params.id), req.body ?? {});
    return { ok: true };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/batches/:id/added-date', async (req) => {
    store.setAddedDate(Number(req.params.id), req.body?.date);
    return { ok: true };
  });

  app.delete<{ Params: IdParams }>('/api/batches/:id', async (req) => {
    store.remove(Number(req.params.id));
    return { ok: true };
  });

  app.post<{ Params: IdParams; Body: Body }>('/api/seasonings/:id', async (req) => {
    if (req.body?.hidden === true) store.hideSeasoning(Number(req.params.id));
    else store.setSeasoning(Number(req.params.id), req.body?.have === true);
    return { ok: true };
  });

  app.post('/api/seasoning-pack/apply', async () => ({ ok: true, added: store.applyPack() }));

  app.put<{ Body: Body }>('/api/seasoning-pack', async (req) => {
    store.setPack(req.body?.foodIds);
    return { ok: true };
  });

  app.put<{ Body: Body }>('/api/taste', async (req) => ({ taste: store.setTaste(req.body ?? {}) }));

  app.put<{ Body: Body }>('/api/cart', async (req) => {
    store.setCart(req.body?.items);
    return { ok: true };
  });

  app.delete('/api/cart', async () => {
    store.clearCart();
    return { ok: true };
  });

  app.post<{ Body: Body }>('/api/to-cook', async (req) => ({ id: store.addToCook(req.body ?? {}) }));

  app.delete<{ Params: IdParams }>('/api/to-cook/:id', async (req) => {
    store.deleteToCook(Number(req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: IdParams }>('/api/history/:id', async (req) => {
    store.deleteHistory(Number(req.params.id));
    return { ok: true };
  });
}
