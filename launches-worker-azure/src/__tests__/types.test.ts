import { describe, it, expect } from "vitest";
import type {
  ProvisionInfraInput, ProvisionInfraResult, DestroyInfraInput,
  ValidateCredentialsInput, ValidateCredentialsResult,
} from "../types";

describe("types", () => {
  it("ProvisionInfraInput matches Go workflow shape", () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-123", stackName: "orbit-ws1-launch-123",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-456",
      provider: "azure", region: "eastus",
      parameters: { storageAccountName: "myaccount" },
    };
    expect(input.launchId).toBe("launch-123");
    expect(input.provider).toBe("azure");
  });

  it("ProvisionInfraResult has outputs and summary", () => {
    const result: ProvisionInfraResult = {
      outputs: { storageAccountId: "/subscriptions/.../myaccount" },
      summary: ["Created storage account"],
    };
    expect(result.outputs).toHaveProperty("storageAccountId");
    expect(result.summary).toHaveLength(1);
  });

  it("DestroyInfraInput has no parameters field", () => {
    const input: DestroyInfraInput = {
      launchId: "launch-123", stackName: "orbit-ws1-launch-123",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-456",
      provider: "azure", region: "eastus",
    };
    expect(input).not.toHaveProperty("parameters");
  });

  it("ValidateCredentialsResult shape", () => {
    const result: ValidateCredentialsResult = { valid: true, accountIdentifier: "sub-123" };
    expect(result.valid).toBe(true);
  });
});
