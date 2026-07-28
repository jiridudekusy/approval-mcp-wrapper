import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { startAuthentication, startRegistration, } from '@simplewebauthn/browser';
import { useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { LanguageSwitch } from '../components/language-switch.js';
import { useI18n } from '../i18n/i18n.js';
export function Login({ onAuthenticated }) {
    const { t } = useI18n();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    async function login() {
        setBusy(true);
        setError(false);
        try {
            const options = await api('/api/auth/login/options', { method: 'POST' });
            const response = await startAuthentication({ optionsJSON: options });
            const result = await api('/api/auth/login/verify', { method: 'POST', body: JSON.stringify(response) });
            onAuthenticated(result.csrfToken);
        }
        catch (loginError) {
            if (loginError instanceof ApiError && loginError.status === 500) {
                try {
                    const options = await api('/api/auth/bootstrap/options', { method: 'POST' });
                    const response = await startRegistration({ optionsJSON: options });
                    const result = await api('/api/auth/bootstrap/verify', { method: 'POST', body: JSON.stringify(response) });
                    onAuthenticated(result.csrfToken);
                    return;
                }
                catch {
                    setError(true);
                }
            }
            else {
                setError(true);
            }
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsxs("main", { className: "login-page", children: [_jsxs("header", { className: "login-header", children: [_jsxs("div", { className: "brand", children: [_jsx("span", { className: "brand-mark", children: "A" }), _jsx("strong", { children: t('app.name') })] }), _jsx(LanguageSwitch, {})] }), _jsxs("section", { className: "login-panel", children: [_jsxs("div", { className: "login-copy", children: [_jsx("p", { className: "eyebrow", children: t('login.eyebrow') }), _jsx("h1", { children: t('login.title') }), _jsx("p", { children: t('login.description') })] }), _jsxs("div", { className: "login-card", children: [_jsx("div", { className: "passkey-orbit", "aria-hidden": "true", children: _jsx("span", { children: "\u2301" }) }), _jsx("button", { className: "primary", type: "button", onClick: login, disabled: busy, children: busy ? t('common.loading') : t('login.passkey') }), _jsx("button", { className: "text-button", type: "button", children: t('login.recovery') }), error && _jsx("p", { className: "error", role: "alert", children: t('login.failed') })] })] }), _jsx("footer", { children: t('status.secure') })] }));
}
//# sourceMappingURL=login.js.map