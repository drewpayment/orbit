import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSetConfig, mockRefresh, mockUp } = vi.hoisted(() => ({
  mockSetConfig: vi.fn(),
  mockRefresh: vi.fn(),
  mockUp: vi.fn().mockResolvedValue({
    outputs: {
      storageAccountId: { value: "/subscriptions/.../myaccount", secret: false },
      primaryEndpoint: { value: "https://myaccount.blob.core.windows.net", secret: false },
    },
    summary: { result: "succeeded" },
  }),
}));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      heartbeat: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
  },
}));

vi.mock("@pulumi/pulumi/automation", () => ({
  LocalWorkspace: {
    createOrSelectStack: vi.fn().mockResolvedValue({
      setConfig: mockSetConfig, refresh: mockRefresh, up: mockUp,
    }),
  },
}));

import { provisionInfra } from "../activities/provision";
import type { ProvisionInfraInput } from "../types";

describe("provisionInfra", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("sets azure-native:location and azure-native:subscriptionId config", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
      parameters: { storageAccountName: "myaccount", subscriptionId: "sub-123" },
    };
    await provisionInfra(input);
    expect(mockSetConfig).toHaveBeenCalledWith("azure-native:location", { value: "eastus" });
    expect(mockSetConfig).toHaveBeenCalledWith("azure-native:subscriptionId", { value: "sub-123" });
  });

  it("sets user parameters as Pulumi config", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
      parameters: { storageAccountName: "custom", subscriptionId: "sub-123" },
    };
    await provisionInfra(input);
    expect(mockSetConfig).toHaveBeenCalledWith("storageAccountName", { value: "custom" });
  });

  it("returns outputs from stack.up()", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
      parameters: { subscriptionId: "sub-123" },
    };
    const result = await provisionInfra(input);
    expect(result.outputs).toEqual({
      storageAccountId: "/subscriptions/.../myaccount",
      primaryEndpoint: "https://myaccount.blob.core.windows.net",
    });
    expect(result.summary).toBeInstanceOf(Array);
  });

  it("does not pass subscriptionId or location as user config keys", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
      parameters: { subscriptionId: "sub-123", storageAccountName: "b" },
    };
    await provisionInfra(input);
    const userConfigCalls = mockSetConfig.mock.calls.filter(
      (call: unknown[]) => call[0] !== "azure-native:location" && call[0] !== "azure-native:subscriptionId"
    );
    const userKeys = userConfigCalls.map((call: unknown[]) => call[0]);
    expect(userKeys).not.toContain("subscriptionId");
    expect(userKeys).not.toContain("location");
  });

  it("throws if subscriptionId is not provided", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus", parameters: {},
    };
    const origEnv = process.env.AZURE_SUBSCRIPTION_ID;
    delete process.env.AZURE_SUBSCRIPTION_ID;
    await expect(provisionInfra(input)).rejects.toThrow("Azure subscription ID is required");
    process.env.AZURE_SUBSCRIPTION_ID = origEnv;
  });
});
