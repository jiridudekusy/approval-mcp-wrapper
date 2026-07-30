import { useState } from 'react';

import { useI18n } from '../i18n/i18n.js';
import type { ToolCatalogView } from './tool-catalog.js';

export type RuleOutcome = 'allow' | 'deny' | 'require_approval';

export interface ProfileRuleView {
  id: string;
  profileId: string;
  upstreamId: string;
  toolName?: string;
  outcome: RuleOutcome;
}

const outcomes: readonly RuleOutcome[] = [
  'deny',
  'require_approval',
  'allow',
];

function outcomeLabel(
  t: ReturnType<typeof useI18n>['t'],
  outcome: RuleOutcome,
): string {
  if (outcome === 'allow') return t('profiles.outcomeAllow');
  if (outcome === 'deny') return t('profiles.outcomeDeny');
  return t('profiles.outcomeApproval');
}

function OutcomeSelect({
  value,
  inherited,
  disabled,
  onChange,
}: {
  value: RuleOutcome | '';
  inherited?: RuleOutcome;
  disabled: boolean;
  onChange(value: RuleOutcome | ''): void;
}) {
  const { t } = useI18n();
  return (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) =>
        onChange(event.target.value as RuleOutcome | '')
      }
    >
      <option value="">
        {inherited === undefined
          ? t('profiles.unconfigured')
          : `${t('profiles.inherit')} (${outcomeLabel(t, inherited)})`}
      </option>
      {outcomes.map((outcome) => (
        <option key={outcome} value={outcome}>
          {outcomeLabel(t, outcome)}
        </option>
      ))}
    </select>
  );
}

export function ProfileMatrix({
  upstreams,
  catalogs,
  rules,
  busy,
  onSetRule,
  onSetRules,
  onRemoveRule,
}: {
  upstreams: readonly { id: string; alias: string }[];
  catalogs: Readonly<Record<string, ToolCatalogView | undefined>>;
  rules: readonly ProfileRuleView[];
  busy: boolean;
  onSetRule(
    upstreamId: string,
    toolName: string | undefined,
    outcome: RuleOutcome,
  ): void;
  onSetRules(
    upstreamId: string,
    toolNames: readonly string[],
    outcome: RuleOutcome | 'inherit',
  ): void;
  onRemoveRule(rule: ProfileRuleView): void;
}) {
  const { t, formatNumber } = useI18n();
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  return (
    <div className="profile-matrix">
      {upstreams.map((upstream) => {
        const serverRule = rules.find(
          (rule) =>
            rule.upstreamId === upstream.id && rule.toolName === undefined,
        );
        const query = queries[upstream.id] ?? '';
        const tools = (catalogs[upstream.id]?.tools ?? []).filter((tool) =>
          tool.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        );
        const selectedNames = selected[upstream.id] ?? new Set<string>();
        return (
          <details open key={upstream.id} className="profile-server">
            <summary>
              <strong>{upstream.alias}</strong>
              <span>{formatNumber(catalogs[upstream.id]?.tools.length ?? 0)} {t('profiles.tools')}</span>
            </summary>
            <div className="server-default">
              <label>
                {t('profiles.allTools')}
                <OutcomeSelect
                  disabled={busy}
                  value={serverRule?.outcome ?? ''}
                  onChange={(value) => {
                    if (value === '') {
                      if (serverRule !== undefined) onRemoveRule(serverRule);
                    } else {
                      onSetRule(upstream.id, undefined, value);
                    }
                  }}
                />
              </label>
              <input
                type="search"
                value={query}
                placeholder={t('profiles.searchTools')}
                onChange={(event) =>
                  setQueries((current) => ({
                    ...current,
                    [upstream.id]: event.target.value,
                  }))
                }
              />
            </div>
            <div className="bulk-tools">
              <label>
                <input
                  type="checkbox"
                  checked={
                    tools.length > 0 &&
                    tools.every((tool) => selectedNames.has(tool.name))
                  }
                  onChange={(event) =>
                    setSelected((current) => ({
                      ...current,
                      [upstream.id]: event.target.checked
                        ? new Set(tools.map((tool) => tool.name))
                        : new Set(),
                    }))
                  }
                />
                {t('profiles.selectVisible')}
              </label>
              <label>
                {t('profiles.bulkAction')}
                <select
                  disabled={busy || selectedNames.size === 0}
                  value=""
                  onChange={(event) => {
                    onSetRules(
                      upstream.id,
                      [...selectedNames],
                      event.target.value === '__inherit'
                        ? 'inherit'
                        : event.target.value as RuleOutcome,
                    );
                    setSelected((current) => ({
                      ...current,
                      [upstream.id]: new Set(),
                    }));
                  }}
                >
                  <option value="">{t('profiles.chooseAction')}</option>
                  <option value="deny">{t('profiles.outcomeDeny')}</option>
                  <option value="require_approval">{t('profiles.outcomeApproval')}</option>
                  <option value="allow">{t('profiles.outcomeAllow')}</option>
                  <option value="__inherit">{t('profiles.inherit')}</option>
                </select>
              </label>
            </div>
            <div className="profile-tools">
              {tools.map((tool) => {
                const rule = rules.find(
                  (candidate) =>
                    candidate.upstreamId === upstream.id &&
                    candidate.toolName === tool.name,
                );
                return (
                  <div key={tool.name}>
                    <input
                      aria-label={`${t('profiles.select')} ${tool.name}`}
                      type="checkbox"
                      checked={selectedNames.has(tool.name)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current[upstream.id] ?? []);
                          if (event.target.checked) next.add(tool.name);
                          else next.delete(tool.name);
                          return { ...current, [upstream.id]: next };
                        })
                      }
                    />
                    <code>{tool.name}</code>
                    <OutcomeSelect
                      disabled={busy}
                      value={rule?.outcome ?? ''}
                      {...(serverRule === undefined
                        ? {}
                        : { inherited: serverRule.outcome })}
                      onChange={(value) => {
                        if (value === '') {
                          if (rule !== undefined) onRemoveRule(rule);
                        } else {
                          onSetRule(upstream.id, tool.name, value);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
