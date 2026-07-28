import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { I18nProvider } from './i18n/i18n.js';
import './styles.css';
const root = document.getElementById('root');
if (root === null)
    throw new Error('Root element is missing');
createRoot(root).render(_jsx(StrictMode, { children: _jsx(I18nProvider, { children: _jsx(App, {}) }) }));
//# sourceMappingURL=main.js.map