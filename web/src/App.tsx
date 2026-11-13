import { useState } from 'react';

type Tab = 'fridge' | 'cook' | 'settings';

export function App() {
  const [tab, setTab] = useState<Tab>('fridge');
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Virtual Fridge</span>
        <nav className="tabs" aria-label="Main">
          <button className={tab === 'fridge' ? 'tab active' : 'tab'} onClick={() => setTab('fridge')}>Fridge</button>
          <button className={tab === 'cook' ? 'tab active' : 'tab'} onClick={() => setTab('cook')}>AI cook</button>
          <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>Settings</button>
        </nav>
      </header>
      <main className="page">
        {tab === 'fridge' && <h1>Fridge</h1>}
        {tab === 'cook' && <h1>AI cook</h1>}
        {tab === 'settings' && <h1>Settings</h1>}
      </main>
    </div>
  );
}
