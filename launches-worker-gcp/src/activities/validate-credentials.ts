import { GoogleAuth } from "google-auth-library";
import type {
  ValidateCredentialsInput,
  ValidateCredentialsResult,
} from "../types";

export async function validateCredentials(
  input: ValidateCredentialsInput
): Promise<ValidateCredentialsResult> {
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const projectId = await auth.getProjectId();

    return {
      valid: true,
      accountIdentifier: projectId,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
