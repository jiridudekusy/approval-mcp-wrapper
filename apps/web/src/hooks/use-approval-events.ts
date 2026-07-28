import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client.js';
import {
  approvalViewModel,
  type ApprovalApiRecord,
  type ApprovalViewModel,
} from '../components/approval-view-model.js';

export function useApprovalEvents() {
  const [approvals, setApprovals] = useState<ApprovalViewModel[]>([]);
  const [connected, setConnected] = useState(false);
  const lastEventId = useRef('');

  const refresh = useCallback(async () => {
    const records = await api<ApprovalApiRecord[]>('/api/admin/approvals');
    setApprovals(
      records
        .map(approvalViewModel)
        .filter((item): item is ApprovalViewModel => item !== undefined),
    );
  }, []);

  useEffect(() => {
    let closed = false;
    let source: EventSource | undefined;
    let retry = 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const query =
        lastEventId.current === ''
          ? ''
          : `?lastEventId=${encodeURIComponent(lastEventId.current)}`;
      source = new EventSource(`/api/admin/approvals/events${query}`);
      source.onopen = () => {
        retry = 1_000;
        setConnected(true);
        void refresh();
      };
      source.onmessage = (event) => {
        lastEventId.current = event.lastEventId;
        void refresh();
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!closed) {
          timer = setTimeout(connect, retry);
          retry = Math.min(retry * 2, 15_000);
        }
      };
    };
    void refresh();
    connect();
    return () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      source?.close();
    };
  }, [refresh]);

  return { approvals, connected, refresh };
}
