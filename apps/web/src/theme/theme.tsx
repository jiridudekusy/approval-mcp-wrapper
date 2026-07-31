import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'approval-mcp.theme';

export function selectTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

interface ThemeValue { theme: Theme; toggle(): void }
const ThemeContext = createContext<ThemeValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => selectTheme(
    globalThis.localStorage?.getItem(STORAGE_KEY) ?? null,
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  ));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  const value = useMemo<ThemeValue>(() => ({
    theme,
    toggle() {
      setTheme((current) => {
        const next = current === 'dark' ? 'light' : 'dark';
        globalThis.localStorage?.setItem(STORAGE_KEY, next);
        return next;
      });
    },
  }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === undefined) throw new Error('ThemeProvider is missing');
  return value;
}
