import type { ReactNode } from 'react';
import { type Locale } from '../i18n/i18n.js';
export type Page = 'access' | 'history' | 'inbox' | 'system' | 'upstreams';
export declare function AppShell({ page, onNavigate, children, }: {
    page: Page;
    onNavigate(page: Page): void;
    children: ReactNode;
}): import("react").JSX.Element;
export declare function localePath(locale: Locale, page: Page): string;
//# sourceMappingURL=app-shell.d.ts.map