/**
 * Startup validation for the Azure launches worker.
 * Extracted into its own module so it can be unit-tested without triggering
 * the Worker.run() side effect.
 */

export const REQUIRED_ENV_VARS = [
  "PULUMI_CONFIG_PASSPHRASE",
  "ORBIT_INTERNAL_API_KEY",
] as const;

/**
 * Asserts that all security-critical environment variables are set.
 * Calls process.exit(1) if any are missing so the container fails fast
 * rather than running with degraded security (LW-C2, LW-H5).
 */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(
      `Azure worker startup failed: required environment variables are not set: ${missing.join(", ")}`
    );
    console.error("See DEV_SETUP.md for local setup instructions.");
    process.exit(1);
  }
}
