import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { I18nProvider } from './i18n/i18n.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Root element is missing');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
