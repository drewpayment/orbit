/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go ProvisionInfraInput
 * The Go workflow serializes this as JSON when dispatching to launches_azure queue.
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

export interface ProvisionInfraResult {
  outputs: Record<string, unknown>;
  summary: string[];
}

export interface DestroyInfraInput {
  launchId: string;
  stackName: string;
  templatePath: string;
  cloudAccountId: string;
  provider: string;
  region: string;
}

export interface ValidateCredentialsInput {
  cloudAccountId: string;
  provider: string;
}

export interface ValidateCredentialsResult {
  valid: boolean;
  error?: string;
  accountIdentifier?: string;
}
