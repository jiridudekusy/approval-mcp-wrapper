import { useI18n } from '../i18n/i18n.js';

export interface ToolView {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ToolCatalogView {
  upstreamId: string;
  refreshedAt: string;
  tools: readonly ToolView[];
}

export function ToolCatalogPanel({
  tools,
  loading,
  error,
  onDiscover,
}: {
  tools: readonly ToolView[] | undefined;
  loading: boolean;
  error: string | undefined;
  onDiscover(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="tool-catalog">
      <div className="tool-catalog-heading">
        <strong>{t('upstreams.tools')}</strong>
        <button
          className="text-button compact"
          type="button"
          disabled={loading}
          onClick={onDiscover}
        >
          {loading ? t('upstreams.discovering') : t('upstreams.discover')}
        </button>
      </div>
      {error !== undefined && (
        <p className="catalog-error">{t('upstreams.discoveryFailed')}</p>
      )}
      {tools !== undefined && tools.length === 0 && (
        <p className="catalog-empty">{t('upstreams.noTools')}</p>
      )}
      {tools?.map((tool) => (
        <details className="tool-row" key={tool.name}>
          <summary>
            <code>{tool.name}</code>
            {tool.description !== undefined && <span>{tool.description}</span>}
          </summary>
          <h3>{t('upstreams.inputSchema')}</h3>
          <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
          {tool.outputSchema !== undefined && (
            <>
              <h3>{t('upstreams.outputSchema')}</h3>
              <pre>{JSON.stringify(tool.outputSchema, null, 2)}</pre>
            </>
          )}
        </details>
      ))}
    </div>
  );
}
