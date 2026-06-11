import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDestroy, mockRemoveStack } = vi.hoisted(() => ({
  mockDestroy: vi.fn(),
  mockRemoveStack: vi.fn(),
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
    selectStack: vi.fn().mockResolvedValue({
      destroy: mockDestroy,
      workspace: { removeStack: mockRemoveStack },
    }),
  },
}));

import { destroyInfra } from "../activities/destroy";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import type { DestroyInfraInput } from "../types";

describe("destroyInfra", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("selects the existing stack and destroys it", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1", workspaceId: "ws1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
    };
    await destroyInfra(input);
    expect(LocalWorkspace.selectStack).toHaveBeenCalledWith(
      expect.objectContaining({ stackName: "orbit-ws1-launch-1" })
    );
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("removes the stack after destruction", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1", workspaceId: "ws1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
    };
    await destroyInfra(input);
    expect(mockRemoveStack).toHaveBeenCalledWith("orbit-ws1-launch-1");
  });

  it("returns void", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1", workspaceId: "ws1", stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
    };
    const result = await destroyInfra(input);
    expect(result).toBeUndefined();
  });

  it("rejects a stackName that does not match orbit-<workspaceId>-<launchId> (LW-H1)", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1", workspaceId: "ws1", stackName: "orbit-other-tenant-launch-99",
      templatePath: "resources/blob-storage", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
    };
    await expect(destroyInfra(input)).rejects.toThrow("Stack name mismatch");
  });

  it("rejects path traversal in templatePath (LW-H2)", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1", workspaceId: "ws1", stackName: "orbit-ws1-launch-1",
      templatePath: "../../etc/passwd", cloudAccountId: "ca-1",
      provider: "azure", region: "eastus",
    };
    await expect(destroyInfra(input)).rejects.toThrow("Invalid templatePath");
  });
});
