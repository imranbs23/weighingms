/**
 * The entry point — and it mounts the app.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import '../styles/tokens.css';
import '../styles/terminal.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('The application root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
