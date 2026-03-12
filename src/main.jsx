import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// React StrictMode intentionally omitted here:
// it mounts/unmounts components twice in development, which would initialise
// two AR renderers and two camera streams. Using a plain render avoids that.
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
