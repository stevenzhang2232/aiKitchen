import type { TastePrefs } from '@kitchen/core';

export const SPICE_LABEL: Record<TastePrefs['spice'], string> = { none: 'Not spicy', mild: 'Mild', medium: 'Medium', hot: 'Hot' };

export interface TasteDraft {
  spice: TastePrefs['spice'];
  avoid: string;
  cuisines: string;
}

export function draftFrom(t: TastePrefs | null): TasteDraft {
  return { spice: t?.spice ?? 'mild', avoid: t?.avoid.join(', ') ?? '', cuisines: t?.cuisines.join(', ') ?? '' };
}

export function tasteSummary(t: TastePrefs | null): string {
  if (!t) return 'Not set';
  const parts = [SPICE_LABEL[t.spice]];
  parts.push(t.avoid.length ? `avoid ${t.avoid.join(', ')}` : 'no foods to avoid');
  if (t.cuisines.length) parts.push(t.cuisines.join(', '));
  return parts.join(' · ');
}

export function TasteFields({ value, onChange }: { value: TasteDraft; onChange: (v: TasteDraft) => void }) {
  return (
    <div className="stack">
      <label className="field">
        <span>Spice level</span>
        <select value={value.spice} onChange={(e) => onChange({ ...value, spice: e.target.value as TastePrefs['spice'] })} aria-label="Spice level">
          {(Object.keys(SPICE_LABEL) as TastePrefs['spice'][]).map((s) => (
            <option key={s} value={s}>{SPICE_LABEL[s]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Foods to avoid (allergies, dislikes)</span>
        <input value={value.avoid} onChange={(e) => onChange({ ...value, avoid: e.target.value })} placeholder="cilantro, peanuts" aria-label="Foods to avoid" />
      </label>
      <label className="field">
        <span>Favorite cuisines</span>
        <input value={value.cuisines} onChange={(e) => onChange({ ...value, cuisines: e.target.value })} placeholder="Sichuan, home-style" aria-label="Favorite cuisines" />
      </label>
    </div>
  );
}
