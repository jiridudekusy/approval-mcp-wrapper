import { type ReactNode } from 'react';
import { type MessageKey } from './en.js';
export type Locale = 'cs' | 'en';
export declare function selectLocale(stored: string | null, browserLanguages: readonly string[]): Locale;
export declare function translate(locale: Locale, key: MessageKey): string;
interface I18nValue {
    locale: Locale;
    setLocale(locale: Locale): void;
    t(key: MessageKey): string;
    formatDate(value: Date | string): string;
    formatNumber(value: number): string;
}
export declare function I18nProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useI18n(): I18nValue;
export {};
//# sourceMappingURL=i18n.d.ts.map