import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import { useDialogLifecycle } from '../hooks/use-dialog-lifecycle.js';
import {
  CallPresentation,
  localizedMessage,
  type CallPresentationView,
} from './call-presentation.js';

interface TimelineEvent {
  eventId: string;
  timestamp: string;
  type: string;
  reasonCode?: string;
  latencyMs?: number;
  payload?: unknown;
  presentation?: CallPresentationView;
  denialReason?: string;
}

interface TimelineResult {
  tokenLabel?: string;
  upstreamAlias?: string;
  events: TimelineEvent[];
}

export function CallTimeline({
  callId,
  revision,
  onClose,
}: {
  callId: string;
  revision: number;
  onClose(): void;
}) {
  const { t, locale, formatDate, formatNumber } = useI18n();
  const [timeline, setTimeline] = useState<TimelineResult>({ events: [] });
  const drawerRef = useDialogLifecycle<HTMLElement>(true, onClose);
  useEffect(() => {
    let active = true;
    void api<TimelineResult>(
      `/api/admin/history/${encodeURIComponent(callId)}`,
    ).then((result) => {
      if (active) setTimeline(result);
    });
    return () => {
      active = false;
    };
  }, [callId, revision]);
  const presentation = timeline.events.find(
    (event) => event.presentation !== undefined,
  )?.presentation;
  return (
    <div className="detail-backdrop timeline-backdrop">
      <section ref={drawerRef} className="approval-detail timeline-drawer" role="dialog" aria-modal="true" aria-labelledby="timeline-title">
        <header><div><p className="eyebrow">{t('history.callId')}: {callId}</p><h2 id="timeline-title">{presentation === undefined ? t('history.timeline') : localizedMessage(presentation.title, locale)}</h2></div><button className="close" aria-label={t('common.close')} onClick={onClose}>×</button></header>
        <dl className="approval-meta">
          <div><dt>{t('approval.agent')}</dt><dd>{timeline.tokenLabel ?? t('common.unknownAgent')}</dd></div>
          <div><dt>{t('approval.upstream')}</dt><dd>{timeline.upstreamAlias ?? t('common.unknownUpstream')}</dd></div>
        </dl>
        {presentation !== undefined && <CallPresentation presentation={presentation} />}
        <ol className="timeline">
          {timeline.events.map((event) => (
            <li key={event.eventId}>
              <i />
              <div><strong>{event.type}</strong><time>{formatDate(event.timestamp)}</time>{event.reasonCode && <p>{event.reasonCode}</p>}{event.denialReason && <p className="timeline-denial-reason"><strong>{t('history.denialReason')}:</strong> {event.denialReason}</p>}{event.latencyMs !== undefined && <small>{formatNumber(event.latencyMs)} ms</small>}{event.payload !== undefined && <pre>{JSON.stringify(event.payload, null, 2)}</pre>}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
