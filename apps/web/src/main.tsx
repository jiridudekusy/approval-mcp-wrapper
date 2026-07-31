import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { I18nProvider } from './i18n/i18n.js';
import { ThemeProvider } from './theme/theme.js';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Root element is missing');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
