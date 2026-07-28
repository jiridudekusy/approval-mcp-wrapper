import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useMemo, useState, } from 'react';
import { cs } from './cs.js';
import { en } from './en.js';
const catalogs = { en, cs };
const STORAGE_KEY = 'approval-mcp.locale';
export function selectLocale(stored, browserLanguages) {
    if (stored === 'en' || stored === 'cs')
        return stored;
    return browserLanguages.some((language) => language.toLowerCase().startsWith('cs'))
        ? 'cs'
        : 'en';
}
export function translate(locale, key) {
    return catalogs[locale][key] ?? en[key];
}
const I18nContext = createContext(undefined);
export function I18nProvider({ children }) {
    const [locale, updateLocale] = useState(() => selectLocale(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null, globalThis.navigator?.languages ?? ['en']));
    const value = useMemo(() => ({
        locale,
        setLocale(next) {
            globalThis.localStorage?.setItem(STORAGE_KEY, next);
            document.documentElement.lang = next;
            updateLocale(next);
        },
        t: (key) => translate(locale, key),
        formatDate: (input) => new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(typeof input === 'string' ? new Date(input) : input),
        formatNumber: (input) => new Intl.NumberFormat(locale).format(input),
    }), [locale]);
    return _jsx(I18nContext.Provider, { value: value, children: children });
}
export function useI18n() {
    const value = useContext(I18nContext);
    if (value === undefined)
        throw new Error('I18nProvider is missing');
    return value;
}
//# sourceMappingURL=i18n.js.map