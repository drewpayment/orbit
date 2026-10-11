/** Drop the encrypted token — it must never leave the server. */
export function stripInstallationToken<T extends object>(doc: T): Omit<T, 'installationToken'> {
  const { installationToken: _installationToken, ...rest } = doc as T & { installationToken?: unknown }
  return rest
}
