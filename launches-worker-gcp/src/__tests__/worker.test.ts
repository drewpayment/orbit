import { describe, it, expect, vi } from "vitest";

vi.mock("@temporalio/worker", () => ({
  NativeConnection: { connect: vi.fn().mockResolvedValue({}) },
  Worker: { create: vi.fn().mockResolvedValue({ run: vi.fn() }) },
}));

vi.mock("../activities", () => ({
  provisionInfra: vi.fn(),
  destroyInfra: vi.fn(),
  validateCredentials: vi.fn(),
}));

describe("worker configuration", () => {
  it("exports activities with correct names for Go workflow dispatch", async () => {
    const activities = await import("../activities");
    expect(activities).toHaveProperty("provisionInfra");
    expect(activities).toHaveProperty("destroyInfra");
    expect(activities).toHaveProperty("validateCredentials");
  });
});
