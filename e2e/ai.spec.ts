import { test, expect } from '@playwright/test';
import { addBatch, apiState, card, isoDate, onboard, reset, setUnit } from './helpers';

// 1×1 PNG used as a stand-in receipt photo (the test AI returns a fixed list).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ request }) => {
  await reset(request);
  await onboard(request);
});

test('AI suggests a use-by date with sources; user can override it (acceptance 16)', async ({ page, request }) => {
  await request.post('/api/test/ai', { data: { mode: 'mock' } });
  await setUnit(request, 'Egg', 'pcs');
  await page.goto('/');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  await page.getByRole('button', { name: 'Add one Egg' }).click();
  await expect(page.getByTestId('toast')).toContainText('AI is estimating shelf life');
  await expect(card(page, 'Egg')).toContainText(/AI suggestion: use by \w{3} \d+/);
  await card(page, 'Egg').click();
  await page.getByRole('button', { name: 'Sources' }).click();
  const dlg = page.getByRole('dialog', { name: 'Shelf life of Egg' });
  await expect(dlg.getByRole('link', { name: 'Example food storage chart' })).toHaveAttribute('href', 'https://example.org/food-storage-chart');
  await expect(dlg).toContainText('sealed and at a steady temperature');
  await dlg.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Dates' }).click();
  const dates = page.getByRole('dialog', { name: 'Dates for Egg' });
  await dates.getByText('Use-by date').click();
  await dates.getByLabel('Use by').fill(isoDate(1));
  await dates.getByRole('button', { name: 'Save dates' }).click();
  await expect(card(page, 'Egg')).toContainText('Eat first · 1 day left');
  const b = (await apiState(request)).batches[0];
  expect(b).toMatchObject({ expiryDate: isoDate(1), expirySource: 'user' });
});

test('offline: fridge keeps working and suggestions can be retried later (acceptance 4, 5, 6)', async ({ page, request }) => {
  await request.post('/api/test/ai', { data: { mode: 'offline' } });
  await setUnit(request, 'Tomato', 'pcs');
  await addBatch(request, 'Potato', { qty: 1, unit: 'kg' });
  await page.goto('/');
  await expect(card(page, 'Potato')).toContainText('No suggestion available');

  // Add, search, adjust, use, undo and seasonings all work while the AI is unreachable.
  await page.getByLabel('Search ingredients or seasonings').fill('tomato');
  await page.getByRole('button', { name: 'Add Tomato', exact: true }).click();
  await expect(card(page, 'Tomato')).toContainText('1 pc');
  await expect(card(page, 'Tomato')).toContainText('No suggestion available');
  await expect(card(page, 'Tomato')).toContainText('Just added');
  await page.getByRole('button', { name: 'Add Tomato', exact: true }).click();
  await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Tomato')).toContainText('1 pc');
  await page.getByLabel('Search ingredients or seasonings').fill('');
  await card(page, 'Potato').click();
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('dialog', { name: 'Use Potato' }).getByLabel('Unit').selectOption('g');
  await page.getByRole('dialog', { name: 'Use Potato' }).getByLabel('Amount used').fill('200');
  await page.getByRole('dialog', { name: 'Use Potato' }).getByRole('button', { name: 'Use', exact: true }).click();
  await expect(card(page, 'Potato')).toContainText('0.8 kg');
  await page.getByRole('button', { name: '+ Add seasoning pack' }).click();
  await expect(page.getByRole('region', { name: 'Seasonings' }).getByRole('button', { name: '✓ Salt' })).toBeVisible();

  // Back online: ask again.
  await request.post('/api/test/ai', { data: { mode: 'mock' } });
  await card(page, 'Tomato').click();
  await page.getByRole('button', { name: 'Ask AI again' }).click();
  await expect(card(page, 'Tomato')).toContainText(/AI suggestion: use by/);
  const s = await apiState(request);
  expect(s.batches.find((b: { aiStatus: string; expirySource: string }) => b.expirySource === 'ai')).toBeTruthy();
});

test('scan a receipt, review and add everything (acceptance 17)', async ({ page, request }) => {
  await request.post('/api/test/ai', { data: { mode: 'mock' } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  await page.getByRole('button', { name: 'Scan receipt' }).click();
  const dlg = page.getByRole('dialog', { name: 'Scan a receipt' });
  await dlg.getByLabel('Upload receipt photo').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(dlg.getByRole('table', { name: 'Receipt items' }).getByRole('row')).toHaveCount(5);
  await expect(dlg.getByLabel('Ingredient for 五花肉')).toHaveValue(String((await apiState(request)).foods.find((f: { name: string }) => f.name === 'Pork belly').id));
  await dlg.getByLabel('Amount of Tomato').fill('4');
  await dlg.getByRole('button', { name: 'Remove Milk' }).click();
  await dlg.getByRole('button', { name: 'Add 4 items to fridge' }).click();
  await expect(card(page, 'Tomato')).toContainText('4 pcs');
  await expect(card(page, 'Pork belly')).toContainText('500 g');
  await expect(card(page, 'Dragon fruit')).toContainText('1 pc');
  await expect(card(page, 'Milk')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Seasonings' }).getByRole('button', { name: '✓ Light soy sauce' })).toBeVisible();
});

test('receipt scanning explains when no AI is set up', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add ingredients' }).click();
  await page.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(page.getByRole('dialog', { name: 'Scan a receipt' })).toContainText('needs an AI model');
});

test('AI model settings: save, mask the key, and test the connection (acceptance 27)', async ({ page, request }) => {
  await request.post('/api/test/ai', { data: { mode: 'auto' } });
  await page.goto('/#/settings');
  const sec = page.getByRole('region', { name: 'AI model' });
  await expect(sec).toContainText('Status: not set up');
  await sec.getByLabel('Provider address').fill('http://127.0.0.1:9/v1');
  await sec.getByLabel('API key').fill('sk-wrong-key-12345');
  await sec.getByRole('button', { name: 'Save' }).click();
  await expect(sec.getByRole('status')).toHaveText('Saved');
  await expect(sec).toContainText('saved: sk-••••2345');
  await expect(sec.getByLabel('API key')).toHaveValue('');
  await sec.getByRole('button', { name: 'Test connection' }).click();
  await expect(sec.getByRole('status')).toContainText('Couldn’t reach the AI service');
  await sec.getByRole('button', { name: 'Remove key' }).click();
  await expect(sec).toContainText('Status: not set up');
  await request.post('/api/test/ai', { data: { mode: 'mock' } });
  await page.reload();
  await page.getByRole('region', { name: 'AI model' }).getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('region', { name: 'AI model' }).getByRole('status')).toContainText('Connected to the built-in test AI');
});
