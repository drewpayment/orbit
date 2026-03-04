import { DefaultAzureCredential } from "@azure/identity";
import type { ValidateCredentialsInput, ValidateCredentialsResult } from "../types";

export async function validateCredentials(
  input: ValidateCredentialsInput
): Promise<ValidateCredentialsResult> {
  try {
    const credential = new DefaultAzureCredential();
    await credential.getToken("https://management.azure.com/.default");

    return {
      valid: true,
      accountIdentifier: process.env.AZURE_SUBSCRIPTION_ID || "unknown",
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
