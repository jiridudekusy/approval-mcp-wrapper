export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class StateCorruptionError extends DomainError {
  public constructor(message: string, options?: ErrorOptions) {
    super('state.corrupt_journal', message, options);
  }
}
