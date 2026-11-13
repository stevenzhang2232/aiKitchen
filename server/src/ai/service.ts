import type { Category, CookMode, Dish, Location, Source, TastePrefs, Unit, UnitKind } from '@kitchen/core';
import { formatAmount } from '@kitchen/core';
import { chat, parseJsonAnswer, AiError, type ChatMessage } from './client.js';
import { capabilities, type AiConfig } from './config.js';

export interface ShelfLifeQuery {
  foodName: string;
  category: Category;
  location: Location;
}

export interface ShelfLifeAnswer {
  days: number | null;
  note: string | null;
  sources: Source[];
}

export interface ReceiptLine {
  name: string;
  qty: number;
  unit: Unit;
}

export interface StockLine {
  foodId: number;
  name: string;
  category: Category;
  kind: UnitKind;
  /** Base amount: grams, pieces or servings. */
  amount: number;
  unit: Unit;
  expiresInDays: number | null;
}

export interface RecipeContext {
  mode: CookMode;
  servings: number;
  taste: TastePrefs | null;
  dishName?: string;
  stock: StockLine[];
  seasonings: { foodId: number; name: string }[];
}

export interface AiService {
  readonly kind: 'real' | 'mock';
  testConnection(): Promise<string>;
  estimateShelfLife(q: ShelfLifeQuery): Promise<ShelfLifeAnswer | null>;
  readReceipt(imageDataUrl: string): Promise<ReceiptLine[]>;
  /** previous = the last answer and the rule problems found in it, for one retry. */
  suggestDishes(ctx: RecipeContext, previous?: { answer: string; errors: string[] }): Promise<{ dishes: Dish[]; raw: string }>;
}

const LOCATION_WORD: Record<Location, string> = { fridge: 'in the refrigerator', freezer: 'in the freezer', pantry: 'at room temperature in the pantry' };

export class RealAiService implements AiService {
  readonly kind = 'real' as const;
  constructor(private getConfig: () => AiConfig) {}

  private cfg(): AiConfig {
    const cfg = this.getConfig();
    if (!capabilities(cfg).configured) throw new AiError('Set up an AI model in Settings → AI model first.', 'auth');
    return cfg;
  }

  async testConnection(): Promise<string> {
    const cfg = this.cfg();
    const r = await chat(cfg, {
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      timeoutMs: 30_000,
      temperature: 0,
    });
    return `Connected to ${cfg.model}. It replied: “${r.content.trim().slice(0, 40)}”.`;
  }

  async estimateShelfLife(q: ShelfLifeQuery): Promise<ShelfLifeAnswer | null> {
    const cfg = this.cfg();
    const caps = capabilities(cfg);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a careful food safety assistant. Answer in English with JSON only. Base your answer on reliable food-safety sources ' +
          '(government food agencies, university extension services). Be conservative: when sources differ, use the shorter time.',
      },
      {
        role: 'user',
        content:
          `How many days can fresh, store-bought "${q.foodName}" (category: ${q.category}) be kept ${LOCATION_WORD[q.location]} ` +
          'from the day it is bought, assuming normal home storage? ' +
          'Return JSON: {"days": integer or null if reliable information is not available, ' +
          '"conditions": "one or two short sentences on the storage conditions this applies to", ' +
          '"sources": [{"title": "...", "url": "https://..."}]}',
      },
    ];
    const r = await chat(cfg, { messages, search: caps.search, json: true, timeoutMs: 90_000, temperature: 0 });
    const parsed = parseJsonAnswer<{ days?: unknown; conditions?: unknown; sources?: unknown }>(r.content);
    const days = typeof parsed.days === 'number' && Number.isFinite(parsed.days) && parsed.days >= 0 && parsed.days <= 3650
      ? Math.floor(parsed.days)
      : null;
    const modelSources: Source[] = Array.isArray(parsed.sources)
      ? (parsed.sources as Record<string, unknown>[])
          .filter((s) => typeof s?.url === 'string' && /^https?:\/\//.test(s.url as string))
          .map((s) => ({ title: typeof s.title === 'string' ? s.title : (s.url as string), url: s.url as string }))
      : [];
    // Prefer links the provider's search actually returned; fall back to links the model cited.
    const sources = (r.sources.length ? r.sources : caps.search ? modelSources : []).slice(0, 5);
    let note = typeof parsed.conditions === 'string' ? parsed.conditions.trim().slice(0, 300) : null;
    if (!caps.search) note = `${note ? `${note} ` : ''}(From the model’s own knowledge; no web sources.)`;
    if (days == null) return { days: null, note, sources };
    return { days, note, sources };
  }

  async readReceipt(imageDataUrl: string): Promise<ReceiptLine[]> {
    const cfg = this.cfg();
    if (!cfg.visionModel) throw new AiError('The current AI setup can’t read images. Add a vision model in Settings → AI model.', 'provider');
    const r = await chat(cfg, {
      model: cfg.visionModel,
      timeoutMs: 90_000,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageDataUrl } },
            {
              type: 'text',
              text:
                'This is a grocery receipt (it may be in Chinese). List only food items and seasonings that were bought. ' +
                'Translate each item to a short common English ingredient name (e.g. "西红柿" -> "Tomato", "五花肉" -> "Pork belly"). ' +
                'Estimate the quantity: use "g" or "kg" for weighed items, "pcs" for counted items, "serving" if unclear. ' +
                'Return JSON only: {"items": [{"name": "Tomato", "qty": 3, "unit": "pcs"}]}. Skip bags, discounts and non-food items.',
            },
          ],
        },
      ],
    });
    const parsed = parseJsonAnswer<{ items?: unknown }>(r.content);
    if (!Array.isArray(parsed.items)) throw new AiError('The AI could not find any items on this receipt.', 'format');
    return (parsed.items as Record<string, unknown>[])
      .map((i) => ({
        name: String(i.name ?? '').trim(),
        qty: Number(i.qty),
        unit: (['g', 'kg', 'pcs', 'serving'].includes(i.unit as string) ? i.unit : 'pcs') as Unit,
      }))
      .filter((i) => i.name && Number.isFinite(i.qty) && i.qty > 0);
  }

  async suggestDishes(ctx: RecipeContext, previous?: { answer: string; errors: string[] }) {
    const cfg = this.cfg();
    const messages: ChatMessage[] = [
      { role: 'system', content: RECIPE_SYSTEM },
      { role: 'user', content: recipePrompt(ctx) },
    ];
    if (previous) {
      messages.push({ role: 'assistant', content: previous.answer });
      messages.push({
        role: 'user',
        content: `Your answer broke these rules:\n- ${previous.errors.join('\n- ')}\nFix every problem and return the complete JSON again.`,
      });
    }
    const r = await chat(cfg, { messages, json: true, timeoutMs: 120_000, temperature: 0.4 });
    const parsed = parseJsonAnswer<{ dishes?: unknown }>(r.content);
    const dishes = Array.isArray(parsed.dishes) ? (parsed.dishes as Dish[]) : [];
    return { dishes: dishes.map(sanitizeDish), raw: r.content };
  }
}

function sanitizeDish(d: Partial<Dish>): Dish {
  return {
    name: String(d?.name ?? '').trim(),
    minutes: Math.round(Number(d?.minutes)),
    servings: Math.round(Number(d?.servings)) || 1,
    ingredients: Array.isArray(d?.ingredients)
      ? d!.ingredients.map((i) => ({ foodId: Number(i.foodId), amount: Number(i.amount), unit: i.unit, howTo: typeof i.howTo === 'string' ? i.howTo : undefined }))
      : [],
    seasonings: Array.isArray(d?.seasonings) ? d!.seasonings.map(Number).filter(Number.isFinite) : [],
    missing: Array.isArray(d?.missing)
      ? d!.missing.map((m) => ({
          name: String(m?.name ?? '').trim(),
          foodId: m?.foodId == null ? null : Number(m.foodId),
          amount: m?.amount == null ? null : Number(m.amount),
          unit: m?.unit ?? null,
        })).filter((m) => m.name)
      : [],
    steps: Array.isArray(d?.steps) ? d!.steps.map((s) => String(s)) : [],
  };
}

export const RECIPE_SYSTEM = [
  'You are a home-cooking assistant inside a "virtual fridge" app. Write everything in English.',
  'Hard rules (a program checks them and rejects any answer that breaks one):',
  '1. Use ONLY the listed stock ingredients and the listed seasonings. Water is the only other thing allowed.',
  '   This includes marinades, sauces, side dishes, garnishes and anything named in the steps.',
  '2. Each ingredient amount must use the unit shown for it, and the total for all dishes together must not exceed what is available.',
  '3. Refer to ingredients and seasonings by their id. Do not list seasonings under "ingredients".',
  '4. Steps must not mention any food that is not in that dish\'s ingredients, its seasonings, or (only when allowed) its missing list.',
  'Give practical amounts: for things counted in pcs prefer whole numbers; in "howTo" describe the amount in kitchen terms based on',
  'what is left, e.g. "half of what\'s left", "cut into three, use one part", "all of the remaining".',
  'Return JSON only, in this shape:',
  '{"dishes":[{"name":"...","minutes":20,"servings":2,',
  '"ingredients":[{"foodId":12,"amount":2,"unit":"pcs","howTo":"2 of the 3 tomatoes"}],',
  '"seasonings":[40,41],"missing":[],"steps":["...","..."]}]}',
].join('\n');

export function recipePrompt(ctx: RecipeContext): string {
  const lines: string[] = [];
  lines.push('Stock you may use (id: name — available amount — unit to use — freshness):');
  for (const s of ctx.stock) {
    const fresh =
      s.expiresInDays == null ? 'no use-by date'
        : s.expiresInDays < 0 ? `expired ${-s.expiresInDays} days ago — do NOT use unless the user says so`
          : s.expiresInDays <= 2 ? `expires in ${s.expiresInDays} day(s) — USE FIRST`
            : `expires in ${s.expiresInDays} days`;
    lines.push(`- ${s.foodId}: ${s.name} — ${formatAmount(s.amount, s.unit)} — unit "${s.kind === 'weight' ? 'g' : s.unit}" — ${fresh}`);
  }
  if (!ctx.stock.length) lines.push('- (nothing)');
  lines.push('');
  lines.push(`Seasonings the user has (id: name): ${ctx.seasonings.map((s) => `${s.foodId}: ${s.name}`).join(', ') || '(none)'}`);
  lines.push('');
  lines.push(`People eating: ${ctx.servings}.`);
  if (ctx.taste) {
    lines.push(
      `Taste: spice level ${ctx.taste.spice}` +
        (ctx.taste.avoid.length ? `; never use or suggest: ${ctx.taste.avoid.join(', ')}` : '') +
        (ctx.taste.cuisines.length ? `; preferred cuisines: ${ctx.taste.cuisines.join(', ')}` : '') + '.',
    );
  }
  lines.push('');
  if (ctx.mode === 'dish') {
    lines.push(`The user wants to cook: "${ctx.dishName}". Return exactly 1 dish with that name.`);
    lines.push('If something it needs is not in stock (or not enough), still write the full recipe, but list each shortfall in "missing"');
    lines.push('as {"name": "...", "amount": number, "unit": "g"|"kg"|"pcs"|"serving"} and use only the available part in "ingredients".');
    lines.push('Missing items may be mentioned in the steps. Mark them in the steps with "(missing)".');
  } else if (ctx.mode === 'pick') {
    lines.push('The user picked exactly the stock listed above for this meal. Suggest 1 to 3 dishes that together use these picks');
    lines.push('(they may use less than all of it, never more). "missing" must be empty.');
  } else {
    lines.push('Suggest 1 to 3 dishes that can be made now. Prefer ingredients marked USE FIRST. "missing" must be empty.');
    lines.push('If several dishes are suggested they are one meal, so their combined amounts must fit the stock.');
  }
  lines.push('Each dish: realistic total minutes and clear numbered-order steps (no numbers needed in the text).');
  return lines.join('\n');
}
