import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted() so mock variables are available in vi.mock factories (which are hoisted)
const { mockSetConfig, mockRefresh, mockUp } = vi.hoisted(() => ({
  mockSetConfig: vi.fn(),
  mockRefresh: vi.fn(),
  mockUp: vi.fn().mockResolvedValue({
    outputs: {
      bucketUrl: { value: "gs://test-bucket", secret: false },
      bucketName: { value: "test-bucket", secret: false },
    },
    summary: { result: "succeeded" },
  }),
}));

// Mock Temporal activity context
vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      heartbeat: vi.fn(),
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }),
  },
}));

// Mock Pulumi LocalWorkspace
vi.mock("@pulumi/pulumi/automation", () => ({
  LocalWorkspace: {
    createOrSelectStack: vi.fn().mockResolvedValue({
      setConfig: mockSetConfig,
      refresh: mockRefresh,
      up: mockUp,
    }),
  },
}));

import { provisionInfra } from "../activities/provision";
import type { ProvisionInfraInput } from "../types";

describe("provisionInfra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets gcp:project and gcp:region config", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-1",
      provider: "gcp",
      region: "us-central1",
      parameters: { bucketName: "my-bucket", project: "my-project-123" },
    };

    await provisionInfra(input);

    expect(mockSetConfig).toHaveBeenCalledWith("gcp:project", {
      value: "my-project-123",
    });
    expect(mockSetConfig).toHaveBeenCalledWith("gcp:region", {
      value: "us-central1",
    });
  });

  it("sets user parameters as Pulumi config", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-1",
      provider: "gcp",
      region: "us-central1",
      parameters: { bucketName: "custom-name", project: "proj-1" },
    };

    await provisionInfra(input);

    expect(mockSetConfig).toHaveBeenCalledWith("bucketName", {
      value: "custom-name",
    });
  });

  it("returns outputs from stack.up()", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-1",
      provider: "gcp",
      region: "us-central1",
      parameters: { project: "proj-1" },
    };

    const result = await provisionInfra(input);

    expect(result.outputs).toEqual({
      bucketUrl: "gs://test-bucket",
      bucketName: "test-bucket",
    });
    expect(result.summary).toBeInstanceOf(Array);
  });

  it("does not pass project or region as user config keys", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-1",
      provider: "gcp",
      region: "us-central1",
      parameters: { project: "proj-1", bucketName: "b" },
    };

    await provisionInfra(input);

    const userConfigCalls = mockSetConfig.mock.calls.filter(
      ([key]: [string]) =>
        key !== "gcp:project" && key !== "gcp:region"
    );
    const userKeys = userConfigCalls.map(([key]: [string]) => key);
    expect(userKeys).not.toContain("project");
    expect(userKeys).not.toContain("region");
  });
});
