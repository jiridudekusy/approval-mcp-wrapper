import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { AppShell } from './components/app-shell.js';
import { useI18n } from './i18n/i18n.js';
import { Inbox } from './pages/inbox.js';
import { Login } from './pages/login.js';
export function App() {
    const { t } = useI18n();
    const [csrfToken, setCsrfToken] = useState();
    const [page, setPage] = useState('inbox');
    if (csrfToken === undefined) {
        return _jsx(Login, { onAuthenticated: setCsrfToken });
    }
    return (_jsx(AppShell, { page: page, onNavigate: setPage, children: page === 'inbox' ? (_jsx(Inbox, {})) : (_jsxs("section", { className: "page", children: [_jsx("header", { className: "page-header", children: _jsx("h1", { children: t(`nav.${page}`) }) }), _jsx("div", { className: "empty-state", children: _jsx("span", { className: "brand-mark", children: "A" }) })] })) }));
}
//# sourceMappingURL=app.js.map