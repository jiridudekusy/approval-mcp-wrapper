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
import { createCallJournal } from '@approval-mcp/call-journal';
import {
  ApprovalOrchestrator,
  StateStoreApprovalRepository,
  StateStoreTokenRepository,
  TokenService,
} from '@approval-mcp/gateway';
import { CredentialVault } from '@approval-mcp/upstream';
import { join } from 'node:path';
import { registerAdminRoutes } from './admin/index.js';

const config = loadConfig();
const stateStore = await createConfigStateStore(config.dataDir);
const journal = await createCallJournal(join(config.dataDir, 'calls'));
const sessions = new SessionService(new StateSessionRepository(stateStore));
const approvals = new ApprovalOrchestrator(
  new StateStoreApprovalRepository(stateStore),
);
await approvals.interruptAll('server.restarted');
const tokens = new TokenService(new StateStoreTokenRepository(stateStore));
const app = await buildServerApp({
  auth: {
    passkeys: new PasskeyService({
      rpName: 'Approval MCP Wrapper',
      rpId: config.rpId,
      expectedOrigin: config.expectedOrigin,
      repository: new StatePasskeyRepository(stateStore),
    }),
    sessions,
    recovery: new RecoveryService(new StateRecoveryRepository(stateStore)),
    secureCookies: config.secureCookies,
  },
});
await registerAdminRoutes(app, {
  sessions,
  state: stateStore,
  tokens,
  credentialVault: new CredentialVault(config.masterKey),
  approvals,
  journal,
});

app.addHook('onClose', async () => stateStore.close());

await app.listen({
  host: process.env['HOST'] ?? '127.0.0.1',
  port: Number(process.env['PORT'] ?? 3000),
});
