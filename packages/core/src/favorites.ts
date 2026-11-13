export const FAVORITES_LIMIT = 12;

export interface FavoriteStat {
  foodId: number;
  pinned: boolean;
  /** Order in which items were pinned (lower = earlier). */
  pinnedAt: number | null;
  addCount: number;
  /** ISO timestamp of the last add or use. */
  lastUsedAt: string | null;
}

function recencyBonus(lastUsedAt: string | null, now: Date): number {
  if (!lastUsedAt) return 0;
  const days = (now.getTime() - Date.parse(lastUsedAt)) / 86_400_000;
  if (days <= 3) return 5;
  if (days <= 14) return 2;
  return 0;
}

export function favoriteScore(stat: FavoriteStat, now: Date): number {
  return stat.addCount + recencyBonus(stat.lastUsedAt, now);
}

/**
 * Pinned items keep a fixed position at the top (in the order they were pinned).
 * The rest are ranked by how often and how recently they were added or used.
 */
export function rankFavorites(stats: FavoriteStat[], now: Date = new Date(), limit = FAVORITES_LIMIT): number[] {
  const pinned = stats
    .filter((s) => s.pinned)
    .sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0) || a.foodId - b.foodId);
  const rest = stats
    .filter((s) => !s.pinned)
    .sort((a, b) => favoriteScore(b, now) - favoriteScore(a, now) || a.foodId - b.foodId);
  return [...pinned, ...rest].slice(0, Math.max(limit, pinned.length)).map((s) => s.foodId);
}

export const ONBOARDING_MIN = 6;
export const ONBOARDING_MAX = 8;

export function validateOnboardingPick(count: number): string | null {
  if (count < ONBOARDING_MIN) return `Pick at least ${ONBOARDING_MIN} ingredients.`;
  if (count > ONBOARDING_MAX) return `Pick at most ${ONBOARDING_MAX} ingredients.`;
  return null;
}
