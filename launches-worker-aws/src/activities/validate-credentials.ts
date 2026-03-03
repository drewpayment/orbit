import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type {
  ValidateCredentialsInput,
  ValidateCredentialsResult,
} from "../types";

export async function validateCredentials(
  input: ValidateCredentialsInput
): Promise<ValidateCredentialsResult> {
  try {
    const sts = new STSClient({});
    const identity = await sts.send(new GetCallerIdentityCommand({}));

    return {
      valid: true,
      accountIdentifier: identity.Account,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
