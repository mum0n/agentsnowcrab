import React, { useState } from 'react';
import Dashboard from './components/Dashboard.jsx';
import Simulation from './components/Simulation.jsx';
import Notebook from './components/Notebook.jsx';
import Environment from './components/Environment.jsx';

const TABS = ['Dashboard', 'Simulation', 'Environment', 'Notebook'];

export default function App() {
  const [tab, setTab] = useState('Dashboard');
  return (
    <div className="app">
      <header className="app-header">
        <h1>AgentSnowCrab</h1>
        <nav>
          {TABS.map(t => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'Dashboard' && <Dashboard />}
        {tab === 'Simulation' && <Simulation />}
        {tab === 'Environment' && <Environment />}
        {tab === 'Notebook' && <Notebook />}
      </main>
    </div>
  );
}
