import { describe, it, expect } from "vitest";
import type {
  ProvisionInfraInput,
  ProvisionInfraResult,
  DestroyInfraInput,
  ValidateCredentialsInput,
  ValidateCredentialsResult,
} from "../types";

describe("types", () => {
  it("ProvisionInfraInput matches Go workflow shape", () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-123",
      stackName: "orbit-ws1-launch-123",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-456",
      provider: "gcp",
      region: "us-central1",
      parameters: { bucketName: "my-bucket" },
    };
    expect(input.launchId).toBe("launch-123");
    expect(input.provider).toBe("gcp");
    expect(input.parameters).toEqual({ bucketName: "my-bucket" });
  });

  it("ProvisionInfraResult has outputs and summary", () => {
    const result: ProvisionInfraResult = {
      outputs: { bucketUrl: "gs://my-bucket" },
      summary: ["Created bucket"],
    };
    expect(result.outputs).toHaveProperty("bucketUrl");
    expect(result.summary).toHaveLength(1);
  });

  it("DestroyInfraInput has no parameters field", () => {
    const input: DestroyInfraInput = {
      launchId: "launch-123",
      stackName: "orbit-ws1-launch-123",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-456",
      provider: "gcp",
      region: "us-central1",
    };
    expect(input).not.toHaveProperty("parameters");
  });

  it("ValidateCredentialsResult shape", () => {
    const result: ValidateCredentialsResult = {
      valid: true,
      accountIdentifier: "my-project-123",
    };
    expect(result.valid).toBe(true);
  });
});
