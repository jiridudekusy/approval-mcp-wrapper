import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type {
  PushDeviceInput,
  PushDeviceView,
} from '../push-notification-service.js';
import { PushRegistrationError } from '../push-notification-service.js';
import type { SessionService } from '../session-store.js';
import { authorizeAdmin } from './authorization.js';

export interface PushAdminService {
  publicKey: string;
  listDevices(): readonly PushDeviceView[];
  registerDevice(input: PushDeviceInput): Promise<PushDeviceView>;
  removeDevice(id: string): Promise<boolean>;
}

export async function registerPushRoutes(
  app: FastifyInstance,
  options: {
    sessions: SessionService;
    push?: PushAdminService;
  },
): Promise<void> {
  app.get('/api/admin/push', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, false)) return;
    reply.header('cache-control', 'no-store');
    return {
      available: options.push !== undefined,
      publicKey: options.push?.publicKey,
      devices: options.push?.listDevices() ?? [],
    };
  });

  app.post('/api/admin/push/devices', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    if (options.push === undefined) {
      reply.code(503);
      return {
        error: {
          code: 'push.unavailable',
          message: 'Web Push service is unavailable',
          requestId: request.id,
        },
      };
    }
    try {
      const device = await options.push.registerDevice(
        request.body as PushDeviceInput,
      );
      reply.code(201);
      return device;
    } catch (error) {
      if (
        !(error instanceof z.ZodError) &&
        !(error instanceof PushRegistrationError)
      ) {
        throw error;
      }
      reply.code(400);
      return {
        error: {
          code: 'push.subscription_invalid',
          message: 'Invalid or unsupported Web Push subscription',
          requestId: request.id,
        },
      };
    }
  });

  app.delete('/api/admin/push/devices/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, options.sessions, true)) return;
    if (options.push === undefined) {
      reply.code(503);
      return {
        error: {
          code: 'push.unavailable',
          message: 'Web Push service is unavailable',
          requestId: request.id,
        },
      };
    }
    const id = z.string().uuid().safeParse(
      (request.params as { id?: unknown }).id,
    );
    if (!id.success) {
      reply.code(400);
      return {
        error: {
          code: 'input.invalid',
          message: 'Invalid device identifier',
          requestId: request.id,
        },
      };
    }
    if (!await options.push.removeDevice(id.data)) {
      reply.code(404);
      return {
        error: {
          code: 'push.device_not_found',
          message: 'Push device not found',
          requestId: request.id,
        },
      };
    }
    reply.code(204);
    return undefined;
  });
}
