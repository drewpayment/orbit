import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetProjectId } = vi.hoisted(() => ({
  mockGetProjectId: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getProjectId: mockGetProjectId,
  })),
}));

import { validateCredentials } from "../activities/validate-credentials";

describe("validateCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns valid=true when credentials work", async () => {
    mockGetProjectId.mockResolvedValue("my-project-123");

    const result = await validateCredentials({
      cloudAccountId: "ca-1",
      provider: "gcp",
    });

    expect(result.valid).toBe(true);
    expect(result.accountIdentifier).toBe("my-project-123");
    expect(result.error).toBeUndefined();
  });

  it("returns valid=false when credentials fail", async () => {
    mockGetProjectId.mockRejectedValue(
      new Error("Could not load default credentials")
    );

    const result = await validateCredentials({
      cloudAccountId: "ca-1",
      provider: "gcp",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Could not load default credentials");
  });

  it("handles non-Error thrown values", async () => {
    mockGetProjectId.mockRejectedValue("unexpected string error");

    const result = await validateCredentials({
      cloudAccountId: "ca-1",
      provider: "gcp",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unknown error");
  });
});
