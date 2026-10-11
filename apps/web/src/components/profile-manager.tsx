import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import { Icon } from './icon.js';
import type { ToolCatalogView } from './tool-catalog.js';
import { runProfileMutation } from './profile-manager-actions.js';
import { ProfileMatrix, type ProfileRuleView, type RuleOutcome } from './profile-matrix.js';

export interface ProfileView { id: string; name: string; isDefault: boolean; approvalTimeoutSeconds: number; toolCallTimeoutSeconds: number; ruleCount: number; tokenCount: number; version: number }
export interface ProfileTokenView { id: string; label: string; version: number; profileIds: string[]; canManageApprovalMcp?: boolean; revokedAt?: string }

export function effectiveOutcomeCounts(upstreams: readonly { id: string }[], catalogs: Readonly<Record<string, ToolCatalogView | undefined>>, rules: readonly ProfileRuleView[]) {
  const counts = { allow: 0, deny: 0, require_approval: 0 };
  for (const upstream of upstreams) {
    const serverRule = rules.find((rule) => rule.upstreamId === upstream.id && rule.toolName === undefined);
    for (const tool of catalogs[upstream.id]?.tools ?? []) {
      const effective = rules.find((rule) => rule.upstreamId === upstream.id && rule.toolName === tool.name)?.outcome ?? serverRule?.outcome;
      if (effective !== undefined) counts[effective] += 1;
    }
  }
  return counts;
}

export function ProfileManager({ mode, csrfToken, profiles, tokens, upstreams, onChanged, onTokenRotated }: {
  mode: 'agents' | 'profiles';
  csrfToken: string;
  profiles: readonly ProfileView[];
  tokens: readonly ProfileTokenView[];
  upstreams: readonly { id: string; alias: string; displayName?: string }[];
  onChanged(): void;
  onTokenRotated?(plaintext: string): void;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState('');
  const [rules, setRules] = useState<ProfileRuleView[]>([]);
  const [catalogs, setCatalogs] = useState<Record<string, ToolCatalogView | undefined>>({});
  const [refreshingCatalogs, setRefreshingCatalogs] = useState(false);
  const catalogRefreshInFlight = useRef(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string>();
  const [agentDraft, setAgentDraft] = useState<{ label: string; canManageApprovalMcp: boolean }>();
  const [confirmRotateAgent, setConfirmRotateAgent] = useState<string>();
  const [confirmDeleteAgent, setConfirmDeleteAgent] = useState<string>();
  const [agentActionBusy, setAgentActionBusy] = useState<string>();
  const [agentActionError, setAgentActionError] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [approvalTimeoutDraft, setApprovalTimeoutDraft] = useState('60');
  const [timeoutDraft, setTimeoutDraft] = useState('60');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [assignmentBusy, setAssignmentBusy] = useState<Set<string>>(new Set());
  const [assignmentError, setAssignmentError] = useState(false);
  const selectedProfile = profiles.find((profile) => profile.id === selectedId) ?? profiles.find((profile) => profile.isDefault) ?? profiles[0];
  const defaultProfile = profiles.find((profile) => profile.isDefault);
  const upstreamKey = upstreams.map((upstream) => upstream.id).join('\0');

  useEffect(() => setAssignments(Object.fromEntries(tokens.map((token) => [token.id, [...token.profileIds]]))), [tokens]);

  useEffect(() => {
    if (!selectedProfile) return;
    setSelectedId(selectedProfile.id);
    setRenameDraft(selectedProfile.name);
    setApprovalTimeoutDraft(String(selectedProfile.approvalTimeoutSeconds));
    setTimeoutDraft(String(selectedProfile.toolCallTimeoutSeconds));
    let active = true;
    void api<ProfileRuleView[]>(`/api/admin/profiles/${selectedProfile.id}/rules`).then((value) => { if (active) setRules(value); });
    return () => { active = false; };
  }, [selectedProfile?.id, selectedProfile?.name, selectedProfile?.approvalTimeoutSeconds, selectedProfile?.toolCallTimeoutSeconds]);
  const refreshCatalogs = useCallback(async () => {
    if (catalogRefreshInFlight.current) return;
    catalogRefreshInFlight.current = true;
    setRefreshingCatalogs(true);
    try {
      const entries = await Promise.all(upstreams.map(async (upstream) => {
      try { return [upstream.id, await api<ToolCatalogView>(upstream.id === 'approval-mcp-self' ? '/api/admin/self/tools' : `/api/admin/upstreams/${upstream.id}/tools`)] as const; }
      catch { return [upstream.id, undefined] as const; }
      }));
      setCatalogs((current) => Object.fromEntries(entries.map(([id, catalog]) => [id, catalog ?? current[id]])));
    } finally {
      catalogRefreshInFlight.current = false;
      setRefreshingCatalogs(false);
    }
  }, [upstreamKey]);
  useEffect(() => {
    void refreshCatalogs();
    const timer = setInterval(() => { void refreshCatalogs(); }, 30_000);
    return () => clearInterval(timer);
  }, [refreshCatalogs]);

  const reloadRules = async () => { if (selectedProfile) setRules(await api<ProfileRuleView[]>(`/api/admin/profiles/${selectedProfile.id}/rules`)); };
  const mutate = async (operation: () => Promise<unknown>, reload = true) => {
    setBusy(true);
    try { await runProfileMutation({ operation, reloadRules: reload ? reloadRules : undefined, refreshProfiles: onChanged }); }
    finally { setBusy(false); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const profile = await api<ProfileView>('/api/admin/profiles', { method: 'POST', body: JSON.stringify({ name: newName }) }, csrfToken);
    setNewName(''); setSelectedId(profile.id); onChanged();
  };
  const toggleAssignment = async (token: ProfileTokenView, profileId: string, assigned: boolean) => {
    const key = `${token.id}:${profileId}`;
    const previous = assignments[token.id] ?? token.profileIds;
    const next = assigned ? [...new Set([...previous, profileId])] : previous.filter((id) => id !== profileId);
    setAssignmentError(false); setAssignments((current) => ({ ...current, [token.id]: next })); setAssignmentBusy((current) => new Set(current).add(key));
    try { await api(`/api/admin/tokens/${token.id}/profiles/${profileId}`, { method: 'PUT', body: JSON.stringify({ assigned }) }, csrfToken); onChanged(); }
    catch { setAssignments((current) => ({ ...current, [token.id]: previous })); setAssignmentError(true); }
    finally { setAssignmentBusy((current) => { const updated = new Set(current); updated.delete(key); return updated; }); }
  };
  const saveAgent = async (token: ProfileTokenView, event: FormEvent) => {
    event.preventDefault();
    if (agentDraft === undefined) return;
    setAgentActionBusy(token.id); setAgentActionError(undefined);
    try {
      await api(`/api/admin/tokens/${token.id}`, { method: 'PUT', body: JSON.stringify({ version: token.version, ...agentDraft }) }, csrfToken);
      setEditingAgent(undefined); onChanged();
    } catch { setAgentActionError(token.id); }
    finally { setAgentActionBusy(undefined); }
  };
  const rotateAgent = async (token: ProfileTokenView) => {
    setAgentActionBusy(token.id); setAgentActionError(undefined);
    try {
      const result = await api<{ plaintext: string }>(`/api/admin/tokens/${token.id}/rotate`, { method: 'POST', body: JSON.stringify({ version: token.version }) }, csrfToken);
      onTokenRotated?.(result.plaintext); setConfirmRotateAgent(undefined); onChanged();
    } catch { setAgentActionError(token.id); }
    finally { setAgentActionBusy(undefined); }
  };
  const deleteAgent = async (token: ProfileTokenView) => {
    setAgentActionBusy(token.id); setAgentActionError(undefined);
    try {
      await api(`/api/admin/tokens/${token.id}`, { method: 'DELETE', body: JSON.stringify({ version: token.version }) }, csrfToken);
      setConfirmDeleteAgent(undefined); setEditingAgent(undefined); onChanged();
    } catch { setAgentActionError(token.id); }
    finally { setAgentActionBusy(undefined); }
  };

  if (mode === 'agents') return <div className="agent-list">
    {tokens.map((token) => {
      const assignedIds = assignments[token.id] ?? token.profileIds;
      const assigned = profiles.filter((profile) => assignedIds.includes(profile.id));
      return <article className={`agent-row${token.revokedAt ? ' revoked' : ''}`} key={token.id}>
        <span className="agent-avatar"><Icon name="account-key" size={20} /></span>
        <div className="agent-identity"><strong>{token.label}</strong>{token.canManageApprovalMcp && <small className="neutral-badge">{t('access.managerBadge')}</small>}{token.revokedAt && <small className="neutral-badge">{t('access.revoked')}</small>}<code title={token.id}>{token.id.length > 18 ? `${token.id.slice(0, 12)}…${token.id.slice(-5)}` : token.id}</code></div>
        <div className="profile-chips">{assigned.length > 0 ? assigned.map((profile) => <span key={profile.id}><Icon name="shield-account" />{profile.name}</span>) : <span className="implicit-chip">{defaultProfile?.name ?? t('profiles.default')} ({t('profiles.default')})</span>}</div>
        <div className="agent-actions"><button className="secondary-button" type="button" disabled={agentActionBusy === token.id} onClick={() => { setEditingAgent(editingAgent === token.id ? undefined : token.id); setAgentDraft({ label: token.label, canManageApprovalMcp: token.canManageApprovalMcp === true }); setConfirmRotateAgent(undefined); setConfirmDeleteAgent(undefined); }}>{editingAgent === token.id ? t('common.done') : t('access.editAgent')}</button><button className="secondary-button" type="button" disabled={token.revokedAt !== undefined || agentActionBusy === token.id} onClick={() => { setConfirmRotateAgent(token.id); setConfirmDeleteAgent(undefined); setEditingAgent(undefined); }}>{t('access.rotateToken')}</button><button className="danger-link" type="button" disabled={agentActionBusy === token.id} onClick={() => { setConfirmDeleteAgent(token.id); setConfirmRotateAgent(undefined); setEditingAgent(undefined); }}>{t('access.deleteAgent')}</button></div>
        {agentActionError === token.id && <p className="agent-action-error error-inline" role="alert">{t('access.agentActionFailed')}</p>}
        {editingAgent === token.id && agentDraft && <div className="agent-profile-editor"><form className="agent-details-form" onSubmit={(event) => void saveAgent(token, event)}><label>{t('access.tokenLabel')}<input required maxLength={120} value={agentDraft.label} onChange={(event) => setAgentDraft((current) => current && { ...current, label: event.target.value })} /></label><label className="agent-manager-toggle"><input type="checkbox" checked={agentDraft.canManageApprovalMcp} onChange={(event) => setAgentDraft((current) => current && { ...current, canManageApprovalMcp: event.target.checked })} />{t('access.managerToken')}</label><button className="primary compact" type="submit" disabled={agentActionBusy === token.id || agentDraft.label.trim() === ''}>{t('common.save')}</button></form><strong>{t('profiles.assignedProfiles')}</strong>{assignmentError && <p className="error-inline" role="alert">{t('profiles.assignmentFailed')}</p>}<div>{profiles.filter((profile) => !profile.isDefault).map((profile) => { const key = `${token.id}:${profile.id}`; return <label key={profile.id}><input type="checkbox" disabled={assignmentBusy.has(key)} checked={assignedIds.includes(profile.id)} onChange={(event) => void toggleAssignment(token, profile.id, event.target.checked)} />{profile.name}<small>{profile.ruleCount} {t('profiles.rules')}</small></label>; })}</div><p>{t('profiles.precedence')}</p></div>}
        {confirmRotateAgent === token.id && <div className="agent-confirm" role="alertdialog" aria-label={t('access.rotateToken')}><strong>{t('access.rotateToken')} — {token.label}?</strong><p>{t('access.rotateWarning')}</p><div><button type="button" onClick={() => setConfirmRotateAgent(undefined)}>{t('common.cancel')}</button><button className="primary compact" type="button" disabled={agentActionBusy === token.id} onClick={() => void rotateAgent(token)}>{t('access.rotateToken')}</button></div></div>}
        {confirmDeleteAgent === token.id && <div className="agent-confirm delete-confirmation" role="alertdialog" aria-label={t('access.deleteAgent')}><strong>{t('access.deleteAgent')} — {token.label}?</strong><p>{t('access.deleteAgentWarning')}</p><div><button type="button" onClick={() => setConfirmDeleteAgent(undefined)}>{t('common.cancel')}</button><button className="danger-button" type="button" disabled={agentActionBusy === token.id} onClick={() => void deleteAgent(token)}>{t('access.deleteAgent')}</button></div></div>}
      </article>;
    })}
  </div>;

  const counts = effectiveOutcomeCounts(upstreams, catalogs, rules);
  const approvalTimeoutSeconds = Number(approvalTimeoutDraft);
  const approvalTimeoutValid = approvalTimeoutDraft.trim() !== '' &&
    Number.isInteger(approvalTimeoutSeconds) &&
    approvalTimeoutSeconds >= 1 &&
    approvalTimeoutSeconds <= 86_400;
  const timeoutSeconds = Number(timeoutDraft);
  const timeoutValid = timeoutDraft.trim() !== '' &&
    Number.isInteger(timeoutSeconds) &&
    timeoutSeconds >= 1 &&
    timeoutSeconds <= 86_400;
  return <div className="profile-editor-layout">
    <aside className="profile-rail">
      <div className="profile-list">{profiles.map((profile) => <button type="button" className={profile.id === selectedProfile?.id ? 'selected' : ''} key={profile.id} onClick={() => { setSelectedId(profile.id); setRenaming(false); setConfirmDelete(false); }}><span>{profile.name}{profile.isDefault && <small>{t('profiles.default')}</small>}</span><em>{profile.ruleCount} {t('profiles.rules')} · {profile.tokenCount} {t('profiles.agents')}</em></button>)}</div>
      <form onSubmit={(event) => void create(event)}><input required value={newName} placeholder={t('profiles.name')} onChange={(event) => setNewName(event.target.value)} /><button type="submit" aria-label={t('profiles.add')}><Icon name="plus-circle" /></button></form>
    </aside>
    {selectedProfile && <div className="profile-detail">
      <header className="profile-detail-header">
        <div>{renaming ? <div className="rename-form"><input value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} /><button type="button" disabled={busy || renameDraft.trim() === ''} onClick={() => void mutate(() => api(`/api/admin/profiles/${selectedProfile.id}`, { method: 'PUT', body: JSON.stringify({ version: selectedProfile.version, name: renameDraft }) }, csrfToken)).then(() => setRenaming(false))}>{t('common.save')}</button><button type="button" onClick={() => setRenaming(false)}>{t('common.cancel')}</button></div> : <div className="profile-title"><h2>{selectedProfile.name}</h2>{selectedProfile.isDefault && <span>{t('profiles.default')}</span>}<button type="button" onClick={() => setRenaming(true)}>{t('profiles.rename')}</button></div>}
          <div className="summary-chips"><span className="allow"><Icon name="check-circle" />{counts.allow} {t('profiles.allowedShort')}</span><span className="require_approval"><Icon name="pending" />{counts.require_approval} {t('profiles.approvalShort')}</span><span className="deny"><Icon name="close-circle" />{counts.deny} {t('profiles.deniedShort')}</span><span className="override"><Icon name="settings" />{rules.filter((rule) => rule.toolName).length} {t('profiles.overridesShort')}</span></div>
        </div>
        {!selectedProfile.isDefault && <div className="profile-header-actions"><button type="button" disabled={busy} onClick={() => void mutate(() => api(`/api/admin/profiles/${selectedProfile.id}`, { method: 'PUT', body: JSON.stringify({ version: selectedProfile.version, isDefault: true }) }, csrfToken))}>{t('profiles.makeDefault')}</button><button className="danger-link" type="button" onClick={() => setConfirmDelete(true)}>{t('profiles.remove')}</button></div>}
      </header>
      <section className="profile-timeout-card">
        <div className="profile-timeout-copy"><span><Icon name="pending" size={20} /></span><div><strong>{t('profiles.timeouts')}</strong><small>{t('profiles.timeoutRange')}</small></div></div>
        <div className="profile-timeout-fields">
          <label><span><strong>{t('profiles.approvalTimeout')}</strong><small>{t('profiles.approvalTimeoutHint')}</small></span><span className="timeout-input"><input aria-label={t('profiles.approvalTimeout')} type="number" inputMode="numeric" min="1" max="86400" step="1" value={approvalTimeoutDraft} onChange={(event) => setApprovalTimeoutDraft(event.target.value)} /><em>{t('profiles.seconds')}</em></span></label>
          <label><span><strong>{t('profiles.toolTimeout')}</strong><small>{t('profiles.toolTimeoutHint')}</small></span><span className="timeout-input"><input aria-label={t('profiles.toolTimeout')} type="number" inputMode="numeric" min="1" max="86400" step="1" value={timeoutDraft} onChange={(event) => setTimeoutDraft(event.target.value)} /><em>{t('profiles.seconds')}</em></span></label>
        </div>
        <button className="primary compact" type="button" disabled={busy || !approvalTimeoutValid || !timeoutValid || (approvalTimeoutSeconds === selectedProfile.approvalTimeoutSeconds && timeoutSeconds === selectedProfile.toolCallTimeoutSeconds)} onClick={() => void mutate(() => api(`/api/admin/profiles/${selectedProfile.id}`, { method: 'PUT', body: JSON.stringify({ version: selectedProfile.version, approvalTimeoutSeconds, toolCallTimeoutSeconds: timeoutSeconds }) }, csrfToken))}>{t('common.save')}</button>
      </section>
      {selectedProfile.isDefault && <p className="info-line"><Icon name="info" />{t('profiles.defaultExplanation')}</p>}
      {rules.length === 0 && <p className="info-banner"><Icon name="info" />{t('profiles.noRules')}</p>}
      {confirmDelete && <div className="delete-profile-confirm" role="alertdialog"><div><strong>{t('profiles.remove')} “{selectedProfile.name}”?</strong><p>{selectedProfile.ruleCount} {t('profiles.rules')} · {selectedProfile.tokenCount} {t('profiles.agents')}</p></div><button type="button" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button><button className="danger-button" type="button" disabled={busy} onClick={() => void mutate(async () => { await api(`/api/admin/profiles/${selectedProfile.id}`, { method: 'DELETE', body: JSON.stringify({ version: selectedProfile.version }) }, csrfToken); setSelectedId(defaultProfile?.id ?? ''); setConfirmDelete(false); }, false)}>{t('profiles.remove')}</button></div>}
      <ProfileMatrix key={selectedProfile.id} upstreams={upstreams} catalogs={catalogs} rules={rules} busy={busy} refreshingCatalogs={refreshingCatalogs} onRefreshCatalogs={() => { void refreshCatalogs(); }} onSetRule={(upstreamId, toolName, outcome) => void mutate(() => api(`/api/admin/profiles/${selectedProfile.id}/rules`, { method: 'PUT', body: JSON.stringify({ upstreamId, ...(toolName ? { toolName } : {}), outcome }) }, csrfToken))} onSetRules={(upstreamId, toolNames, outcome) => mutate(() => api(`/api/admin/profiles/${selectedProfile.id}/rules/bulk`, { method: 'PUT', body: JSON.stringify({ upstreamId, toolNames, outcome }) }, csrfToken))} onRemoveRule={(rule) => void mutate(() => api(`/api/admin/profile-rules/${rule.id}`, { method: 'DELETE' }, csrfToken))} />
    </div>}
  </div>;
}
