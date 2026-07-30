export async function runProfileMutation(input: {
  operation(): Promise<unknown>;
  reloadRules: (() => Promise<void>) | undefined;
  refreshProfiles(): void;
}): Promise<void> {
  await input.operation();
  await input.reloadRules?.();
  input.refreshProfiles();
}
