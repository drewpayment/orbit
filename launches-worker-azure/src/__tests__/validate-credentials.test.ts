import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetToken } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({
    getToken: mockGetToken,
  })),
}));

import { validateCredentials } from "../activities/validate-credentials";

describe("validateCredentials", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns valid=true when credentials work", async () => {
    mockGetToken.mockResolvedValue({ token: "eyJ...", expiresOnTimestamp: Date.now() + 3600000 });
    const origEnv = process.env.AZURE_SUBSCRIPTION_ID;
    process.env.AZURE_SUBSCRIPTION_ID = "sub-12345";

    const result = await validateCredentials({ cloudAccountId: "ca-1", provider: "azure" });

    expect(result.valid).toBe(true);
    expect(result.accountIdentifier).toBe("sub-12345");
    expect(result.error).toBeUndefined();
    process.env.AZURE_SUBSCRIPTION_ID = origEnv;
  });

  it("returns valid=false when credentials fail", async () => {
    mockGetToken.mockRejectedValue(new Error("ClientSecretCredential authentication failed"));

    const result = await validateCredentials({ cloudAccountId: "ca-1", provider: "azure" });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("ClientSecretCredential authentication failed");
  });

  it("handles non-Error thrown values", async () => {
    mockGetToken.mockRejectedValue("unexpected string error");

    const result = await validateCredentials({ cloudAccountId: "ca-1", provider: "azure" });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unknown error");
  });
});
