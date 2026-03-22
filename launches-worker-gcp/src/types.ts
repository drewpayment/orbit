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

export interface DeployToLaunchInput {
  deploymentId: string;
  launchId: string;
  strategy: string;
  cloudAccountId: string;
  provider: string;
  repoUrl: string;
  branch: string;
  buildCommand: string;
  outputDirectory: string;
  launchOutputs: Record<string, unknown>;
  buildEnv: Record<string, string>;
}

export interface DeployToLaunchResult {
  deployedUrl: string;
  filesCount: number;
  summary: string[];
}

export interface UpdateDeploymentStatusInput {
  deploymentId: string;
  status: string;
  error?: string;
  url?: string;
}
