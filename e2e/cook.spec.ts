import { test, expect, type Page } from '@playwright/test';
import { addBatch, apiState, card, isoDate, onboard, reset } from './helpers';

test.beforeEach(async ({ request }) => {
  await reset(request);
  await onboard(request);
  await request.post('/api/seasoning-pack/apply');
  await request.post('/api/test/ai', { data: { mode: 'mock' } });
  await addBatch(request, 'Tomato', { qty: 3, unit: 'pcs', expiryDate: isoDate(8) });
  await addBatch(request, 'Egg', { qty: 2, unit: 'pcs', expiryDate: isoDate(1) });
  await addBatch(request, 'Egg', { qty: 4, unit: 'pcs', expiryDate: isoDate(20) });
  await addBatch(request, 'Pork', { qty: 300, unit: 'g', expiryDate: isoDate(2) });
  await addBatch(request, 'Scallion', { qty: 3, unit: 'pcs', expiryDate: isoDate(6) });
});

async function setTasteFirstTime(page: Page) {
  const dlg = page.getByRole('dialog', { name: 'How many people are eating?' });
  await expect(dlg).toContainText('First time here');
  await dlg.getByLabel('Spice level').selectOption('mild');
  await dlg.getByLabel('Foods to avoid').fill('cilantro');
  await dlg.getByLabel('Favorite cuisines').fill('Home-style');
  return dlg;
}

test('Suggest for me: taste asked once, 1–3 dishes with time, recipe, then I cooked it (acceptance 19, 23, 24)', async ({ page, request }) => {
  await page.goto('/#/cook');
  await page.getByRole('button', { name: 'Suggest dishes' }).click();
  const dlg = await setTasteFirstTime(page);
  await dlg.getByRole('button', { name: 'More people' }).click();
  await expect(dlg.getByLabel('People eating')).toHaveValue('3');
  await dlg.getByRole('button', { name: 'Get dishes' }).click();

  const dishes = page.locator('.dish-card');
  await expect(dishes.first()).toBeVisible();
  const count = await dishes.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  for (let i = 0; i < count; i++) await expect(dishes.nth(i)).toContainText(/About \d+ min/);
  // Expiring eggs and pork are used first.
  await expect(dishes.first()).toContainText('Egg');
  await expect(dishes.first()).toContainText('Pork');
  expect((await apiState(request)).taste).toEqual({ spice: 'mild', avoid: ['cilantro'], cuisines: ['Home-style'] });

  await dishes.first().click();
  const recipe = page.getByRole('article');
  await expect(recipe.getByRole('heading', { name: 'Steps' })).toBeVisible();
  await expect(recipe).toContainText('3 people');
  await expect(recipe).toContainText("Pork: half of what's left (150 g)");
  expect(await recipe.textContent()).not.toContain("(half of what's left (");

  // Leaving without confirming changes nothing.
  await page.getByRole('button', { name: 'Fridge' }).click();
  await expect(card(page, 'Egg')).toContainText('6 pcs');
  await page.getByRole('button', { name: 'AI cook' }).click();

  // Second time: no taste questions, but a way to edit taste.
  await page.getByRole('button', { name: 'Suggest dishes' }).click();
  const dlg2 = page.getByRole('dialog', { name: 'How many people are eating?' });
  await expect(dlg2).not.toContainText('First time here');
  await expect(dlg2).toContainText('Taste: Mild · avoid cilantro · Home-style');
  await expect(dlg2.getByRole('button', { name: 'Edit' })).toBeVisible();
  await dlg2.getByRole('button', { name: 'Get dishes' }).click();
  await dishes.first().click();
  await page.getByRole('button', { name: 'I cooked it' }).click();
  const confirm = page.getByRole('dialog', { name: 'Did you cook it?' });
  await expect(confirm.getByLabel('Amount of Egg used')).toHaveValue('3');
  await confirm.getByLabel('Amount of Egg used').fill('2');
  await confirm.getByRole('button', { name: 'Yes, update my fridge' }).click();
  await expect(page.getByTestId('toast')).toContainText('Fridge updated');

  const s = await apiState(request);
  const eggs = s.batches.filter((b: { foodId: number }) => b.foodId === s.foods.find((f: { name: string }) => f.name === 'Egg').id);
  expect(eggs.map((b: { qty: number; expiryDate: string }) => [b.qty, b.expiryDate])).toEqual([[4, isoDate(20)]]);
  expect(s.history).toHaveLength(1);
  expect(s.history[0]).toMatchObject({ mode: 'suggest', servings: 2 });
  expect(Date.now() - Date.parse(s.history[0].cookedAt)).toBeLessThan(60_000);
});

test('I want a dish with missing items: Buy first saves to To cook (acceptance 21)', async ({ page, request }) => {
  await request.put('/api/taste', { data: { spice: 'medium', avoid: [], cuisines: [] } });
  await page.goto('/#/cook');
  await page.getByLabel('Dish name').fill('Kung pao chicken with peanuts and scallion');
  await page.getByRole('button', { name: 'Check my fridge' }).click();
  await page.getByRole('dialog', { name: 'How many people are eating?' }).getByRole('button', { name: 'Get dishes' }).click();
  const box = page.getByRole('region', { name: 'Missing ingredients' });
  await expect(box).toContainText('missing 2 items');
  await expect(box).toContainText('Chicken — about 300 g');
  await expect(box).toContainText('Peanuts — about 50 g');
  await box.getByRole('button', { name: 'Buy first' }).click();
  await expect(page.getByTestId('toast')).toContainText('Saved “Kung pao chicken with peanuts and scallion” to To cook');
  const s = await apiState(request);
  expect(s.toCook).toHaveLength(1);
  expect(s.toCook[0]).toMatchObject({ servings: 2, taste: { spice: 'medium' } });
  expect(s.toCook[0].missing.map((m: { name: string }) => m.name)).toEqual(['Chicken', 'Peanuts']);
});

test('I want a dish: Cook anyway marks missing items and only takes what is in stock (acceptance 21)', async ({ page, request }) => {
  await request.put('/api/taste', { data: { spice: 'mild', avoid: [], cuisines: [] } });
  await page.goto('/#/cook');
  await page.getByLabel('Dish name').fill('Scallion beef');
  await page.getByRole('button', { name: 'Check my fridge' }).click();
  await page.getByRole('dialog', { name: 'How many people are eating?' }).getByRole('button', { name: 'Get dishes' }).click();
  await page.getByRole('button', { name: 'Cook anyway' }).click();
  const recipe = page.getByRole('article');
  await expect(recipe).toContainText('Beef: about 300 g — missing, not in your fridge');
  await expect(recipe).toContainText('(missing)');
  await page.getByRole('button', { name: 'I cooked it' }).click();
  const confirm = page.getByRole('dialog', { name: 'Did you cook it?' });
  await confirm.getByLabel('Amount of Scallion used').fill('99');
  await confirm.getByRole('button', { name: 'Yes, update my fridge' }).click();
  await expect(page.getByTestId('toast')).toContainText('Fridge updated');
  const s = await apiState(request);
  const scallion = s.foods.find((f: { name: string }) => f.name === 'Scallion').id;
  expect(s.batches.filter((b: { foodId: number }) => b.foodId === scallion)).toEqual([]);
  expect(s.batches.every((b: { qty: number }) => b.qty >= 0)).toBe(true);
  expect(s.history[0]).toMatchObject({ dishName: 'Scallion beef', mode: 'dish', missing: [{ name: 'Beef' }] });
});

test('Pick ingredients: held amounts, saved cart, estimate, back keeps the cart, cooked clears it (acceptance 22, 23)', async ({ page, request }) => {
  await page.goto('/#/cook');
  await page.getByRole('button', { name: /^Pick ingredients/ }).click();
  const tomato = page.getByTestId('pick-row').filter({ hasText: 'Tomato' });
  await expect(tomato).toContainText('3 pcs left');
  await page.getByRole('button', { name: 'More Tomato' }).click();
  await page.getByRole('button', { name: 'More Tomato' }).click();
  await expect(tomato).toContainText('1 pc left');
  await page.getByRole('button', { name: 'More Egg' }).click();
  await page.getByRole('button', { name: 'More Egg' }).click();
  await page.getByRole('button', { name: 'More Egg' }).click();
  await page.getByRole('button', { name: 'Less Egg' }).click();
  await page.getByRole('button', { name: 'More Pork' }).click();
  const cart = page.getByRole('complementary', { name: 'Cart' });
  await expect(cart).toContainText('Cart (3)');
  await expect(cart).toContainText('Tomato 2 pcs');
  await expect(cart).toContainText('Egg 2 pcs');
  await expect(cart).toContainText('Pork 100 g');
  await expect(cart).toContainText('Enough for about 1 person');

  // Fridge page still shows the full amount.
  await page.getByRole('button', { name: 'Fridge' }).click();
  await expect(card(page, 'Tomato')).toContainText('3 pcs');
  // The cart survives a reload.
  await page.reload();
  await page.getByRole('button', { name: 'AI cook' }).click();
  await page.getByRole('button', { name: /^Pick ingredients \(3 in cart\)/ }).click();
  await cart.getByRole('button', { name: 'Remove Pork from cart' }).click();
  await expect(cart).toContainText('Cart (2)');

  await cart.getByRole('button', { name: 'Cook these' }).click();
  let dlg = page.getByRole('dialog', { name: 'How many people are eating?' });
  await expect(dlg).toContainText('Estimated from your picks: 1');
  await expect(dlg.getByLabel('People eating')).toHaveValue('1');
  await dlg.getByRole('button', { name: 'Back to picking' }).click();
  await expect(cart).toContainText('Cart (2)');

  await cart.getByRole('button', { name: 'Cook these' }).click();
  dlg = page.getByRole('dialog', { name: 'How many people are eating?' });
  await dlg.getByRole('button', { name: 'Confirm' }).click();
  await page.locator('.dish-card').first().click();
  await page.getByRole('button', { name: 'I cooked it' }).click();
  await page.getByRole('dialog', { name: 'Did you cook it?' }).getByRole('button', { name: 'Yes, update my fridge' }).click();
  await expect(page.getByTestId('toast')).toContainText('Fridge updated');
  const s = await apiState(request);
  expect(s.cart).toEqual([]);
  expect(s.history[0].mode).toBe('pick');
  const tomatoLeft = s.batches.filter((b: { foodId: number }) => b.foodId === s.foods.find((f: { name: string }) => f.name === 'Tomato').id);
  expect(tomatoLeft[0].qty).toBe(1);
});

test('Clear all empties the cart', async ({ page }) => {
  await page.goto('/#/cook');
  await page.getByRole('button', { name: /^Pick ingredients/ }).click();
  await page.getByRole('button', { name: 'More Tomato' }).click();
  await page.getByRole('button', { name: 'More Egg' }).click();
  const cart = page.getByRole('complementary', { name: 'Cart' });
  await expect(cart).toContainText('Cart (2)');
  await cart.getByRole('button', { name: 'Clear all' }).click();
  await expect(cart).toContainText('Cart (0)');
});

test('when the AI is unreachable, AI cook explains and the fridge still works (acceptance 6)', async ({ page, request }) => {
  await request.put('/api/taste', { data: { spice: 'mild', avoid: [], cuisines: [] } });
  await request.post('/api/test/ai', { data: { mode: 'offline' } });
  await page.goto('/#/cook');
  await page.getByRole('button', { name: 'Suggest dishes' }).click();
  await page.getByRole('dialog', { name: 'How many people are eating?' }).getByRole('button', { name: 'Get dishes' }).click();
  await expect(page.getByRole('alert')).toContainText('Couldn’t reach the AI service');
  await expect(page.getByRole('alert')).toContainText('Your fridge is not affected');
  await page.getByRole('button', { name: 'Fridge' }).click();
  await expect(card(page, 'Egg')).toContainText('6 pcs');
  await request.post('/api/test/ai', { data: { mode: 'off' } });
  await page.getByRole('button', { name: 'AI cook' }).click();
  await page.getByRole('button', { name: 'Suggest dishes' }).click();
  await page.getByRole('dialog', { name: 'How many people are eating?' }).getByRole('button', { name: 'Get dishes' }).click();
  await expect(page.getByRole('alert')).toContainText('Set up an AI model');
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByRole('region', { name: 'AI model' })).toBeVisible();
});
