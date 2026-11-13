import { expect, type APIRequestContext, type Page } from '@playwright/test';

export async function reset(request: APIRequestContext) {
  const r = await request.post('/api/test/reset');
  expect(r.ok()).toBe(true);
}

export async function apiState(request: APIRequestContext) {
  return (await request.get('/api/state')).json();
}

export async function foodId(request: APIRequestContext, name: string): Promise<number> {
  const s = await apiState(request);
  const f = s.foods.find((x: { name: string }) => x.name === name);
  if (!f) throw new Error(`no food ${name}`);
  return f.id;
}

/** Finish onboarding through the API so a test can start on the fridge page. */
export async function onboard(request: APIRequestContext, names = ['Tomato', 'Egg', 'Potato', 'Pork', 'Rice', 'Bread']) {
  const ids = [];
  for (const n of names) ids.push(await foodId(request, n));
  const r = await request.post('/api/onboarding', { data: { foodIds: ids } });
  expect(r.ok()).toBe(true);
}

export async function setUnit(request: APIRequestContext, name: string, unit: string) {
  await request.post(`/api/foods/${await foodId(request, name)}/unit`, { data: { unit } });
}

export async function addBatch(request: APIRequestContext, name: string, body: Record<string, unknown>) {
  const r = await request.post('/api/batches', { data: { foodId: await foodId(request, name), ...body } });
  expect(r.ok()).toBe(true);
  return r.json();
}

export function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function card(page: Page, name: string) {
  return page.getByTestId('food-card').filter({ has: page.locator('.card-name', { hasText: new RegExp(`^${name}!?$`) }) });
}
