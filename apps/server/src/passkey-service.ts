import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';

export type ChallengePurpose = 'bootstrap' | 'login';

interface ChallengeRecord {
  purpose: ChallengePurpose;
  expiresAt: number;
}

export interface PasskeyRecord {
  id: string;
  adminId: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  createdAt: string;
  updatedAt: string;
}

export interface PasskeyRepository {
  list(): Promise<readonly PasskeyRecord[]>;
  find(id: string): Promise<PasskeyRecord | undefined>;
  save(record: PasskeyRecord): Promise<void>;
  createFirst(record: PasskeyRecord): Promise<boolean>;
}

export class InMemoryPasskeyRepository implements PasskeyRepository {
  readonly #records = new Map<string, PasskeyRecord>();

  async list(): Promise<readonly PasskeyRecord[]> {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }

  async find(id: string): Promise<PasskeyRecord | undefined> {
    const record = this.#records.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  async save(record: PasskeyRecord): Promise<void> {
    this.#records.set(record.id, structuredClone(record));
  }

  async createFirst(record: PasskeyRecord): Promise<boolean> {
    if (this.#records.size !== 0) return false;
    this.#records.set(record.id, structuredClone(record));
    return true;
  }
}

export interface PasskeyServiceOptions {
  rpName: string;
  rpId: string;
  expectedOrigin: string;
  repository: PasskeyRepository;
  challenges?: ChallengeStore;
  now?: () => Date;
  challengeLifetimeMs?: number;
}

export class PasskeyService {
  readonly #options: PasskeyServiceOptions;
  readonly #challenges: ChallengeStore;
  readonly #now: () => Date;

  constructor(options: PasskeyServiceOptions) {
    this.#options = options;
    this.#challenges = options.challenges ?? new ChallengeStore();
    this.#now = options.now ?? (() => new Date());
  }

  async bootstrapOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    if ((await this.#options.repository.list()).length !== 0) {
      throw new Error('Administrator bootstrap is already complete');
    }
    const result = await generateRegistrationOptions({
      rpName: this.#options.rpName,
      rpID: this.#options.rpId,
      userName: 'admin',
      userDisplayName: 'Administrator',
      timeout: this.#options.challengeLifetimeMs ?? 60_000,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    this.#remember(result.challenge, 'bootstrap');
    return result;
  }

  async verifyBootstrap(response: RegistrationResponseJSON): Promise<PasskeyRecord> {
    if ((await this.#options.repository.list()).length !== 0) {
      throw new Error('Administrator bootstrap is already complete');
    }
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: (challenge) =>
        this.#challenges.consume(challenge, 'bootstrap'),
      expectedOrigin: this.#options.expectedOrigin,
      expectedRPID: this.#options.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified) throw new Error('Passkey registration failed');
    const now = this.#now().toISOString();
    const record: PasskeyRecord = {
      id: verification.registrationInfo.credential.id,
      adminId: 'admin',
      publicKey: Buffer.from(
        verification.registrationInfo.credential.publicKey,
      ).toString('base64url'),
      counter: verification.registrationInfo.credential.counter,
      createdAt: now,
      updatedAt: now,
      ...(verification.registrationInfo.credential.transports === undefined
        ? {}
        : {
            transports:
              verification.registrationInfo.credential.transports,
          }),
    };
    if (!(await this.#options.repository.createFirst(record))) {
      throw new Error('Administrator bootstrap is already complete');
    }
    return record;
  }

  async loginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const credentials = await this.#options.repository.list();
    if (credentials.length === 0) throw new Error('No passkey is registered');
    const result = await generateAuthenticationOptions({
      rpID: this.#options.rpId,
      timeout: this.#options.challengeLifetimeMs ?? 60_000,
      userVerification: 'required',
      allowCredentials: credentials.map((credential) => ({
        id: credential.id,
        ...(credential.transports === undefined
          ? {}
          : { transports: credential.transports }),
      })),
    });
    this.#remember(result.challenge, 'login');
    return result;
  }

  async verifyLogin(response: AuthenticationResponseJSON): Promise<PasskeyRecord> {
    const credential = await this.#options.repository.find(response.id);
    if (credential === undefined) throw new Error('Unknown passkey');
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) =>
        this.#challenges.consume(challenge, 'login'),
      expectedOrigin: this.#options.expectedOrigin,
      expectedRPID: this.#options.rpId,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: credential.counter,
        ...(credential.transports === undefined
          ? {}
          : { transports: credential.transports }),
      },
    });
    if (!verification.verified) throw new Error('Passkey authentication failed');
    const updated: PasskeyRecord = {
      ...credential,
      counter: verification.authenticationInfo.newCounter,
      updatedAt: this.#now().toISOString(),
    };
    await this.#options.repository.save(updated);
    return updated;
  }

  #remember(challenge: string, purpose: ChallengePurpose): void {
    this.#challenges.put(
      challenge,
      purpose,
      this.#now().getTime() +
        (this.#options.challengeLifetimeMs ?? 60_000),
    );
  }
}

export class ChallengeStore {
  readonly #records = new Map<string, ChallengeRecord>();

  constructor(readonly now: () => number = Date.now) {}

  put(challenge: string, purpose: ChallengePurpose, expiresAt: number): void {
    this.#records.set(challenge, { purpose, expiresAt });
  }

  consume(challenge: string, purpose: ChallengePurpose): boolean {
    const record = this.#records.get(challenge);
    if (
      record === undefined ||
      record.purpose !== purpose ||
      record.expiresAt < this.now()
    ) {
      return false;
    }
    this.#records.delete(challenge);
    return true;
  }
}
