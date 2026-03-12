import { useState } from 'react';
import ARScene from './components/ARScene.jsx';

const NAV_ITEMS = ['Camera', 'Create AR Post', 'Map', 'Profile'];

function App() {
  const [activeTab, setActiveTab] = useState('Camera');

  return (
    <main className="app-shell">
      <ARScene />

      {activeTab !== 'Camera' && (
        <section className="panel-overlay">
          <h2>{activeTab}</h2>
          <p>
            {activeTab} view is reserved for your next feature.
          </p>
        </section>
      )}

      <nav className="bottom-nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === activeTab ? 'nav-btn nav-btn--active' : 'nav-btn'}
            onClick={() => setActiveTab(item)}
          >
            {item}
          </button>
        ))}
      </nav>
    </main>
  );
}

export default App;
