import { useState } from 'react';
import ARScene from './components/ARScene.jsx';
import './styles.css';

const NAV_ITEMS = [
  { id: 'Camera',        icon: '📷', label: 'Camera'  },
  { id: 'Create AR Post', icon: '✦',  label: 'AR Post' },
  { id: 'Map',           icon: '🗺️',  label: 'Map'     },
  { id: 'Profile',       icon: '👤',  label: 'Profile' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('Camera');

  return (
    <main className="app-shell">
      <ARScene />

      {activeTab !== 'Camera' && (
        <section className="panel-overlay">
          <h2>{activeTab}</h2>
          <p>
            {activeTab === 'Create AR Post' && 'Switch to Camera tab and tap Enter AR to place objects.'}
            {activeTab === 'Map'            && 'Map view coming soon — see nearby AR posts.'}
            {activeTab === 'Profile'        && 'Profile view coming soon.'}
          </p>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(({ id, icon, label }) => (
          <button
            key={id}
            type="button"
            className={id === activeTab ? 'nav-btn nav-btn--active' : 'nav-btn'}
            onClick={() => setActiveTab(id)}
          >
            <div style={{ fontSize: '1.25rem', lineHeight: 1, marginBottom: 2 }}>{icon}</div>
            {label}
          </button>
        ))}
      </nav>
    </main>
  );
}
