import { useState, type FormEvent } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import type { ToolView } from './tool-catalog.js';

export function PolicyEditor({
  csrfToken,
  tokenId,
  upstreamId,
  tools,
  onCreated,
}: {
  csrfToken: string;
  tokenId: string;
  upstreamId: string;
  tools: readonly ToolView[] | undefined;
  onCreated(): void;
}) {
  const { t } = useI18n();
  const [toolName, setToolName] = useState('');
  const [outcome, setOutcome] = useState('require_approval');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await api('/api/admin/policies', {
      method: 'POST',
      body: JSON.stringify({
        clientTokenId: tokenId,
        upstreamId,
        toolName,
        outcome,
        predicates: [],
      }),
    }, csrfToken);
    setToolName('');
    onCreated();
  }
  return (
    <form className="inline-form policy-form" onSubmit={(event) => void submit(event)}>
      <label>
        {t('access.toolName')}
        {tools !== undefined && tools.length > 0 ? (
          <select
            required
            value={toolName}
            onChange={(event) => setToolName(event.target.value)}
          >
            <option value="">{t('access.selectTool')}</option>
            {tools.map((tool) => (
              <option key={tool.name} value={tool.name}>{tool.name}</option>
            ))}
          </select>
        ) : (
          <input
            required
            value={toolName}
            onChange={(event) => setToolName(event.target.value)}
          />
        )}
      </label>
      <label>{t('access.outcome')}<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="deny">deny</option><option value="require_approval">require approval</option><option value="allow">allow</option></select></label>
      <button type="submit">{t('common.add')}</button>
    </form>
  );
}
