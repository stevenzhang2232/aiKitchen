import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { addBatch, apiState, card, foodId, isoDate, onboard, reset } from './helpers';

test.beforeEach(async ({ request }) => {
  await reset(request);
  await onboard(request);
});

test('edit the seasoning pack in Settings, then add it on the Fridge page (acceptance 18)', async ({ page, request }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Seasoning pack' }).click();
  const sec = page.getByRole('region', { name: 'Seasoning pack' });
  for (const n of ['Sugar', 'Light soy sauce', 'Dark soy sauce', 'Vinegar']) await sec.getByRole('checkbox', { name: n, exact: true }).uncheck();
  await sec.getByRole('checkbox', { name: 'Chili oil', exact: true }).check();
  await sec.getByLabel('New seasoning name').fill('Chili crisp');
  await sec.getByRole('button', { name: 'Add to list' }).click();
  await expect(sec.getByRole('checkbox', { name: 'Chili crisp', exact: true })).toBeChecked();
  await sec.getByRole('button', { name: 'Rename Chili crisp' }).click();
  await page.getByRole('dialog', { name: 'Rename seasoning' }).getByLabel('Seasoning name').fill('Lao Gan Ma');
  await page.getByRole('dialog', { name: 'Rename seasoning' }).getByRole('button', { name: 'Save name' }).click();
  await expect(sec.getByRole('checkbox', { name: 'Lao Gan Ma', exact: true })).toBeChecked();
  await sec.getByRole('button', { name: 'Save pack' }).click();
  await expect(page.getByTestId('toast')).toContainText('Seasoning pack saved');

  await page.getByRole('button', { name: 'Fridge' }).click();
  await page.getByRole('button', { name: '+ Add seasoning pack' }).click();
  const row = page.getByRole('region', { name: 'Seasonings' });
  for (const n of ['Oil', 'Salt', 'Chili oil', 'Lao Gan Ma']) await expect(row.getByRole('button', { name: `✓ ${n}` })).toBeVisible();
  await expect(row.getByRole('button', { name: /Sugar/ })).toHaveCount(0);
  const s = await apiState(request);
  expect(s.seasonings.filter((x: { have: boolean }) => x.have)).toHaveLength(4);
});

test('taste preferences can be edited in Settings', async ({ page, request }) => {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Taste preferences' }).click();
  const sec = page.getByRole('region', { name: 'Taste preferences' });
  await sec.getByLabel('Spice level').selectOption('hot');
  await sec.getByLabel('Foods to avoid').fill('peanuts, shellfish');
  await sec.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast')).toContainText('saved');
  expect((await apiState(request)).taste).toEqual({ spice: 'hot', avoid: ['peanuts', 'shellfish'], cuisines: [] });
});

test('To cook: Continue rechecks the fridge; once bought, cook it and it leaves the list (acceptance 25)', async ({ page, request }) => {
  await request.post('/api/test/ai', { data: { mode: 'mock' } });
  await request.post('/api/seasoning-pack/apply');
  await request.put('/api/taste', { data: { spice: 'mild', avoid: [], cuisines: [] } });
  await addBatch(request, 'Scallion', { qty: 3, unit: 'pcs', expiryDate: isoDate(5) });
  await request.post('/api/to-cook', { data: { dishName: 'Kung pao chicken with peanuts and scallion', servings: 3, missing: [{ name: 'Chicken' }, { name: 'Peanuts' }] } });

  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'To cook (1)' }).click();
  const row = page.getByTestId('to-cook-row');
  await expect(row).toContainText('Missing: Chicken, Peanuts');
  await row.getByRole('button', { name: 'Continue' }).click();
  let dlg = page.getByRole('dialog', { name: 'How many people are eating?' });
  await expect(dlg.getByLabel('People eating')).toHaveValue('3');
  await dlg.getByRole('button', { name: 'Get dishes' }).click();
  // Still missing: both choices are offered again.
  const box = page.getByRole('region', { name: 'Missing ingredients' });
  await expect(box.getByRole('button', { name: 'Buy first' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Cook anyway' })).toBeVisible();

  // Go shopping.
  await addBatch(request, 'Chicken breast', { qty: 300, unit: 'g' });
  await addBatch(request, 'Peanuts', { qty: 100, unit: 'g' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'To cook (1)' }).click();
  await page.getByTestId('to-cook-row').getByRole('button', { name: 'Continue' }).click();
  dlg = page.getByRole('dialog', { name: 'How many people are eating?' });
  await dlg.getByRole('button', { name: 'Get dishes' }).click();
  await page.locator('.dish-card').first().click();
  await expect(page.getByRole('article')).not.toContainText('missing');
  await page.getByRole('button', { name: 'I cooked it' }).click();
  await page.getByRole('dialog', { name: 'Did you cook it?' }).getByRole('button', { name: 'Yes, update my fridge' }).click();
  await expect(page.getByTestId('toast')).toContainText('Fridge updated');
  const s = await apiState(request);
  expect(s.toCook).toEqual([]);
  expect(s.history[0]).toMatchObject({ dishName: 'Kung pao chicken with peanuts and scallion', servings: 3, mode: 'dish' });
});

test('History shows each dish with time, people, mode and what was used; entries can be deleted (acceptance 26)', async ({ page, request }) => {
  await addBatch(request, 'Pork', { qty: 500, unit: 'g' });
  const pork = await foodId(request, 'Pork');
  await request.post('/api/cook/confirm', { data: { mode: 'suggest', servings: 2, dish: { name: 'Pork stir-fry' }, lines: [{ foodId: pork, amount: 200, unit: 'g' }] } });
  await request.post('/api/cook/confirm', { data: { mode: 'dish', servings: 1, dish: { name: 'Scallion beef', missing: [{ name: 'Beef' }] }, lines: [] } });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'History' }).click();
  const rows = page.getByTestId('history-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Scallion beef');
  await expect(rows.nth(0)).toContainText('1 person · I want a dish');
  await expect(rows.nth(1)).toContainText(/Pork stir-fry · \w{3} \d+, \d{4}, \d\d:\d\d [AP]M · 2 people · Suggest for me/);
  await rows.nth(1).getByText('Pork stir-fry').click();
  await expect(rows.nth(1)).toContainText('Taken from the fridge: Pork 200 g');
  await rows.nth(0).getByText('Scallion beef').click();
  await expect(rows.nth(0)).toContainText('Cooked without: Beef');
  await rows.nth(0).getByRole('button', { name: 'Delete Scallion beef from history' }).click();
  await expect(rows).toHaveCount(1);
});

test('export a backup, change things, import it back (acceptance 28, 29)', async ({ page, request }) => {
  await request.post('/api/test/ai', { data: { mode: 'auto' } });
  await request.put('/api/ai-config', { data: { apiKey: 'sk-e2e-secret-777' } });
  await addBatch(request, 'Tomato', { qty: 3, unit: 'pcs', expiryDate: isoDate(4) });
  await addBatch(request, 'Rice', { qty: 2, unit: 'kg' });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Backup' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^fridge-backup-\d{8}-\d{6}\.json$/);
  const file = await download.path();
  const text = fs.readFileSync(file, 'utf8');
  expect(text).not.toContain('sk-e2e-secret');

  // Change the fridge.
  const s = await apiState(request);
  for (const b of s.batches) await request.delete(`/api/batches/${b.id}`);
  await addBatch(request, 'Egg', { qty: 12, unit: 'pcs' });

  // A broken file is refused.
  await page.getByLabel('Import backup file').setInputFiles({ name: 'oops.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":true}') });
  await expect(page.getByRole('alert')).toContainText('not a Virtual Fridge backup');
  expect((await apiState(request)).batches).toHaveLength(1);

  await page.getByLabel('Import backup file').setInputFiles(file);
  const dlg = page.getByRole('dialog', { name: 'Replace all data with this backup?' });
  await expect(dlg).toContainText('2 fridge batches');
  await dlg.getByRole('button', { name: 'Replace my data' }).click();
  await expect(page.getByTestId('toast')).toContainText('Backup restored');
  await page.getByRole('button', { name: 'Fridge' }).click();
  await expect(card(page, 'Tomato')).toContainText('3 pcs');
  await expect(card(page, 'Rice')).toContainText('2 kg');
  await expect(card(page, 'Egg')).toHaveCount(0);
  await request.put('/api/ai-config', { data: { clearKey: true } });
});
