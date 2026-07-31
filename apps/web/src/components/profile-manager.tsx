import { useEffect, useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import { Icon } from './icon.js';
import type { ToolCatalogView } from './tool-catalog.js';
import { runProfileMutation } from './profile-manager-actions.js';
import { ProfileMatrix, type ProfileRuleView, type RuleOutcome } from './profile-matrix.js';

export interface ProfileView { id: string; name: string; isDefault: boolean; ruleCount: number; tokenCount: number; version: number }
export interface ProfileTokenView { id: string; label: string; profileIds: string[]; revokedAt?: string }

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

export function ProfileManager({ mode, csrfToken, profiles, tokens, upstreams, onChanged }: {
  mode: 'agents' | 'profiles';
  csrfToken: string;
  profiles: readonly ProfileView[];
  tokens: readonly ProfileTokenView[];
  upstreams: readonly { id: string; alias: string }[];
  onChanged(): void;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState('');
  const [rules, setRules] = useState<ProfileRuleView[]>([]);
  const [catalogs, setCatalogs] = useState<Record<string, ToolCatalogView | undefined>>({});
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
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
    let active = true;
    void api<ProfileRuleView[]>(`/api/admin/profiles/${selectedProfile.id}/rules`).then((value) => { if (active) setRules(value); });
    return () => { active = false; };
  }, [selectedProfile?.id]);
  useEffect(() => {
    let active = true;
    void Promise.all(upstreams.map(async (upstream) => {
      try { return [upstream.id, await api<ToolCatalogView>(`/api/admin/upstreams/${upstream.id}/tools`)] as const; }
      catch { return [upstream.id, undefined] as const; }
    })).then((entries) => { if (active) setCatalogs(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [upstreamKey]);

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

  if (mode === 'agents') return <div className="agent-list">
    {tokens.map((token) => {
      const assignedIds = assignments[token.id] ?? token.profileIds;
      const assigned = profiles.filter((profile) => assignedIds.includes(profile.id));
      return <article className={`agent-row${token.revokedAt ? ' revoked' : ''}`} key={token.id}>
        <span className="agent-avatar"><Icon name="account-key" size={20} /></span>
        <div className="agent-identity"><strong>{token.label}</strong>{token.revokedAt && <small className="neutral-badge">{t('access.revoked')}</small>}<code title={token.id}>{token.id.length > 18 ? `${token.id.slice(0, 12)}…${token.id.slice(-5)}` : token.id}</code></div>
        <div className="profile-chips">{assigned.length > 0 ? assigned.map((profile) => <span key={profile.id}><Icon name="shield-account" />{profile.name}</span>) : <span className="implicit-chip">{defaultProfile?.name ?? t('profiles.default')} ({t('profiles.default')})</span>}</div>
        <button className="secondary-button" type="button" disabled={token.revokedAt !== undefined} onClick={() => setEditingAgent(editingAgent === token.id ? undefined : token.id)}>{editingAgent === token.id ? t('common.done') : t('profiles.editAssignments')}</button>
        {editingAgent === token.id && <div className="agent-profile-editor"><strong>{t('profiles.assignedProfiles')}</strong>{assignmentError && <p className="error-inline" role="alert">{t('profiles.assignmentFailed')}</p>}<div>{profiles.filter((profile) => !profile.isDefault).map((profile) => { const key = `${token.id}:${profile.id}`; return <label key={profile.id}><input type="checkbox" disabled={assignmentBusy.has(key)} checked={assignedIds.includes(profile.id)} onChange={(event) => void toggleAssignment(token, profile.id, event.target.checked)} />{profile.name}<small>{profile.ruleCount} {t('profiles.rules')}</small></label>; })}</div><p>{t('profiles.precedence')}</p></div>}
      </article>;
    })}
  </div>;

  const counts = effectiveOutcomeCounts(upstreams, catalogs, rules);
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
      {selectedProfile.isDefault && <p className="info-line"><Icon name="info" />{t('profiles.defaultExplanation')}</p>}
      {rules.length === 0 && <p className="info-banner"><Icon name="info" />{t('profiles.noRules')}</p>}
      {confirmDelete && <div className="delete-profile-confirm" role="alertdialog"><div><strong>{t('profiles.remove')} “{selectedProfile.name}”?</strong><p>{selectedProfile.ruleCount} {t('profiles.rules')} · {selectedProfile.tokenCount} {t('profiles.agents')}</p></div><button type="button" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button><button className="danger-button" type="button" disabled={busy} onClick={() => void mutate(async () => { await api(`/api/admin/profiles/${selectedProfile.id}`, { method: 'DELETE', body: JSON.stringify({ version: selectedProfile.version }) }, csrfToken); setSelectedId(defaultProfile?.id ?? ''); setConfirmDelete(false); }, false)}>{t('profiles.remove')}</button></div>}
      <ProfileMatrix key={selectedProfile.id} upstreams={upstreams} catalogs={catalogs} rules={rules} busy={busy} onSetRule={(upstreamId, toolName, outcome) => void mutate(() => api(`/api/admin/profiles/${selectedProfile.id}/rules`, { method: 'PUT', body: JSON.stringify({ upstreamId, ...(toolName ? { toolName } : {}), outcome }) }, csrfToken))} onSetRules={(upstreamId, toolNames, outcome) => mutate(() => api(`/api/admin/profiles/${selectedProfile.id}/rules/bulk`, { method: 'PUT', body: JSON.stringify({ upstreamId, toolNames, outcome }) }, csrfToken))} onRemoveRule={(rule) => void mutate(() => api(`/api/admin/profile-rules/${rule.id}`, { method: 'DELETE' }, csrfToken))} />
    </div>}
  </div>;
}
