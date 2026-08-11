import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  InMemorySessionRepository,
  SessionService,
} from '../session-store.js';
import { registerPushRoutes, type PushAdminService } from './push-routes.js';

describe('push administration routes', () => {
  it('requires an authenticated session and CSRF for device mutations', async () => {
    const sessions = new SessionService(new InMemorySessionRepository());
    const session = await sessions.create('admin-1');
    const device = {
      id: '54aa9003-9d93-4237-87fc-bb720300be9c',
      name: 'Mac',
      locale: 'en',
      platform: 'MacIntel',
      endpointHash: 'a'.repeat(64),
      createdAt: '2026-08-10T10:00:00.000Z',
      updatedAt: '2026-08-10T10:00:00.000Z',
    };
    const push: PushAdminService = {
      publicKey: 'public-key',
      listDevices: () => [device],
      registerDevice: vi.fn(async () => device),
      removeDevice: vi.fn(async () => true),
    };
    const app = Fastify();
    await registerPushRoutes(app, { sessions, push });
    const cookie = `amcp_admin=${session.plaintext}`;

    expect((await app.inject({
      method: 'GET',
      url: '/api/admin/push',
    })).statusCode).toBe(401);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/push',
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      available: true,
      publicKey: 'public-key',
      devices: [device],
    });
    expect(listed.headers['cache-control']).toBe('no-store');

    expect((await app.inject({
      method: 'POST',
      url: '/api/admin/push/devices',
      headers: { cookie },
      payload: {},
    })).statusCode).toBe(403);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/admin/push/devices/${device.id}`,
      headers: { cookie, 'x-csrf-token': session.csrfToken },
    });
    expect(removed.statusCode).toBe(204);
    expect(push.removeDevice).toHaveBeenCalledWith(device.id);
    await app.close();
  });
});
