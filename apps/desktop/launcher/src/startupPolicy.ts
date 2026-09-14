export function shouldPrepareUpdateInLauncher({
  loadingSession,
  authenticated,
  autoOpenSuppressed,
}: {
  loadingSession: boolean;
  authenticated: boolean;
  autoOpenSuppressed: boolean;
}) {
  return !loadingSession && (!authenticated || autoOpenSuppressed);
}
