import { buildServerApp } from './app.js';
import {
  StatePasskeyRepository,
  StateRecoveryRepository,
  StateSessionRepository,
} from './auth-state-repositories.js';
import { loadConfig } from './config.js';
import { PasskeyService } from './passkey-service.js';
import { RecoveryService } from './recovery-service.js';
import { SessionService } from './session-store.js';
import { createConfigStateStore } from '@approval-mcp/state-store';

const config = loadConfig();
const stateStore = await createConfigStateStore(config.dataDir);
const app = await buildServerApp({
  auth: {
    passkeys: new PasskeyService({
      rpName: 'Approval MCP Wrapper',
      rpId: config.rpId,
      expectedOrigin: config.expectedOrigin,
      repository: new StatePasskeyRepository(stateStore),
    }),
    sessions: new SessionService(new StateSessionRepository(stateStore)),
    recovery: new RecoveryService(new StateRecoveryRepository(stateStore)),
    secureCookies: config.secureCookies,
  },
});

app.addHook('onClose', async () => stateStore.close());

await app.listen({
  host: process.env['HOST'] ?? '127.0.0.1',
  port: Number(process.env['PORT'] ?? 3000),
});
