import { describe, it, expect } from "vitest";
import * as activities from "../activities";

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
