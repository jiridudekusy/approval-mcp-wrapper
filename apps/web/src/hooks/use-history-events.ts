import { useEffect, useRef, useState } from 'react';

export function useHistoryEvents(refresh: () => Promise<void>) {
  const [connected, setConnected] = useState(false);
  const [revision, setRevision] = useState(0);
  const refreshRef = useRef(refresh);
  const lastEventId = useRef('');

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let closed = false;
    let source: EventSource | undefined;
    let retry = 1_000;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshSoon = () => {
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        setRevision((current) => current + 1);
        void refreshRef.current().catch(() => undefined);
      }, 75);
    };
    const connect = () => {
      const query = lastEventId.current === ''
        ? ''
        : `?lastEventId=${encodeURIComponent(lastEventId.current)}`;
      source = new EventSource(`/api/admin/history/events${query}`);
      source.onopen = () => {
        retry = 1_000;
        setConnected(true);
        refreshSoon();
      };
      source.onmessage = (event) => {
        lastEventId.current = event.lastEventId;
        refreshSoon();
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!closed) {
          reconnectTimer = setTimeout(connect, retry);
          retry = Math.min(retry * 2, 15_000);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      source?.close();
    };
  }, []);

  return { connected, revision };
}
