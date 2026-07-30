import { useEffect, useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import type { ToolCatalogView } from './tool-catalog.js';
import { runProfileMutation } from './profile-manager-actions.js';
import {
  ProfileMatrix,
  type ProfileRuleView,
  type RuleOutcome,
} from './profile-matrix.js';

export interface ProfileView {
  id: string;
  name: string;
  isDefault: boolean;
  ruleCount: number;
  tokenCount: number;
  version: number;
}

export interface ProfileTokenView {
  id: string;
  label: string;
  profileIds: string[];
}

export function ProfileManager({
  csrfToken,
  profiles,
  tokens,
  upstreams,
  onChanged,
}: {
  csrfToken: string;
  profiles: readonly ProfileView[];
  tokens: readonly ProfileTokenView[];
  upstreams: readonly { id: string; alias: string }[];
  onChanged(): void;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState('');
  const [rules, setRules] = useState<ProfileRuleView[]>([]);
  const [catalogs, setCatalogs] = useState<
    Record<string, ToolCatalogView | undefined>
  >();
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
  const upstreamKey = upstreams.map((upstream) => upstream.id).join('\u0000');

  useEffect(() => {
    if (selectedProfile === undefined) return;
    setSelectedId(selectedProfile.id);
    let active = true;
    void api<ProfileRuleView[]>(
        `/api/admin/profiles/${selectedProfile.id}/rules`,
      ).then((nextRules) => {
        if (active) setRules(nextRules);
      });
    return () => {
      active = false;
    };
  }, [selectedProfile?.id]);

  useEffect(() => {
    let active = true;
    void Promise.all(
        upstreams.map(async (upstream) => {
          try {
            return [
              upstream.id,
              await api<ToolCatalogView>(
                `/api/admin/upstreams/${upstream.id}/tools`,
              ),
            ] as const;
          } catch {
            return [upstream.id, undefined] as const;
          }
        }),
      ).then((entries) => {
      if (!active) return;
      setCatalogs(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [upstreamKey]);

  const reloadRules = async () => {
    if (selectedProfile === undefined) return;
    setRules(
      await api<ProfileRuleView[]>(
        `/api/admin/profiles/${selectedProfile.id}/rules`,
      ),
    );
  };

  const mutate = async (
    operation: () => Promise<unknown>,
    reloadAfter = true,
  ) => {
    setBusy(true);
    try {
      await runProfileMutation({
        operation,
        reloadRules: reloadAfter ? reloadRules : undefined,
        refreshProfiles: onChanged,
      });
    } finally {
      setBusy(false);
    }
  };

  const createProfile = async (event: FormEvent) => {
    event.preventDefault();
    const created = await api<ProfileView>(
      '/api/admin/profiles',
      { method: 'POST', body: JSON.stringify({ name: newName }) },
      csrfToken,
    );
    setNewName('');
    setSelectedId(created.id);
    onChanged();
  };

  const updateAssignments = async (
    token: ProfileTokenView,
    profileId: string,
    checked: boolean,
  ) => {
    await api(
      `/api/admin/tokens/${token.id}/profiles/${profileId}`,
      { method: 'PUT', body: JSON.stringify({ assigned: checked }) },
      csrfToken,
    );
    onChanged();
  };

  return (
    <section className="profile-manager">
      <div className="profile-heading">
        <div>
          <h2>{t('profiles.title')}</h2>
          <p>{t('profiles.subtitle')}</p>
        </div>
        <form onSubmit={(event) => void createProfile(event)}>
          <input
            required
            value={newName}
            placeholder={t('profiles.name')}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button type="submit">{t('profiles.add')}</button>
        </form>
      </div>

      <div className="profile-tabs">
        {profiles.map((profile) => (
          <button
            type="button"
            className={profile.id === selectedProfile?.id ? 'selected' : ''}
            key={profile.id}
            onClick={() => setSelectedId(profile.id)}
          >
            {profile.name}
            {profile.isDefault && <small>{t('profiles.default')}</small>}
          </button>
        ))}
      </div>

      {selectedProfile !== undefined && (
        <>
          <div className="profile-actions">
            <span>
              {selectedProfile.ruleCount} {t('profiles.rules')} ·{' '}
              {selectedProfile.tokenCount} {t('profiles.agents')}
            </span>
            {!selectedProfile.isDefault && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      api(
                        `/api/admin/profiles/${selectedProfile.id}`,
                        {
                          method: 'PUT',
                          body: JSON.stringify({
                            version: selectedProfile.version,
                            isDefault: true,
                          }),
                        },
                        csrfToken,
                      ),
                    )}
                >
                  {t('profiles.makeDefault')}
                </button>
                <button
                  className="danger-link"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void mutate(
                      async () => {
                        await api(
                          `/api/admin/profiles/${selectedProfile.id}`,
                          {
                            method: 'DELETE',
                            body: JSON.stringify({
                              version: selectedProfile.version,
                            }),
                          },
                          csrfToken,
                        );
                        setSelectedId('');
                      },
                      false,
                    );
                  }}
                >
                  {t('profiles.remove')}
                </button>
              </>
            )}
          </div>
          <ProfileMatrix
            upstreams={upstreams}
            catalogs={catalogs ?? {}}
            rules={rules}
            busy={busy}
            onSetRule={(upstreamId, toolName, outcome) =>
              void mutate(() =>
                api(
                  `/api/admin/profiles/${selectedProfile.id}/rules`,
                  {
                    method: 'PUT',
                    body: JSON.stringify({
                      upstreamId,
                      ...(toolName === undefined ? {} : { toolName }),
                      outcome,
                    }),
                  },
                  csrfToken,
                ),
              )}
            onSetRules={(upstreamId, toolNames, outcome) =>
              void mutate(() =>
                api(
                  `/api/admin/profiles/${selectedProfile.id}/rules/bulk`,
                  {
                    method: 'PUT',
                    body: JSON.stringify({
                      upstreamId,
                      toolNames,
                      outcome,
                    }),
                  },
                  csrfToken,
                ),
              )}
            onRemoveRule={(rule) =>
              void mutate(() =>
                api(
                  `/api/admin/profile-rules/${rule.id}`,
                  { method: 'DELETE' },
                  csrfToken,
                ),
              )}
          />
        </>
      )}

      <h3>{t('profiles.assignments')}</h3>
      <p className="section-subtitle">{t('profiles.assignmentsHint')}</p>
      <div className="profile-assignments">
        {tokens.map((token) => (
          <article key={token.id}>
            <strong>{token.label}</strong>
            <div>
              {profiles.filter((profile) => !profile.isDefault).map((profile) => (
                <label key={profile.id}>
                  <input
                    type="checkbox"
                    checked={token.profileIds.includes(profile.id)}
                    onChange={(event) =>
                      void updateAssignments(
                        token,
                        profile.id,
                        event.target.checked,
                      )}
                  />
                  {profile.name}
                </label>
              ))}
              {token.profileIds.length === 0 && (
                <small>{t('profiles.usesDefault')}</small>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
