import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useI18n } from '../i18n/i18n.js';
export function LanguageSwitch() {
    const { locale, setLocale, t } = useI18n();
    return (_jsxs("div", { className: "language-switch", "aria-label": t('language.label'), children: [_jsx("button", { type: "button", className: locale === 'en' ? 'active' : '', onClick: () => setLocale('en'), "aria-pressed": locale === 'en', children: "EN" }), _jsx("button", { type: "button", className: locale === 'cs' ? 'active' : '', onClick: () => setLocale('cs'), "aria-pressed": locale === 'cs', children: "CZ" })] }));
}
//# sourceMappingURL=language-switch.js.map