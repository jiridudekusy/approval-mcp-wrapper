import { useMemo, useState } from 'react';

import { useI18n } from '../i18n/i18n.js';
import { Icon } from './icon.js';
import type { ToolCatalogView } from './tool-catalog.js';

export type RuleOutcome = 'allow' | 'deny' | 'require_approval';
export interface ProfileRuleView { id: string; profileId: string; upstreamId: string; toolName?: string; outcome: RuleOutcome }
const outcomes: readonly RuleOutcome[] = ['deny', 'require_approval', 'allow'];

export function updateVisibleSelection(current: ReadonlySet<string>, visible: readonly string[], checked: boolean) {
  const next = new Set(current);
  for (const name of visible) checked ? next.add(name) : next.delete(name);
  return next;
}

function label(t: ReturnType<typeof useI18n>['t'], outcome: RuleOutcome) {
  if (outcome === 'allow') return t('profiles.outcomeAllow');
  if (outcome === 'deny') return t('profiles.outcomeDeny');
  return t('profiles.outcomeApproval');
}

function Segments({ value, compact = false, disabled, clearLabel, onChange }: {
  value: RuleOutcome | '';
  compact?: boolean;
  disabled: boolean;
  clearLabel: string;
  onChange(value: RuleOutcome | ''): void;
}) {
  const { t } = useI18n();
  return <div className={`outcome-segments${compact ? ' compact-segments' : ''}`}>
    <button type="button" title={clearLabel} aria-pressed={value === ''} disabled={disabled} onClick={() => onChange('')}>{compact ? '–' : t('profiles.notSet')}</button>
    {outcomes.map((outcome) => <button type="button" title={label(t, outcome)} aria-pressed={value === outcome} className={outcome} disabled={disabled} key={outcome} onClick={() => onChange(outcome)}>{compact ? (outcome === 'deny' ? '×' : outcome === 'allow' ? '✓' : '!') : outcome === 'require_approval' ? t('profiles.outcomeApprovalCompact') : label(t, outcome)}</button>)}
  </div>;
}

function StatePill({ outcome, inherited }: { outcome: RuleOutcome | undefined; inherited: boolean }) {
  const { t } = useI18n();
  if (outcome === undefined) return <span className="state-pill unavailable"><Icon name="eye" />{t('profiles.unconfigured')}</span>;
  const icon = outcome === 'allow' ? 'check-circle' : outcome === 'deny' ? 'close-circle' : 'pending';
  return <span className={`state-pill ${outcome}`}><Icon name={icon} />{label(t, outcome)}{inherited && <small> · {t('profiles.viaServer')}</small>}</span>;
}

export function ProfileMatrix({ upstreams, catalogs, rules, busy, onSetRule, onSetRules, onRemoveRule }: {
  upstreams: readonly { id: string; alias: string; displayName?: string }[];
  catalogs: Readonly<Record<string, ToolCatalogView | undefined>>;
  rules: readonly ProfileRuleView[];
  busy: boolean;
  onSetRule(upstreamId: string, toolName: string | undefined, outcome: RuleOutcome): void;
  onSetRules(upstreamId: string, toolNames: readonly string[], outcome: RuleOutcome | 'inherit'): Promise<void>;
  onRemoveRule(rule: ProfileRuleView): void;
}) {
  const { t, formatNumber } = useI18n();
  const [query, setQuery] = useState('');
  const [overriddenOnly, setOverriddenOnly] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState(false);
  const selectedCount = Object.values(selected).reduce((count, names) => count + names.size, 0);
  const visible = useMemo(() => Object.fromEntries(upstreams.map((upstream) => {
    const toolRules = new Set(rules.filter((rule) => rule.upstreamId === upstream.id && rule.toolName !== undefined).map((rule) => rule.toolName));
    const tools = (catalogs[upstream.id]?.tools ?? []).filter((tool) => tool.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (!overriddenOnly || toolRules.has(tool.name)));
    return [upstream.id, tools];
  })), [catalogs, overriddenOnly, query, rules, upstreams]);

  async function applyBulk(outcome: RuleOutcome | 'inherit') {
    const entry = Object.entries(selected).find(([, names]) => names.size > 0);
    if (entry === undefined) return;
    setBulkBusy(true); setBulkError(false);
    try { await onSetRules(entry[0], [...entry[1]], outcome); setSelected({}); }
    catch { setBulkError(true); }
    finally { setBulkBusy(false); }
  }

  return <div className="profile-matrix">
    <div className="profile-filter-bar">
      <label className="search-field"><Icon name="search" /><input type="search" value={query} placeholder={t('profiles.searchTools')} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="button" className="filter-toggle" aria-pressed={overriddenOnly} onClick={() => setOverriddenOnly((value) => !value)}><Icon name="filter" />{t('profiles.overriddenOnly')}</button>
      <button type="button" className="text-action" onClick={() => setExpanded(Object.fromEntries(upstreams.map((item) => [item.id, true])))}>{t('profiles.expandAll')}</button>
      <button type="button" className="text-action" onClick={() => setExpanded(Object.fromEntries(upstreams.map((item) => [item.id, false])))}>{t('profiles.collapseAll')}</button>
    </div>
    {upstreams.map((upstream) => {
      const serverRule = rules.find((rule) => rule.upstreamId === upstream.id && rule.toolName === undefined);
      const tools = visible[upstream.id] ?? [];
      const isOpen = query !== '' ? tools.length > 0 : (expanded[upstream.id] ?? true);
      const selectedNames = selected[upstream.id] ?? new Set<string>();
      const toolRules = rules.filter((rule) => rule.upstreamId === upstream.id && rule.toolName !== undefined);
      const counts = { allow: 0, deny: 0, require_approval: 0 };
      for (const tool of catalogs[upstream.id]?.tools ?? []) {
        const effective = toolRules.find((rule) => rule.toolName === tool.name)?.outcome ?? serverRule?.outcome;
        if (effective !== undefined) counts[effective] += 1;
      }
      return <section className="profile-server" key={upstream.id}>
        <div className="profile-server-header">
          <button type="button" className="server-toggle" aria-expanded={isOpen} onClick={() => setExpanded((current) => ({ ...current, [upstream.id]: !isOpen }))}><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} /><Icon name="database" /><span className="server-name"><strong>{upstream.displayName ?? upstream.alias}</strong>{upstream.displayName !== undefined && <code>{upstream.alias}</code>}</span><span>{formatNumber(catalogs[upstream.id]?.tools.length ?? 0)} {t('profiles.tools')}</span></button>
          <span className="server-summary">{counts.allow} {t('profiles.allowedShort')} · {counts.require_approval} {t('profiles.approvalShort')} · {counts.deny} {t('profiles.deniedShort')} · {toolRules.length} {t('profiles.overridesShort')}</span>
          <span className="all-tools-label">{t('profiles.allTools')}</span>
          <Segments value={serverRule?.outcome ?? ''} disabled={busy} clearLabel={t('profiles.notSet')} onChange={(value) => value === '' ? serverRule && onRemoveRule(serverRule) : onSetRule(upstream.id, undefined, value)} />
        </div>
        {isOpen && <div className="profile-server-body">
          <div className="select-strip"><label><input type="checkbox" checked={tools.length > 0 && tools.every((tool) => selectedNames.has(tool.name))} onChange={(event) => setSelected((current) => { const next = updateVisibleSelection(current[upstream.id] ?? new Set(), tools.map((tool) => tool.name), event.target.checked); return next.size === 0 ? {} : { [upstream.id]: next }; })} />{t('profiles.selectVisible')}</label><span>{tools.length} / {catalogs[upstream.id]?.tools.length ?? 0} {t('profiles.shown')}</span></div>
          {tools.length === 0 && <p className="catalog-empty profile-empty">{t('profiles.noTools')}</p>}
          {tools.map((tool) => {
            const rule = toolRules.find((candidate) => candidate.toolName === tool.name);
            const effective = rule?.outcome ?? serverRule?.outcome;
            return <div className={`profile-tool-row${rule ? ' overridden' : ''}`} key={tool.name}>
              <input aria-label={`${t('profiles.select')} ${tool.name}`} type="checkbox" checked={selectedNames.has(tool.name)} onChange={(event) => setSelected((current) => { const next = new Set(current[upstream.id] ?? []); event.target.checked ? next.add(tool.name) : next.delete(tool.name); return next.size === 0 ? {} : { [upstream.id]: next }; })} />
              <div className="tool-identity"><div><code>{tool.name}</code>{rule && <small className="override-badge">{t('profiles.override')}</small>}</div>{tool.description && <span title={tool.description}>{tool.description}</span>}</div>
              <StatePill outcome={effective} inherited={rule === undefined && serverRule !== undefined} />
              <Segments compact value={rule?.outcome ?? ''} disabled={busy} clearLabel={t('profiles.inherit')} onChange={(value) => value === '' ? rule && onRemoveRule(rule) : onSetRule(upstream.id, tool.name, value)} />
            </div>;
          })}
        </div>}
      </section>;
    })}
    {selectedCount > 0 && <div className="bulk-action-bar"><strong>{selectedCount} {t('profiles.tools')}</strong>{bulkError && <small role="alert">{t('profiles.bulkFailed')}</small>}<span />{outcomes.map((outcome) => <button className={outcome} type="button" disabled={busy || bulkBusy} key={outcome} onClick={() => void applyBulk(outcome)}>{label(t, outcome)}</button>)}<button type="button" disabled={busy || bulkBusy} onClick={() => void applyBulk('inherit')}>{t('profiles.clearRule')}</button><button className="icon-button" type="button" aria-label={t('profiles.clearSelection')} onClick={() => setSelected({})}><Icon name="close" /></button></div>}
  </div>;
}
