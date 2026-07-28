import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useI18n } from '../i18n/i18n.js';
import { LanguageSwitch } from './language-switch.js';
const nav = [
    { page: 'inbox', key: 'nav.inbox', glyph: '●' },
    { page: 'history', key: 'nav.history', glyph: '↗' },
    { page: 'access', key: 'nav.access', glyph: '◇' },
    { page: 'upstreams', key: 'nav.upstreams', glyph: '⇄' },
    { page: 'system', key: 'nav.system', glyph: '⌁' },
];
export function AppShell({ page, onNavigate, children, }) {
    const { t } = useI18n();
    return (_jsxs("div", { className: "shell", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("div", { className: "brand", children: [_jsx("span", { className: "brand-mark", children: "A" }), _jsxs("div", { children: [_jsx("strong", { children: t('app.name') }), _jsx("small", { children: "CONTROL PLANE" })] })] }), _jsx("nav", { "aria-label": "Primary", children: nav.map((item) => (_jsxs("button", { type: "button", className: page === item.page ? 'selected' : '', onClick: () => onNavigate(item.page), children: [_jsx("span", { "aria-hidden": "true", children: item.glyph }), t(item.key)] }, item.page))) }), _jsxs("div", { className: "sidebar-foot", children: [_jsx(LanguageSwitch, {}), _jsx("span", { className: "secure-dot", children: t('status.secure') })] })] }), _jsx("main", { children: children }), _jsx("nav", { className: "bottom-nav", "aria-label": "Primary", children: nav.map((item) => (_jsxs("button", { type: "button", className: page === item.page ? 'selected' : '', onClick: () => onNavigate(item.page), children: [_jsx("span", { "aria-hidden": "true", children: item.glyph }), _jsx("small", { children: t(item.key) })] }, item.page))) })] }));
}
export function localePath(locale, page) {
    return `#/${locale}/${page}`;
}
//# sourceMappingURL=app-shell.js.map