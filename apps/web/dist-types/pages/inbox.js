import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useI18n } from '../i18n/i18n.js';
export function Inbox() {
    const { t } = useI18n();
    return (_jsxs("section", { className: "page", children: [_jsxs("header", { className: "page-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "LIVE QUEUE" }), _jsx("h1", { children: t('inbox.title') }), _jsx("p", { children: t('inbox.subtitle') })] }), _jsxs("span", { className: "live-pill", children: [_jsx("i", {}), " LIVE"] })] }), _jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "radar", "aria-hidden": "true", children: _jsx("span", { children: "\u2713" }) }), _jsx("h2", { children: t('inbox.empty') }), _jsx("p", { children: t('inbox.emptyDetail') })] })] }));
}
//# sourceMappingURL=inbox.js.map