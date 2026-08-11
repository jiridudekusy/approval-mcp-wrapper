import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Approval, ApprovalId, JsonValue } from '@approval-mcp/contracts';
import { createConfigStateStore } from '@approval-mcp/state-store';
import { describe, expect, it } from 'vitest';

import {
  PushNotificationService,
  type PushSender,
} from './push-notification-service.js';

const masterKey = Buffer.alloc(32, 9);
const now = new Date('2026-08-10T10:00:00.000Z');
const subscription = {
  endpoint: 'https://web.push.apple.com/QV-test-subscription',
  expirationTime: null,
  keys: {
    p256dh: 'p256dh-test-key-material-long-enough',
    auth: 'auth-test-key-material',
  },
};

async function fixture(sender: PushSender = {
  sendNotification: async () => ({}),
}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'approval-push-'));
  const state = await createConfigStateStore(dataDir);
  const service = await PushNotificationService.create({
    state,
    masterKey,
    vapidSubject: 'mailto:security@example.com',
    sender,
    generateVapidKeys: () => ({
      publicKey: 'public-vapid-key',
      privateKey: 'private-vapid-key',
    }),
    now: () => now,
  });
  return { service, state };
}

async function pendingApproval(
  state: Awaited<ReturnType<typeof createConfigStateStore>>,
): Promise<Approval> {
  const approval = {
    id: '6e941421-3602-44b2-9d45-22406b892fbd' as ApprovalId,
    status: 'pending',
  } as Approval;
  await state.mutate({
    type: 'record.upserted',
    collection: 'approvals',
    id: approval.id,
    value: {
      approval,
      request: {
        expiresAt: '2026-08-10T10:01:00.000Z',
        context: { secret: 'must-not-leak' },
      },
    } as unknown as JsonValue,
  });
  return approval;
}

describe('PushNotificationService', () => {
  it('stores subscriptions encrypted and returns only device metadata', async () => {
    const { service, state } = await fixture();

    const first = await service.registerDevice({
      name: 'Jiri iPhone',
      locale: 'cs',
      platform: 'iPhone',
      subscription,
    });
    const second = await service.registerDevice({
      name: 'Renamed iPhone',
      locale: 'cs-CZ',
      platform: 'iPhone',
      subscription,
    });

    expect(second.id).toBe(first.id);
    expect(service.listDevices()).toEqual([
      expect.objectContaining({ id: first.id, name: 'Renamed iPhone' }),
    ]);
    const stored = JSON.stringify(
      state.read((current) => current.pushDevices),
    );
    expect(stored).not.toContain(subscription.endpoint);
    expect(stored).not.toContain(subscription.keys.auth);
    expect(JSON.stringify(state.read((current) => current.settings)))
      .not.toContain('private-vapid-key');
    expect(JSON.stringify(service.listDevices())).not.toContain('subscription');
    await state.close();
  });

  it('sends only a generic deep link and records successful delivery', async () => {
    const deliveries: Parameters<PushSender['sendNotification']>[] = [];
    const { service, state } = await fixture({
      sendNotification: async (...input) => {
        deliveries.push(input);
        return {};
      },
    });
    await service.registerDevice({
      name: 'Mac',
      locale: 'cs-CZ',
      platform: 'MacIntel',
      subscription,
    });
    const approval = await pendingApproval(state);

    await service.notifyPending(approval);

    expect(deliveries).toHaveLength(1);
    const payload = deliveries[0]?.[1] ?? '';
    expect(payload).toContain('Nový požadavek');
    expect(payload).toContain(approval.id);
    expect(JSON.parse(payload)).toMatchObject({
      url: `/approvals/${approval.id}`,
    });
    expect(payload).not.toContain('must-not-leak');
    expect(deliveries[0]?.[2]).toMatchObject({ TTL: 60, urgency: 'high' });
    expect(service.listDevices()[0]).toMatchObject({
      lastDeliveredAt: now.toISOString(),
    });
    await state.close();
  });

  it('removes a subscription when its push provider reports it as gone', async () => {
    const { service, state } = await fixture({
      sendNotification: async () => {
        throw { statusCode: 410 };
      },
    });
    await service.registerDevice({
      name: 'Old browser',
      locale: 'en',
      platform: 'MacIntel',
      subscription,
    });

    await service.notifyPending(await pendingApproval(state));

    expect(service.listDevices()).toEqual([]);
    await state.close();
  });

  it('removes a device explicitly', async () => {
    const { service, state } = await fixture();
    const device = await service.registerDevice({
      name: 'Mac',
      locale: 'en',
      platform: 'MacIntel',
      subscription,
    });

    await expect(service.removeDevice(device.id)).resolves.toBe(true);
    await expect(service.removeDevice(device.id)).resolves.toBe(false);
    expect(service.listDevices()).toEqual([]);
    await state.close();
  });

  it('rejects a crafted subscription endpoint', async () => {
    const { service, state } = await fixture();

    await expect(service.registerDevice({
      name: 'Internal target',
      locale: 'en',
      platform: 'Browser',
      subscription: {
        ...subscription,
        endpoint: 'https://127.0.0.1/push',
      },
    })).rejects.toThrow('Unsupported Web Push endpoint');
    expect(service.listDevices()).toEqual([]);
    await state.close();
  });
});
