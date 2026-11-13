import type { Tab } from '../App';

export function CookPage(_props: { intent: { toCookId: number } | null; clearIntent: () => void; goTo: (t: Tab) => void }) {
  return <h1>AI cook</h1>;
}
