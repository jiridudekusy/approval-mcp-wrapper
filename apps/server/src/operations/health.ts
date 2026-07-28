import { access, constants } from 'node:fs/promises';

export interface ReadinessState {
  stateLoaded: boolean;
  masterKeyLoaded: boolean;
  fatalRecoveryError?: string;
}

export async function readiness(
  dataDir: string,
  state: ReadinessState,
): Promise<{ ready: boolean; checks: Record<string, boolean> }> {
  let writable = true;
  try {
    await access(dataDir, constants.R_OK | constants.W_OK);
  } catch {
    writable = false;
  }
  const checks = {
    stateLoaded: state.stateLoaded,
    masterKeyLoaded: state.masterKeyLoaded,
    durableStorageWritable: writable,
    recoveryHealthy: state.fatalRecoveryError === undefined,
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}
