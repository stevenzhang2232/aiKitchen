// One-off dev script: download freely licensed food photos from Wikimedia Commons
// (the lead image of each food's English Wikipedia article), store them in
// web/public/foods, and write web/src/foodImages.json plus CREDITS.md.
// Usage: node scripts/fetch-images.mjs [key ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web', 'public', 'foods');
const manifestPath = path.join(root, 'web', 'src', 'foodImages.json');
const creditsJsonPath = path.join(root, 'scripts', 'image-credits.json');
const UA = 'aiKitchen-dev-image-fetch/1.0 (local hobby project)';

/** image key -> Wikipedia article (or "File:..." to pin a specific Commons file) */
export const SOURCES = {
  tomato: 'Tomato',
  potato: 'Potato',
  carrot: 'Carrot',
  onion: 'Onion',
  cucumber: 'Cucumber',
  eggplant: 'Eggplant',
  napa_cabbage: 'Napa cabbage',
  cabbage: 'Cabbage',
  broccoli: 'Broccoli',
  cauliflower: 'Cauliflower',
  bell_pepper: 'Bell pepper',
  chili_pepper: 'Chili pepper',
  leafy_greens: 'Spinach',
  lettuce: 'Lettuce',
  celery: 'Celery',
  zucchini: 'Zucchini',
  pumpkin: 'Pumpkin',
  corn: 'Corn on the cob',
  green_beans: 'Green bean',
  sweet_potato: 'Sweet potato',
  daikon: 'Daikon',
  bean_sprouts: 'Bean sprout',
  lotus_root: 'Lotus root',
  asparagus: 'Asparagus',
  mushroom: 'Agaricus bisporus',
  enoki: 'Enokitake',
  wood_ear: 'Auricularia heimuer',
  scallion: 'Scallion',
  ginger: 'Ginger',
  garlic: 'Garlic',
  cilantro: 'Coriander',
  apple: 'Apple',
  banana: 'Banana',
  orange: 'Orange (fruit)',
  lemon: 'Lemon',
  strawberry: 'Strawberry',
  grape: 'Grape',
  pear: 'Pear',
  mango: 'Mango',
  kiwi: 'Kiwifruit',
  watermelon: 'Watermelon',
  pork: 'Pork',
  pork_ribs: 'Spare ribs',
  ground_meat: 'Ground meat',
  beef: 'Beef',
  chicken_breast: 'Chicken as food',
  chicken_thigh: 'Chicken as food',
  chicken_wings: 'Chicken as food',
  lamb: 'Lamb and mutton',
  bacon: 'Bacon',
  ham: 'Ham',
  sausage: 'Sausage',
  shrimp: 'Shrimp and prawn as food',
  fish: 'Fish as food',
  salmon: 'Salmon as food',
  squid: 'Squid as food',
  clams: 'Clam',
  egg: 'Egg as food',
  milk: 'Milk',
  yogurt: 'Yogurt',
  cheese: 'Cheese',
  butter: 'Butter',
  rice: 'Rice',
  noodles: 'Noodle',
  rice_noodles: 'Rice noodles',
  pasta: 'Pasta',
  bread: 'Bread',
  flour: 'Flour',
  dumplings: 'Jiaozi',
  oats: 'Oat',
  tofu: 'Tofu',
  dried_tofu: 'Dougan',
  peanut: 'Peanut',
  edamame: 'Edamame',
};

const FREE = /^(cc0|public domain|pd|cc[ -]by(-sa)?[ -]?\d|cc[ -]by(-sa)?$)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status !== 429 && res.status < 500) return res;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
    console.log(`  waiting ${Math.round(wait / 1000)}s (${res.status})`);
    await sleep(wait);
  }
  throw new Error(`gave up on ${url}`);
}

async function getJson(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function stripHtml(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

const leadCache = new Map();
async function prefetchLeads(titles) {
  const list = [...new Set(titles.filter((t) => !t.startsWith('File:')))];
  for (let i = 0; i < list.length; i += 40) {
    const chunk = list.slice(i, i + 40);
    const u = new URL('https://en.wikipedia.org/w/api.php');
    u.search = new URLSearchParams({ action: 'query', prop: 'pageimages', piprop: 'name', titles: chunk.join('|'), redirects: '1', format: 'json', formatversion: '2' }).toString();
    const j = await getJson(u);
    const alias = new Map();
    for (const n of j.query?.normalized ?? []) alias.set(n.from, n.to);
    for (const r of j.query?.redirects ?? []) alias.set(r.from, r.to);
    const byTitle = new Map((j.query?.pages ?? []).map((p) => [p.title, p.pageimage ?? null]));
    for (const t of chunk) {
      let k = t;
      for (let n = 0; n < 3 && alias.has(k); n++) k = alias.get(k);
      leadCache.set(t, byTitle.get(k) ?? null);
    }
    await sleep(1000);
  }
}
async function leadFile(title) {
  if (title.startsWith('File:')) return title.slice(5);
  if (leadCache.has(title)) return leadCache.get(title);
  const u = new URL('https://en.wikipedia.org/w/api.php');
  u.search = new URLSearchParams({ action: 'query', prop: 'pageimages', piprop: 'name', titles: title, redirects: '1', format: 'json', formatversion: '2' }).toString();
  const j = await getJson(u);
  return j.query?.pages?.[0]?.pageimage ?? null;
}

async function commonsInfo(file) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({
    action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '320', format: 'json', formatversion: '2',
  }).toString();
  const j = await getJson(u);
  const page = j.query?.pages?.[0];
  if (!page || page.missing) return null;
  const ii = page.imageinfo?.[0];
  if (!ii) return null;
  const m = ii.extmetadata ?? {};
  return {
    thumb: ii.thumburl,
    page: ii.descriptionurl,
    license: stripHtml(m.LicenseShortName?.value),
    licenseUrl: stripHtml(m.LicenseUrl?.value) || null,
    artist: stripHtml(m.Artist?.value) || 'Unknown',
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const only = process.argv.slice(2);
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  const credits = fs.existsSync(creditsJsonPath) ? JSON.parse(fs.readFileSync(creditsJsonPath, 'utf8')) : {};
  await prefetchLeads(Object.entries(SOURCES).filter(([k]) => !only.length || only.includes(k)).map(([, t]) => t));
  for (const [key, title] of Object.entries(SOURCES)) {
    if (only.length && !only.includes(key)) continue;
    try {
      const file = await leadFile(title);
      if (!file) { console.log(`skip ${key}: no lead image`); continue; }
      const info = await commonsInfo(file);
      if (!info) { console.log(`skip ${key}: ${file} is not on Commons`); continue; }
      if (!FREE.test(info.license)) { console.log(`skip ${key}: license "${info.license}"`); continue; }
      const ext = (path.extname(new URL(info.thumb).pathname) || '.jpg').toLowerCase();
      const res = await fetchRetry(info.thumb);
      if (!res.ok) { console.log(`skip ${key}: download ${res.status}`); continue; }
      const type = res.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) { console.log(`skip ${key}: not an image (${type})`); continue; }
      const name = `${key}${ext}`;
      for (const old of fs.readdirSync(outDir)) if (old.startsWith(`${key}.`)) fs.unlinkSync(path.join(outDir, old));
      fs.writeFileSync(path.join(outDir, name), Buffer.from(await res.arrayBuffer()));
      manifest[key] = name;
      credits[key] = { file, ...info, thumb: undefined };
      console.log(`ok ${key} <- ${file} (${info.license})`);
      await sleep(1500);
    } catch (err) {
      console.log(`skip ${key}: ${err.message}`);
    }
  }
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 2)}\n`);
  fs.writeFileSync(creditsJsonPath, `${JSON.stringify(credits, null, 2)}\n`);
  writeCredits(credits);
}

function writeCredits(credits) {
  const lines = [
    '# Image credits',
    '',
    'Food photos in `web/public/foods/` are scaled copies of freely licensed images from',
    '[Wikimedia Commons](https://commons.wikimedia.org/). Each image keeps its original license.',
    'Foods without a photo use a category icon. Any photo can be replaced by dropping a new file',
    'with the same name into `web/public/foods/` and updating `web/src/foodImages.json`.',
    '',
    '| Image | Source file | Author | License |',
    '|---|---|---|---|',
  ];
  for (const [key, c] of Object.entries(credits).sort(([a], [b]) => a.localeCompare(b))) {
    const lic = c.licenseUrl ? `[${c.license}](${c.licenseUrl})` : c.license;
    lines.push(`| ${key} | [${c.file.replace(/\|/g, '\\|')}](${c.page}) | ${c.artist.replace(/\|/g, '\\|')} | ${lic} |`);
  }
  fs.writeFileSync(path.join(root, 'CREDITS.md'), `${lines.join('\n')}\n`);
}

main();
