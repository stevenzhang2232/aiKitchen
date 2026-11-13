import { test, expect } from '@playwright/test';
import { addBatch, apiState, card, foodId, isoDate, onboard, reset, setUnit } from './helpers';

test.beforeEach(async ({ request }) => {
  await reset(request);
});

test('first-run onboarding needs 6–8 picks and fills favorites only (acceptance 7)', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to your virtual fridge' })).toBeVisible();
  const start = page.getByRole('button', { name: 'Start using my fridge' });
  for (const n of ['Tomato', 'Potato', 'Egg', 'Rice', 'Bread']) await page.getByRole('button', { name: n, exact: true }).click();
  await expect(start).toBeDisabled();
  await page.getByLabel('Search more ingredients').fill('西红柿');
  await expect(page.getByRole('button', { name: 'Tomato', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Search more ingredients').fill('scallion');
  await page.getByRole('button', { name: 'Scallion', exact: true }).click();
  await expect(page.getByText('6 of 6–8 picked')).toBeVisible();
  await start.click();
  await expect(page.getByText('Your fridge is empty')).toBeVisible();
  const s = await apiState(request);
  expect(s.onboarded).toBe(true);
  expect(s.batches).toEqual([]);
  expect(s.favorites).toHaveLength(6);
  expect(s.seasonings.filter((x: { have: boolean }) => x.have)).toHaveLength(6);
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  await expect(page.getByTestId('fav-item')).toHaveCount(6);
});

test('search by Chinese name, pick a unit on first add, then one click = one step (acceptance 8, 9)', async ({ page, request }) => {
  await onboard(request);
  await page.goto('/');
  const search = page.getByLabel('Search ingredients or seasonings');
  for (const q of ['番茄', '西红柿', 'tomato']) {
    await search.fill(q);
    await expect(page.getByRole('listitem').first()).toContainText('Tomato');
  }
  await page.getByRole('button', { name: 'Add Tomato', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'How do you measure Tomato?' })).toBeVisible();
  await page.getByRole('button', { name: 'Use pcs' }).click();
  await expect(page.getByTestId('toast')).toContainText('Added Tomato +1 pc');
  await page.getByRole('button', { name: 'Add Tomato', exact: true }).click();
  await expect(card(page, 'Tomato')).toContainText('2 pcs');

  await search.fill('pork');
  await page.getByRole('button', { name: 'Add Pork', exact: true }).click();
  await page.getByRole('radio', { name: /^g Grams/ }).check();
  await page.getByRole('button', { name: 'Use g' }).click();
  await expect(card(page, 'Pork')).toContainText('100 g');

  await search.fill('salt');
  await expect(page.getByRole('listitem').first()).toContainText('Salt');
  await expect(page.getByRole('listitem').first()).toContainText('Seasoning');
});

test('undo removes what was just added (acceptance 10)', async ({ page, request }) => {
  await onboard(request);
  await setUnit(request, 'Egg', 'pcs');
  await page.goto('/');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  await page.getByRole('button', { name: 'Add one Egg' }).click();
  await expect(card(page, 'Egg')).toContainText('1 pc');
  await page.getByRole('button', { name: 'Add one Egg' }).click();
  await expect(card(page, 'Egg')).toContainText('2 pcs');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Egg')).toContainText('1 pc');
  const s = await apiState(request);
  expect(s.batches).toHaveLength(1);
  expect(s.batches[0].qty).toBe(1);
});

test('drag a favorite into the fridge adds it', async ({ page, request }) => {
  await onboard(request);
  await setUnit(request, 'Potato', 'pcs');
  await page.goto('/');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  const source = page.getByRole('button', { name: 'Add one Potato' });
  const target = page.getByTestId('fridge-drop');
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  await page.mouse.move(s!.x + s!.width / 2, s!.y + s!.height / 2);
  await page.mouse.down();
  await page.mouse.move(s!.x - 40, s!.y + 10, { steps: 5 });
  await page.mouse.move(t!.x + t!.width / 2, t!.y + Math.min(t!.height / 2, 60), { steps: 10 });
  await page.mouse.up();
  await expect(card(page, 'Potato')).toContainText('1 pc');
});

test('+ button opens favorites and turns into a camera', async ({ page, request }) => {
  await onboard(request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  await expect(page.getByRole('complementary', { name: 'Favorites' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(page.getByRole('dialog', { name: 'Scan a receipt' })).toBeVisible();
});

test('batches merge on one card, soonest first; restock keeps old dates (acceptance 11, 12)', async ({ page, request }) => {
  await onboard(request);
  await addBatch(request, 'Tomato', { qty: 2, unit: 'pcs', expiryDate: isoDate(6) });
  await addBatch(request, 'Tomato', { qty: 1, unit: 'pcs', expiryDate: isoDate(3) });
  await addBatch(request, 'Potato', { qty: 500, unit: 'g' });
  await addBatch(request, 'Potato', { qty: 1, unit: 'kg' });
  await page.goto('/');
  await expect(card(page, 'Tomato')).toContainText('3 pcs · 2 batches');
  await expect(card(page, 'Potato')).toContainText('1.5 kg');
  await card(page, 'Tomato').click();
  const rows = page.getByTestId('batch-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('1 pc');
  await expect(rows.nth(1)).toContainText('2 pcs');

  await page.getByRole('button', { name: 'Restock', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Restock Tomato' });
  await dlg.getByLabel('Amount').fill('4');
  await dlg.getByText('Use-by date').click();
  await dlg.getByLabel('Use by').fill(isoDate(10));
  await dlg.getByRole('button', { name: 'Add to fridge' }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('4 pcs');
  const s = await apiState(request);
  const dates = s.batches.filter((b: { unit: string }) => b.unit === 'pcs').map((b: { expiryDate: string }) => b.expiryDate);
  expect(dates).toEqual([isoDate(6), isoDate(3), isoDate(10)]);
});

test('adjust, move, use and remove through their forms (acceptance 13)', async ({ page, request }) => {
  await onboard(request);
  await addBatch(request, 'Egg', { qty: 2, unit: 'pcs', expiryDate: isoDate(3) });
  await addBatch(request, 'Egg', { qty: 4, unit: 'pcs', expiryDate: isoDate(9) });
  await page.goto('/');
  await card(page, 'Egg').click();

  await page.getByRole('button', { name: 'Use', exact: true }).click();
  let dlg = page.getByRole('dialog', { name: 'Use Egg' });
  await dlg.getByLabel('Amount used').fill('3');
  await dlg.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(card(page, 'Egg')).toContainText('3 pcs');
  await expect(page.getByTestId('batch-row')).toHaveCount(1);

  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  dlg = page.getByRole('dialog', { name: 'Adjust Egg' });
  await dlg.getByLabel('New amount').fill('5');
  await dlg.getByRole('button', { name: 'Save amount' }).click();
  await expect(card(page, 'Egg')).toContainText('5 pcs');

  await page.getByRole('button', { name: 'Move', exact: true }).click();
  dlg = page.getByRole('dialog', { name: 'Move Egg' });
  await dlg.getByLabel('Move to').selectOption('freezer');
  await dlg.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByTestId('batch-row')).toContainText('Freezer');
  await page.getByLabel('Storage location').selectOption('pantry');
  await expect(card(page, 'Egg')).toHaveCount(0);
  await page.getByLabel('Storage location').selectOption('freezer');
  await card(page, 'Egg').click();

  await page.getByRole('button', { name: 'Use', exact: true }).click();
  dlg = page.getByRole('dialog', { name: 'Use Egg' });
  await dlg.getByLabel('Amount used').fill('99');
  await dlg.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByTestId('toast')).toContainText('now used up');
  await expect(card(page, 'Egg')).toHaveCount(0);
  expect((await apiState(request)).batches).toEqual([]);

  await addBatch(request, 'Rice', { qty: 2, unit: 'kg' });
  await page.reload();
  await card(page, 'Rice').click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog', { name: 'Remove Rice' }).getByRole('button', { name: 'Remove' }).click();
  await expect(card(page, 'Rice')).toHaveCount(0);
});

test('expiring and expired items are flagged and counted (acceptance 14, 15)', async ({ page, request }) => {
  await onboard(request);
  const { batchId } = await addBatch(request, 'Pork', { qty: 300, unit: 'g', expiryDate: isoDate(1) });
  await addBatch(request, 'Bread', { qty: 1, unit: 'serving', expiryDate: isoDate(-1) });
  await addBatch(request, 'Egg', { qty: 6, unit: 'pcs', expiryDate: isoDate(20) });
  await request.post(`/api/batches/${batchId}/added-date`, { data: { date: isoDate(-3) } });
  await page.goto('/');
  await expect(card(page, 'Pork')).toContainText('Eat first · 1 day left');
  await expect(card(page, 'Pork').locator('.alert-mark')).toBeVisible();
  await expect(card(page, 'Pork')).toContainText('In fridge 3 days');
  await expect(card(page, 'Bread')).toContainText('Expired 1 day ago');
  await expect(card(page, 'Egg')).toContainText('Just added');
  await expect(card(page, 'Egg').locator('.alert-mark')).toHaveCount(0);
  const cards = page.getByTestId('food-card');
  await expect(cards.nth(0)).toContainText('Bread');
  await expect(cards.nth(1)).toContainText('Pork');
  await expect(cards.nth(2)).toContainText('Egg');
  await page.getByRole('button', { name: '2 items to eat first' }).click();
  await expect(cards).toHaveCount(2);
  expect((await apiState(request)).batches.length).toBe(3);
});

test('user dates take priority and can be edited', async ({ page, request }) => {
  await onboard(request);
  await addBatch(request, 'Egg', { qty: 6, unit: 'pcs' });
  await page.goto('/');
  await expect(card(page, 'Egg')).toContainText('No suggestion available');
  await card(page, 'Egg').click();
  await page.getByRole('button', { name: 'Dates' }).click();
  const dlg = page.getByRole('dialog', { name: 'Dates for Egg' });
  await dlg.getByText('Start date + days').click();
  await dlg.getByLabel('Keeps for (days)').fill('2');
  await dlg.getByRole('button', { name: 'Save dates' }).click();
  await expect(card(page, 'Egg')).toContainText('Eat first · 2 days left');
});

test('seasoning row toggles have / don’t have and adds the pack (acceptance 18)', async ({ page, request }) => {
  await onboard(request);
  const ids = await Promise.all(['Oil', 'Salt', 'Chili oil'].map((n) => foodId(request, n)));
  await request.put('/api/seasoning-pack', { data: { foodIds: ids } });
  await page.goto('/');
  await page.getByRole('button', { name: '+ Add seasoning pack' }).click();
  const row = page.getByRole('region', { name: 'Seasonings' });
  await expect(row.getByRole('button', { name: '✓ Chili oil' })).toBeVisible();
  await row.getByRole('button', { name: '✓ Salt' }).click();
  await expect(row.getByRole('button', { name: 'Salt', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const s = await apiState(request);
  const have = s.seasonings.filter((x: { have: boolean }) => x.have).map((x: { foodId: number }) => x.foodId);
  expect(have.sort()).toEqual([ids[0], ids[2]].sort());
});

test('custom ingredient from search', async ({ page, request }) => {
  await onboard(request);
  await page.goto('/');
  await page.getByLabel('Search ingredients or seasonings').fill('dragon fruit');
  await page.getByLabel('Category for new ingredient').selectOption('fruit');
  await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
  await page.getByRole('button', { name: 'Use pcs' }).click();
  await expect(card(page, 'Dragon fruit')).toContainText('1 pc');
});

test('data survives a new browser profile (acceptance 1, 3)', async ({ browser, request }) => {
  await onboard(request);
  await addBatch(request, 'Tomato', { qty: 3, unit: 'pcs' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(card(page, 'Tomato')).toContainText('3 pcs');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await ctx.clearCookies();
  await page.reload();
  await expect(card(page, 'Tomato')).toContainText('3 pcs');
  await ctx.close();
});

test('half-width window has no horizontal scrolling (acceptance 30)', async ({ page, request }) => {
  await onboard(request);
  for (const n of ['Tomato', 'Egg', 'Potato', 'Pork', 'Rice', 'Bread']) await addBatch(request, n, { qty: 1, unit: 'pcs' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  const columns = async () =>
    page.getByTestId('card-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const wide = await columns();
  await page.setViewportSize({ width: 640, height: 860 });
  await expect.poll(columns).toBeLessThan(wide);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await card(page, 'Tomato').click();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
});
