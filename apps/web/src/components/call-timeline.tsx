import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';
import { useDialogLifecycle } from '../hooks/use-dialog-lifecycle.js';

interface TimelineEvent {
  eventId: string;
  timestamp: string;
  type: string;
  reasonCode?: string;
  latencyMs?: number;
  payload?: unknown;
}

export function CallTimeline({
  callId,
  onClose,
}: {
  callId: string;
  onClose(): void;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const drawerRef = useDialogLifecycle<HTMLElement>(true, onClose);
  useEffect(() => {
    void api<{ events: TimelineEvent[] }>(
      `/api/admin/history/${encodeURIComponent(callId)}`,
    ).then((result) => setEvents(result.events));
  }, [callId]);
  return (
    <div className="detail-backdrop timeline-backdrop">
      <section ref={drawerRef} className="approval-detail timeline-drawer" role="dialog" aria-modal="true" aria-labelledby="timeline-title">
        <header><div><p className="eyebrow">{callId}</p><h2 id="timeline-title">{t('history.timeline')}</h2></div><button className="close" aria-label={t('common.close')} onClick={onClose}>×</button></header>
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.eventId}>
              <i />
              <div><strong>{event.type}</strong><time>{formatDate(event.timestamp)}</time>{event.reasonCode && <p>{event.reasonCode}</p>}{event.latencyMs !== undefined && <small>{formatNumber(event.latencyMs)} ms</small>}{event.payload !== undefined && <pre>{JSON.stringify(event.payload, null, 2)}</pre>}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
