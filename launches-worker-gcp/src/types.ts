/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go ProvisionInfraInput
 * The Go workflow serializes this as JSON when dispatching to launches_gcp queue.
 */
export interface ProvisionInfraInput {
  launchId: string;
  stackName: string;
  templatePath: string;
  cloudAccountId: string;
  provider: string;
  region: string;
  parameters: Record<string, unknown>;
}

/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go ProvisionInfraResult
 */
export interface ProvisionInfraResult {
  outputs: Record<string, unknown>;
  summary: string[];
}

/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go DestroyInfraInput
 * Note: no "parameters" field — destroy does not receive them.
 */
export interface DestroyInfraInput {
  launchId: string;
  stackName: string;
  templatePath: string;
  cloudAccountId: string;
  provider: string;
  region: string;
}

/**
 * Local type for validateCredentials (not dispatched by Go workflow,
 * but used internally for the cloud account connection test).
 */
export interface ValidateCredentialsInput {
  cloudAccountId: string;
  provider: string;
}

export interface ValidateCredentialsResult {
  valid: boolean;
  error?: string;
  accountIdentifier?: string;
}
