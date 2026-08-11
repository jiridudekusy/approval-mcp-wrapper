import { z } from 'zod';

import type { JsonValue } from '@approval-mcp/contracts';

export const CONFIG_COLLECTION_NAMES = [
  'upstreams',
  'clientTokens',
  'toolAccess',
  'policies',
  'grants',
  'approvals',
  'passkeys',
  'recoveryCodes',
  'adminSessions',
  'plugins',
  'settings',
  'profiles',
  'profileRules',
  'tokenProfileAssignments',
  'pushDevices',
] as const;

export type ConfigCollectionName = (typeof CONFIG_COLLECTION_NAMES)[number];
export type ConfigCollection = Record<string, JsonValue>;

export interface ConfigState {
  schemaVersion: 1;
  upstreams: ConfigCollection;
  clientTokens: ConfigCollection;
  toolAccess: ConfigCollection;
  policies: ConfigCollection;
  grants: ConfigCollection;
  approvals: ConfigCollection;
  passkeys: ConfigCollection;
  recoveryCodes: ConfigCollection;
  adminSessions: ConfigCollection;
  plugins: ConfigCollection;
  settings: ConfigCollection;
  profiles: ConfigCollection;
  profileRules: ConfigCollection;
  tokenProfileAssignments: ConfigCollection;
  pushDevices: ConfigCollection;
}

export type StateOperation =
  | {
      type: 'record.upserted';
      collection: ConfigCollectionName;
      id: string;
      value: JsonValue;
    }
  | {
      type: 'record.deleted';
      collection: ConfigCollectionName;
      id: string;
    };

const jsonRecordSchema = z.record(z.string(), z.json());

export type StateEvent =
  | StateOperation
  | {
      type: 'records.batch';
      operations: StateOperation[];
    };

export const configStateSchema = z.object({
  schemaVersion: z.literal(1),
  upstreams: jsonRecordSchema,
  clientTokens: jsonRecordSchema,
  toolAccess: jsonRecordSchema,
  policies: jsonRecordSchema,
  grants: jsonRecordSchema,
  approvals: jsonRecordSchema,
  passkeys: jsonRecordSchema,
  recoveryCodes: jsonRecordSchema,
  adminSessions: jsonRecordSchema,
  plugins: jsonRecordSchema,
  settings: jsonRecordSchema,
  profiles: jsonRecordSchema.default({}),
  profileRules: jsonRecordSchema.default({}),
  tokenProfileAssignments: jsonRecordSchema.default({}),
  pushDevices: jsonRecordSchema.default({}),
});

const stateOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('record.upserted'),
    collection: z.enum(CONFIG_COLLECTION_NAMES),
    id: z.string().min(1),
    value: z.json(),
  }),
  z.object({
    type: z.literal('record.deleted'),
    collection: z.enum(CONFIG_COLLECTION_NAMES),
    id: z.string().min(1),
  }),
]);

export const stateEventSchema = z.discriminatedUnion('type', [
  ...stateOperationSchema.options,
  z.object({
    type: z.literal('records.batch'),
    operations: z.array(stateOperationSchema).min(1),
  }),
]);

export function createEmptyConfigState(): ConfigState {
  return {
    schemaVersion: 1,
    upstreams: {},
    clientTokens: {},
    toolAccess: {},
    policies: {},
    grants: {},
    approvals: {},
    passkeys: {},
    recoveryCodes: {},
    adminSessions: {},
    plugins: {},
    settings: {},
    profiles: {},
    profileRules: {},
    tokenProfileAssignments: {},
    pushDevices: {},
  };
}

export function reduceState(state: ConfigState, event: StateEvent): ConfigState {
  if (event.type === 'records.batch') {
    return configStateSchema.parse(
      event.operations.reduce(
        (current, operation) => reduceState(current, operation),
        state,
      ),
    ) as ConfigState;
  }
  const currentCollection = state[event.collection];
  let nextCollection: ConfigCollection;

  if (event.type === 'record.upserted') {
    nextCollection = {
      ...currentCollection,
      [event.id]: structuredClone(event.value),
    };
  } else {
    nextCollection = { ...currentCollection };
    delete nextCollection[event.id];
  }

  return configStateSchema.parse({
    ...state,
    [event.collection]: nextCollection,
  }) as ConfigState;
}
