import { describe, it, expect, vi, afterEach } from "vitest";
import * as activities from "../activities";
import { assertRequiredEnv, REQUIRED_ENV_VARS } from "../startup";

describe("activities barrel export", () => {
  it("exports provisionInfra", () => {
    expect(activities.provisionInfra).toBeDefined();
    expect(typeof activities.provisionInfra).toBe("function");
  });

  it("exports destroyInfra", () => {
    expect(activities.destroyInfra).toBeDefined();
    expect(typeof activities.destroyInfra).toBe("function");
  });

  it("exports validateCredentials", () => {
    expect(activities.validateCredentials).toBeDefined();
    expect(typeof activities.validateCredentials).toBe("function");
  });
});

describe("assertRequiredEnv (LW-C2 / LW-H5)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of REQUIRED_ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("calls process.exit(1) when required vars are missing", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    for (const key of REQUIRED_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    expect(() => assertRequiredEnv()).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("does not call process.exit when all required vars are set", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    for (const key of REQUIRED_ENV_VARS) {
      savedEnv[key] = process.env[key];
      process.env[key] = "test-value";
    }
    expect(() => assertRequiredEnv()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
