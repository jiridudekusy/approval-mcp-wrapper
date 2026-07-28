import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { cs } from './cs.js';
import { en, type MessageKey } from './en.js';

export type Locale = 'cs' | 'en';
const catalogs = { en, cs };
const STORAGE_KEY = 'approval-mcp.locale';

export function selectLocale(
  stored: string | null,
  browserLanguages: readonly string[],
): Locale {
  if (stored === 'en' || stored === 'cs') return stored;
  return browserLanguages.some((language) => language.toLowerCase().startsWith('cs'))
    ? 'cs'
    : 'en';
}

export function translate(locale: Locale, key: MessageKey): string {
  return catalogs[locale][key] ?? en[key];
}

interface I18nValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: MessageKey): string;
  formatDate(value: Date | string): string;
  formatNumber(value: number): string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(() =>
    selectLocale(
      globalThis.localStorage?.getItem(STORAGE_KEY) ?? null,
      globalThis.navigator?.languages ?? ['en'],
    ),
  );
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale(next) {
        globalThis.localStorage?.setItem(STORAGE_KEY, next);
        document.documentElement.lang = next;
        updateLocale(next);
      },
      t: (key) => translate(locale, key),
      formatDate: (input) =>
        new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(typeof input === 'string' ? new Date(input) : input),
      formatNumber: (input) => new Intl.NumberFormat(locale).format(input),
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === undefined) throw new Error('I18nProvider is missing');
  return value;
}
