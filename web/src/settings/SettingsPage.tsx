import { useState } from 'react';
import { AiSettings } from './AiSettings';

type Section = 'ai' | 'taste' | 'pack' | 'tocook' | 'history' | 'backup';

export function SettingsPage(_props: { onContinueToCook: (id: number) => void }) {
  const [section, setSection] = useState<Section>('ai');
  const items: [Section, string][] = [['ai', 'AI model']];
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {items.map(([id, label]) => (
          <button key={id} className={section === id ? 'tab active' : 'tab'} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-body">{section === 'ai' && <AiSettings />}</div>
    </div>
  );
}
