import { useEffect, useState } from 'react';

import { api } from '../api/client.js';
import { useI18n } from '../i18n/i18n.js';

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
  useEffect(() => {
    void api<{ events: TimelineEvent[] }>(
      `/api/admin/history/${encodeURIComponent(callId)}`,
    ).then((result) => setEvents(result.events));
  }, [callId]);
  return (
    <div className="detail-backdrop">
      <section className="approval-detail">
        <header><div><p className="eyebrow">{callId}</p><h2>{t('history.timeline')}</h2></div><button className="close" onClick={onClose}>×</button></header>
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
