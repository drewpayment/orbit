# GCP Launches Worker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `launches-worker-gcp/`, a TypeScript Temporal worker that provisions and destroys GCP infrastructure via Pulumi, mirroring `launches-worker-aws/`.

**Architecture:** A standalone TypeScript service listens on the `launches_gcp` Temporal task queue. The existing Go `LaunchWorkflow` already routes `provisionInfra` and `destroyInfra` activities to provider-specific queues via `taskQueueForProvider("gcp")`. No Go, proto, or frontend changes needed.

**Tech Stack:** TypeScript, Temporal SDK (`@temporalio/worker`), Pulumi Automation API (`@pulumi/pulumi`, `@pulumi/gcp`), `google-auth-library` for credential validation.

**Design Doc:** `docs/plans/2026-03-03-gcp-launches-design.md`

---

## Task 1: Scaffold the GCP Worker Package

**Files:**
- Create: `launches-worker-gcp/package.json`
- Create: `launches-worker-gcp/tsconfig.json`
- Create: `launches-worker-gcp/.gitignore`

**Step 1: Create `package.json`**

```json
{
  "name": "@orbit/launches-worker-gcp",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "ts-node src/worker.ts",
    "dev": "ts-node-dev --respawn src/worker.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@temporalio/activity": "^1.11.0",
    "@temporalio/client": "^1.11.0",
    "@temporalio/worker": "^1.11.0",
    "@pulumi/pulumi": "^3",
    "@pulumi/gcp": "^8",
    "google-auth-library": "^9"
  },
  "devDependencies": {
    "typescript": "^5",
    "ts-node": "^10",
    "ts-node-dev": "^2",
    "@types/node": "^20",
    "vitest": "^2"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.js.map
```

**Step 4: Install dependencies**

Run: `cd launches-worker-gcp && npm install`
Expected: `node_modules/` created, `package-lock.json` generated

**Step 5: Verify TypeScript compiles (empty project)**

Run: `cd launches-worker-gcp && mkdir -p src && echo "export {}" > src/index.ts && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add launches-worker-gcp/package.json launches-worker-gcp/tsconfig.json launches-worker-gcp/.gitignore launches-worker-gcp/package-lock.json
git commit -m "feat(gcp-worker): scaffold launches-worker-gcp package"
```

---

## Task 2: Create Shared Types

**Files:**
- Create: `launches-worker-gcp/src/types.ts`

These types must exactly match the Go workflow's `ProvisionInfraInput`, `ProvisionInfraResult`, and `DestroyInfraInput` from `temporal-workflows/pkg/types/launch_types.go`. The Go workflow serializes these as JSON when dispatching to the task queue.

**Step 1: Write the failing test**

Create: `launches-worker-gcp/src/__tests__/types.test.ts`

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/types.test.ts`
Expected: FAIL — `Cannot find module '../types'`

**Step 3: Write the types**

Create: `launches-worker-gcp/src/types.ts`

```typescript
/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go ProvisionInfraInput
 * The Go workflow serializes this as JSON when dispatching to launches_gcp queue.
 */
export interface ProvisionInfraInput {
  launchId: string;
  stackName: string;
  templatePath: string;
  cloudAccountId: string;
  provider: string;
  region: string;
  parameters: Record<string, unknown>;
}

/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go ProvisionInfraResult
 */
export interface ProvisionInfraResult {
  outputs: Record<string, unknown>;
  summary: string[];
}

/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go DestroyInfraInput
 * Note: no "parameters" field — destroy does not receive them.
 */
export interface DestroyInfraInput {
  launchId: string;
  stackName: string;
  templatePath: string;
  cloudAccountId: string;
  provider: string;
  region: string;
}

/**
 * Local type for validateCredentials (not dispatched by Go workflow,
 * but used internally for the cloud account connection test).
 */
export interface ValidateCredentialsInput {
  cloudAccountId: string;
  provider: string;
}

export interface ValidateCredentialsResult {
  valid: boolean;
  error?: string;
  accountIdentifier?: string;
}
```

**Step 4: Run test to verify it passes**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/types.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add launches-worker-gcp/src/types.ts launches-worker-gcp/src/__tests__/types.test.ts
git commit -m "feat(gcp-worker): add shared types matching Go workflow interface"
```

---

## Task 3: Implement the `provisionInfra` Activity

**Files:**
- Create: `launches-worker-gcp/src/activities/provision.ts`
- Create: `launches-worker-gcp/src/__tests__/provision.test.ts`

This activity is called by the Go workflow with the exact name `"provisionInfra"`. It must:
1. Resolve `input.templatePath` to a local Pulumi project directory
2. Create/select a Pulumi stack via `LocalWorkspace`
3. Set `gcp:project` and `gcp:region` config (unlike AWS which only sets `aws:region`)
4. Set user parameters as Pulumi config
5. Run `stack.up()` and return outputs
6. Send heartbeats every 5s (Go workflow enforces 30s heartbeat timeout)

**Step 1: Write the failing test**

Create: `launches-worker-gcp/src/__tests__/provision.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

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
const mockSetConfig = vi.fn();
const mockRefresh = vi.fn();
const mockUp = vi.fn().mockResolvedValue({
  outputs: {
    bucketUrl: { value: "gs://test-bucket", secret: false },
    bucketName: { value: "test-bucket", secret: false },
  },
  summary: { result: "succeeded" },
});

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

    // Must set gcp:project from parameters.project
    expect(mockSetConfig).toHaveBeenCalledWith("gcp:project", {
      value: "my-project-123",
    });
    // Must set gcp:region from input.region
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

    // "project" should be set as gcp:project, NOT as a user config key
    const userConfigCalls = mockSetConfig.mock.calls.filter(
      ([key]: [string]) =>
        key !== "gcp:project" && key !== "gcp:region"
    );
    const userKeys = userConfigCalls.map(([key]: [string]) => key);
    expect(userKeys).not.toContain("project");
    expect(userKeys).not.toContain("region");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/provision.test.ts`
Expected: FAIL — `Cannot find module '../activities/provision'`

**Step 3: Write the implementation**

Create: `launches-worker-gcp/src/activities/provision.ts`

```typescript
import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { ProvisionInfraInput, ProvisionInfraResult } from "../types";

/** Keys extracted from parameters and set as GCP provider config, not user config. */
const RESERVED_PARAM_KEYS = ["project", "region"];

export async function provisionInfra(
  input: ProvisionInfraInput
): Promise<ProvisionInfraResult> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting GCP infrastructure provisioning", {
    launchId: input.launchId,
    stackName: input.stackName,
    templatePath: input.templatePath,
    region: input.region,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("provisioning in progress");
  }, 5000);

  try {
    const workDir = path.resolve(
      __dirname,
      "..",
      "templates",
      input.templatePath
    );

    const stack = await LocalWorkspace.createOrSelectStack({
      stackName: input.stackName,
      workDir,
    });

    // GCP requires both project and region (unlike AWS which only needs region)
    const gcpProject =
      (input.parameters.project as string) || process.env.GCP_PROJECT || "";
    await stack.setConfig("gcp:project", { value: gcpProject });
    await stack.setConfig("gcp:region", { value: input.region });

    // Set user parameters as Pulumi config (skip reserved keys)
    for (const [key, value] of Object.entries(input.parameters)) {
      if (RESERVED_PARAM_KEYS.includes(key)) continue;
      await stack.setConfig(key, {
        value: typeof value === "string" ? value : JSON.stringify(value),
      });
    }

    await stack.refresh({ onOutput: logger.info });

    const outputLines: string[] = [];
    const upResult = await stack.up({
      onOutput: (line: string) => {
        outputLines.push(line);
        logger.info(line);
      },
    });

    const outputs: Record<string, unknown> = {};
    for (const [key, output] of Object.entries(upResult.outputs)) {
      outputs[key] = output.value;
    }

    return {
      outputs,
      summary: outputLines.slice(-20),
    };
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/provision.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add launches-worker-gcp/src/activities/provision.ts launches-worker-gcp/src/__tests__/provision.test.ts
git commit -m "feat(gcp-worker): implement provisionInfra activity"
```

---

## Task 4: Implement the `destroyInfra` Activity

**Files:**
- Create: `launches-worker-gcp/src/activities/destroy.ts`
- Create: `launches-worker-gcp/src/__tests__/destroy.test.ts`

This activity is called by the Go workflow with the exact name `"destroyInfra"`. It must:
1. Select the existing Pulumi stack
2. Run `stack.destroy()`
3. Remove the stack after destruction
4. Return void (the Go workflow passes `nil` as the result pointer)

**Step 1: Write the failing test**

Create: `launches-worker-gcp/src/__tests__/destroy.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockDestroy = vi.fn();
const mockRemoveStack = vi.fn();

vi.mock("@pulumi/pulumi/automation", () => ({
  LocalWorkspace: {
    selectStack: vi.fn().mockResolvedValue({
      destroy: mockDestroy,
      workspace: {
        removeStack: mockRemoveStack,
      },
    }),
  },
}));

import { destroyInfra } from "../activities/destroy";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import type { DestroyInfraInput } from "../types";

describe("destroyInfra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects the existing stack and destroys it", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-1",
      provider: "gcp",
      region: "us-central1",
    };

    await destroyInfra(input);

    expect(LocalWorkspace.selectStack).toHaveBeenCalledWith(
      expect.objectContaining({ stackName: "orbit-ws1-launch-1" })
    );
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("removes the stack after destruction", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-1",
      provider: "gcp",
      region: "us-central1",
    };

    await destroyInfra(input);

    expect(mockRemoveStack).toHaveBeenCalledWith("orbit-ws1-launch-1");
  });

  it("returns void", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/gcs-bucket",
      cloudAccountId: "ca-1",
      provider: "gcp",
      region: "us-central1",
    };

    const result = await destroyInfra(input);
    expect(result).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/destroy.test.ts`
Expected: FAIL — `Cannot find module '../activities/destroy'`

**Step 3: Write the implementation**

Create: `launches-worker-gcp/src/activities/destroy.ts`

```typescript
import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { DestroyInfraInput } from "../types";

export async function destroyInfra(input: DestroyInfraInput): Promise<void> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting GCP infrastructure destruction (deorbit)", {
    launchId: input.launchId,
    stackName: input.stackName,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("deorbiting in progress");
  }, 5000);

  try {
    const workDir = path.resolve(
      __dirname,
      "..",
      "templates",
      input.templatePath
    );

    const stack = await LocalWorkspace.selectStack({
      stackName: input.stackName,
      workDir,
    });

    await stack.destroy({
      onOutput: (line: string) => {
        logger.info(line);
      },
    });

    await stack.workspace.removeStack(input.stackName);

    logger.info("GCP infrastructure deorbited successfully", {
      launchId: input.launchId,
    });
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/destroy.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add launches-worker-gcp/src/activities/destroy.ts launches-worker-gcp/src/__tests__/destroy.test.ts
git commit -m "feat(gcp-worker): implement destroyInfra activity"
```

---

## Task 5: Implement the `validateCredentials` Activity

**Files:**
- Create: `launches-worker-gcp/src/activities/validate-credentials.ts`
- Create: `launches-worker-gcp/src/__tests__/validate-credentials.test.ts`

This activity is NOT dispatched by the Go workflow — it's used locally for the "Test Connection" button on the Cloud Accounts settings page. It uses `google-auth-library` to verify GCP credentials work.

**Step 1: Write the failing test**

Create: `launches-worker-gcp/src/__tests__/validate-credentials.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetProjectId = vi.fn();

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
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/validate-credentials.test.ts`
Expected: FAIL — `Cannot find module '../activities/validate-credentials'`

**Step 3: Write the implementation**

Create: `launches-worker-gcp/src/activities/validate-credentials.ts`

```typescript
import { GoogleAuth } from "google-auth-library";
import type {
  ValidateCredentialsInput,
  ValidateCredentialsResult,
} from "../types";

export async function validateCredentials(
  input: ValidateCredentialsInput
): Promise<ValidateCredentialsResult> {
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const projectId = await auth.getProjectId();

    return {
      valid: true,
      accountIdentifier: projectId,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/validate-credentials.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add launches-worker-gcp/src/activities/validate-credentials.ts launches-worker-gcp/src/__tests__/validate-credentials.test.ts
git commit -m "feat(gcp-worker): implement validateCredentials activity"
```

---

## Task 6: Create Activity Barrel Export and Temporal Worker

**Files:**
- Create: `launches-worker-gcp/src/activities/index.ts`
- Create: `launches-worker-gcp/src/worker.ts`
- Create: `launches-worker-gcp/src/__tests__/worker.test.ts`

**Step 1: Create the activity barrel export**

Create: `launches-worker-gcp/src/activities/index.ts`

```typescript
export { provisionInfra } from "./provision";
export { destroyInfra } from "./destroy";
export { validateCredentials } from "./validate-credentials";
```

**Step 2: Write the failing worker test**

Create: `launches-worker-gcp/src/__tests__/worker.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWorkerRun = vi.fn().mockResolvedValue(undefined);
const mockWorkerCreate = vi.fn().mockResolvedValue({ run: mockWorkerRun });
const mockConnect = vi.fn().mockResolvedValue({});

vi.mock("@temporalio/worker", () => ({
  NativeConnection: { connect: mockConnect },
  Worker: { create: mockWorkerCreate },
}));

vi.mock("../activities", () => ({
  provisionInfra: vi.fn(),
  destroyInfra: vi.fn(),
  validateCredentials: vi.fn(),
}));

describe("worker configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports activities with correct names for Go workflow dispatch", async () => {
    const activities = await import("../activities");
    // Go workflow dispatches these exact activity names
    expect(activities).toHaveProperty("provisionInfra");
    expect(activities).toHaveProperty("destroyInfra");
    // Local activity (not dispatched by Go)
    expect(activities).toHaveProperty("validateCredentials");
  });
});
```

**Step 3: Run test to verify it passes**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/worker.test.ts`
Expected: PASS

**Step 4: Write the Temporal worker**

Create: `launches-worker-gcp/src/worker.ts`

```typescript
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "default";
  const taskQueue = process.env.TASK_QUEUE || "launches_gcp";

  console.log(`Connecting to Temporal at ${temporalAddress}`);

  const connection = await NativeConnection.connect({
    address: temporalAddress,
  });

  const worker = await Worker.create({
    connection,
    namespace,
    activities,
    taskQueue,
  });

  console.log(`GCP worker started, listening on task queue: ${taskQueue}`);
  await worker.run();
}

run().catch((err) => {
  console.error("GCP worker failed:", err);
  process.exit(1);
});
```

**Step 5: Verify TypeScript compiles**

Run: `cd launches-worker-gcp && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add launches-worker-gcp/src/activities/index.ts launches-worker-gcp/src/worker.ts launches-worker-gcp/src/__tests__/worker.test.ts
git commit -m "feat(gcp-worker): add activity exports and Temporal worker entry point"
```

---

## Task 7: Create GCS Bucket Pulumi Template

**Files:**
- Create: `launches-worker-gcp/src/templates/resources/gcs-bucket/index.ts`
- Create: `launches-worker-gcp/src/templates/resources/gcs-bucket/Pulumi.yaml`
- Create: `launches-worker-gcp/src/__tests__/templates/gcs-bucket.test.ts`

This mirrors the AWS `s3-bucket` template. It provisions a GCS bucket with configurable versioning and public access settings.

**Step 1: Write the failing test**

Create: `launches-worker-gcp/src/__tests__/templates/gcs-bucket.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

// Tell Pulumi we're in test mode
pulumi.runtime.setMocks({
  newResource(args: pulumi.runtime.MockResourceArgs): {
    id: string;
    state: Record<string, unknown>;
  } {
    return {
      id: `${args.name}-id`,
      state: args.inputs,
    };
  },
  call(args: pulumi.runtime.MockCallArgs): Record<string, unknown> {
    return args.inputs;
  },
});

describe("gcs-bucket template", () => {
  it("exports expected outputs", async () => {
    // Import after mocks are set up
    const template = await import(
      "../../templates/resources/gcs-bucket/index"
    );

    const bucketName = await new Promise<string>((resolve) =>
      template.bucketName.apply(resolve)
    );
    const bucketUrl = await new Promise<string>((resolve) =>
      template.bucketUrl.apply(resolve)
    );

    expect(bucketName).toBeDefined();
    expect(bucketUrl).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/templates/gcs-bucket.test.ts`
Expected: FAIL — `Cannot find module '../../templates/resources/gcs-bucket/index'`

**Step 3: Write the Pulumi template**

Create: `launches-worker-gcp/src/templates/resources/gcs-bucket/Pulumi.yaml`

```yaml
name: orbit-gcs-bucket
runtime: nodejs
description: Provisions a GCS bucket with configurable settings
```

Create: `launches-worker-gcp/src/templates/resources/gcs-bucket/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const bucketNameConfig = config.get("bucketName") || pulumi.getStack();
const versioning = config.getBoolean("versioning") ?? false;
const publicAccess = config.getBoolean("publicAccess") ?? false;
const location = config.get("location") || "US";

const bucket = new gcp.storage.Bucket("orbit-bucket", {
  name: bucketNameConfig,
  location,
  forceDestroy: true,
  uniformBucketLevelAccess: !publicAccess,
  versioning: {
    enabled: versioning,
  },
  labels: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

export const bucketName = bucket.name;
export const bucketUrl = pulumi.interpolate`gs://${bucket.name}`;
export const bucketSelfLink = bucket.selfLink;
```

**Step 4: Run test to verify it passes**

Run: `cd launches-worker-gcp && npx vitest run src/__tests__/templates/gcs-bucket.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add launches-worker-gcp/src/templates/resources/gcs-bucket/
git add launches-worker-gcp/src/__tests__/templates/gcs-bucket.test.ts
git commit -m "feat(gcp-worker): add GCS bucket Pulumi template"
```

---

## Task 8: Create Cloud SQL PostgreSQL Pulumi Template

**Files:**
- Create: `launches-worker-gcp/src/templates/resources/cloud-sql-postgresql/index.ts`
- Create: `launches-worker-gcp/src/templates/resources/cloud-sql-postgresql/Pulumi.yaml`

This is the GCP equivalent of `rds-postgresql`. It provisions a Cloud SQL instance, database, and user.

**Step 1: Create the Pulumi config**

Create: `launches-worker-gcp/src/templates/resources/cloud-sql-postgresql/Pulumi.yaml`

```yaml
name: orbit-cloud-sql-postgresql
runtime: nodejs
description: Provisions a Cloud SQL PostgreSQL instance with database and user
```

**Step 2: Write the implementation**

Create: `launches-worker-gcp/src/templates/resources/cloud-sql-postgresql/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const instanceName = config.get("instanceName") || `orbit-${pulumi.getStack()}`;
const databaseVersion = config.get("databaseVersion") || "POSTGRES_15";
const tier = config.get("tier") || "db-f1-micro";
const dbName = config.get("databaseName") || "orbit";
const dbUser = config.get("databaseUser") || "orbit";

const password = new random.RandomPassword("db-password", {
  length: 24,
  special: false,
});

const instance = new gcp.sql.DatabaseInstance("orbit-sql-instance", {
  name: instanceName,
  databaseVersion,
  deletionProtection: false,
  settings: {
    tier,
    ipConfiguration: {
      ipv4Enabled: true,
    },
    backupConfiguration: {
      enabled: true,
    },
  },
});

const database = new gcp.sql.Database("orbit-database", {
  name: dbName,
  instance: instance.name,
});

const user = new gcp.sql.User("orbit-user", {
  name: dbUser,
  instance: instance.name,
  password: password.result,
});

export const connectionName = instance.connectionName;
export const publicIpAddress = instance.publicIpAddress;
export const databaseName = database.name;
export const userName = user.name;
export const userPassword = pulumi.secret(password.result);
```

**Step 3: Verify TypeScript compiles**

Run: `cd launches-worker-gcp && npx tsc --noEmit`
Expected: No errors (may need to `npm install @pulumi/random` first — add to package.json if so)

**Step 4: Commit**

```bash
git add launches-worker-gcp/src/templates/resources/cloud-sql-postgresql/
git commit -m "feat(gcp-worker): add Cloud SQL PostgreSQL Pulumi template"
```

---

## Task 9: Create Cloud Run Service Pulumi Template

**Files:**
- Create: `launches-worker-gcp/src/templates/resources/cloud-run-service/index.ts`
- Create: `launches-worker-gcp/src/templates/resources/cloud-run-service/Pulumi.yaml`

GCP equivalent of `ecs-fargate`. Provisions a Cloud Run v2 service with IAM invoker binding.

**Step 1: Create the Pulumi config**

Create: `launches-worker-gcp/src/templates/resources/cloud-run-service/Pulumi.yaml`

```yaml
name: orbit-cloud-run-service
runtime: nodejs
description: Provisions a Cloud Run service with IAM configuration
```

**Step 2: Write the implementation**

Create: `launches-worker-gcp/src/templates/resources/cloud-run-service/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const serviceName = config.get("serviceName") || `orbit-${pulumi.getStack()}`;
const image =
  config.get("containerImage") || "us-docker.pkg.dev/cloudrun/container/hello";
const port = config.getNumber("containerPort") || 8080;
const cpu = config.get("cpu") || "1";
const memory = config.get("memory") || "512Mi";
const maxInstances = config.getNumber("maxInstances") || 10;
const allowUnauthenticated = config.getBoolean("allowUnauthenticated") ?? false;

const service = new gcp.cloudrunv2.Service("orbit-run-service", {
  name: serviceName,
  ingress: "INGRESS_TRAFFIC_ALL",
  template: {
    scaling: {
      maxInstanceCount: maxInstances,
    },
    containers: [
      {
        image,
        ports: [{ containerPort: port }],
        resources: {
          limits: {
            cpu,
            memory,
          },
        },
      },
    ],
  },
  labels: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

if (allowUnauthenticated) {
  new gcp.cloudrunv2.ServiceIamMember("orbit-run-invoker", {
    name: service.name,
    location: service.location,
    role: "roles/run.invoker",
    member: "allUsers",
  });
}

export const serviceUrl = service.uri;
export const serviceId = service.id;
export const serviceLocation = service.location;
```

**Step 3: Verify TypeScript compiles**

Run: `cd launches-worker-gcp && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add launches-worker-gcp/src/templates/resources/cloud-run-service/
git commit -m "feat(gcp-worker): add Cloud Run service Pulumi template"
```

---

## Task 10: Create VPC Network Pulumi Template

**Files:**
- Create: `launches-worker-gcp/src/templates/resources/vpc-network/index.ts`
- Create: `launches-worker-gcp/src/templates/resources/vpc-network/Pulumi.yaml`

GCP equivalent of the AWS VPC template. Provisions a VPC network, subnet, router, NAT, and firewall rules.

**Step 1: Create the Pulumi config**

Create: `launches-worker-gcp/src/templates/resources/vpc-network/Pulumi.yaml`

```yaml
name: orbit-vpc-network
runtime: nodejs
description: Provisions a GCP VPC network with subnet, router, NAT, and firewall rules
```

**Step 2: Write the implementation**

Create: `launches-worker-gcp/src/templates/resources/vpc-network/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const networkName = config.get("networkName") || `orbit-${pulumi.getStack()}`;
const subnetCidr = config.get("subnetCidr") || "10.0.0.0/24";
const enableNat = config.getBoolean("enableNat") ?? true;

const network = new gcp.compute.Network("orbit-network", {
  name: networkName,
  autoCreateSubnetworks: false,
});

const subnet = new gcp.compute.Subnetwork("orbit-subnet", {
  name: `${networkName}-subnet`,
  ipCidrRange: subnetCidr,
  network: network.id,
  privateIpGoogleAccess: true,
});

// Allow internal traffic
new gcp.compute.Firewall("orbit-allow-internal", {
  name: `${networkName}-allow-internal`,
  network: network.id,
  allows: [
    { protocol: "tcp", ports: ["0-65535"] },
    { protocol: "udp", ports: ["0-65535"] },
    { protocol: "icmp" },
  ],
  sourceRanges: [subnetCidr],
});

// Allow SSH from IAP
new gcp.compute.Firewall("orbit-allow-iap-ssh", {
  name: `${networkName}-allow-iap-ssh`,
  network: network.id,
  allows: [{ protocol: "tcp", ports: ["22"] }],
  sourceRanges: ["35.235.240.0/20"], // Google IAP range
});

let natIpAddress: pulumi.Output<string> | undefined;

if (enableNat) {
  const router = new gcp.compute.Router("orbit-router", {
    name: `${networkName}-router`,
    network: network.id,
  });

  const nat = new gcp.compute.RouterNat("orbit-nat", {
    name: `${networkName}-nat`,
    router: router.name,
    natIpAllocateOption: "AUTO_ONLY",
    sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES",
  });

  natIpAddress = nat.name;
}

export const networkId = network.id;
export const networkSelfLink = network.selfLink;
export const subnetId = subnet.id;
export const subnetSelfLink = subnet.selfLink;
```

**Step 3: Verify TypeScript compiles**

Run: `cd launches-worker-gcp && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add launches-worker-gcp/src/templates/resources/vpc-network/
git commit -m "feat(gcp-worker): add VPC network Pulumi template"
```

---

## Task 11: Create Dockerfile

**Files:**
- Create: `launches-worker-gcp/Dockerfile`

**Step 1: Write the Dockerfile**

Create: `launches-worker-gcp/Dockerfile`

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/worker.js"]
```

**Step 2: Verify Docker builds** (optional — requires Docker running)

Run: `cd launches-worker-gcp && docker build -t orbit-launches-worker-gcp .`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add launches-worker-gcp/Dockerfile
git commit -m "feat(gcp-worker): add Dockerfile"
```

---

## Task 12: Add Docker Compose Service

**Files:**
- Modify: `docker-compose.yml` (add `launches-worker-gcp` service after `launches-worker-aws`)

**Step 1: Read the current file to find the exact insertion point**

Run: `grep -n "launches-worker-aws" docker-compose.yml`
Find the last line of the `launches-worker-aws` service block.

**Step 2: Add the GCP worker service**

Add after the `launches-worker-aws` service block:

```yaml
  launches-worker-gcp:
    container_name: orbit-launches-worker-gcp
    build:
      context: ./launches-worker-gcp
      dockerfile: Dockerfile
    depends_on:
      temporal-server:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      - TEMPORAL_ADDRESS=temporal-server:7233
      - TEMPORAL_NAMESPACE=default
      - TASK_QUEUE=launches_gcp
      - PULUMI_BACKEND_URL=s3://pulumi-state?endpoint=minio:9000&s3ForcePathStyle=true
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - GOOGLE_CREDENTIALS=${GOOGLE_CREDENTIALS:-}
    restart: unless-stopped
```

Note: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are needed for the MinIO Pulumi state backend, not for GCP provisioning. `GOOGLE_CREDENTIALS` is the GCP service account JSON.

**Step 3: Verify docker-compose config is valid**

Run: `docker compose config --quiet`
Expected: No errors

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(gcp-worker): add launches-worker-gcp to docker-compose"
```

---

## Task 13: Seed GCP Launch Templates

**Files:**
- Modify: `orbit-www/src/seed/launch-templates-seed.ts`

Add 6 GCP templates matching the AWS set: 2 bundles + 4 resources. The `pulumiProgram` field values must match the directory names under `launches-worker-gcp/src/templates/`.

**Step 1: Read the current seed file**

Run: `cat orbit-www/src/seed/launch-templates-seed.ts`
Understand the existing AWS template structure.

**Step 2: Add GCP templates after the AWS templates array**

Add these 6 GCP templates to the seed script (appended to the templates array):

```typescript
// --- GCP Individual Resources ---
{
  name: "GCS Bucket",
  slug: "gcp-gcs-bucket",
  description:
    "Provision a Google Cloud Storage bucket with configurable versioning, lifecycle policies, and access controls.",
  type: "resource",
  provider: "gcp",
  category: "storage",
  pulumiProgram: "resources/gcs-bucket",
  estimatedDuration: "~2 min",
  parameterSchema: {
    type: "object",
    properties: {
      bucketName: {
        type: "string",
        title: "Bucket Name",
        description: "Globally unique name for the GCS bucket",
      },
      location: {
        type: "string",
        title: "Location",
        default: "US",
        description: "Multi-region or region for bucket storage",
      },
      versioning: {
        type: "boolean",
        title: "Enable Versioning",
        default: false,
      },
      publicAccess: {
        type: "boolean",
        title: "Allow Public Access",
        default: false,
      },
    },
    required: ["bucketName"],
  },
},
{
  name: "Cloud SQL PostgreSQL",
  slug: "gcp-cloud-sql-postgresql",
  description:
    "Provision a Cloud SQL PostgreSQL instance with automated backups, a database, and user credentials.",
  type: "resource",
  provider: "gcp",
  category: "database",
  pulumiProgram: "resources/cloud-sql-postgresql",
  estimatedDuration: "~10 min",
  parameterSchema: {
    type: "object",
    properties: {
      instanceName: {
        type: "string",
        title: "Instance Name",
        description: "Cloud SQL instance name",
      },
      databaseVersion: {
        type: "string",
        title: "PostgreSQL Version",
        default: "POSTGRES_15",
        enum: ["POSTGRES_15", "POSTGRES_14", "POSTGRES_13"],
      },
      tier: {
        type: "string",
        title: "Machine Type",
        default: "db-f1-micro",
        enum: ["db-f1-micro", "db-g1-small", "db-custom-2-7680"],
      },
      databaseName: {
        type: "string",
        title: "Database Name",
        default: "orbit",
      },
      databaseUser: {
        type: "string",
        title: "Database User",
        default: "orbit",
      },
    },
  },
},
{
  name: "Cloud Run Service",
  slug: "gcp-cloud-run-service",
  description:
    "Deploy a containerized application to Cloud Run with auto-scaling, custom resource limits, and IAM configuration.",
  type: "resource",
  provider: "gcp",
  category: "container",
  pulumiProgram: "resources/cloud-run-service",
  estimatedDuration: "~3 min",
  parameterSchema: {
    type: "object",
    properties: {
      serviceName: {
        type: "string",
        title: "Service Name",
        description: "Cloud Run service name",
      },
      containerImage: {
        type: "string",
        title: "Container Image",
        description:
          "Container image URL (e.g., us-docker.pkg.dev/project/repo/image:tag)",
      },
      containerPort: {
        type: "number",
        title: "Container Port",
        default: 8080,
      },
      cpu: {
        type: "string",
        title: "CPU",
        default: "1",
        enum: ["1", "2", "4"],
      },
      memory: {
        type: "string",
        title: "Memory",
        default: "512Mi",
        enum: ["256Mi", "512Mi", "1Gi", "2Gi", "4Gi"],
      },
      maxInstances: {
        type: "number",
        title: "Max Instances",
        default: 10,
      },
      allowUnauthenticated: {
        type: "boolean",
        title: "Allow Unauthenticated Access",
        default: false,
      },
    },
    required: ["containerImage"],
  },
},
{
  name: "VPC Network",
  slug: "gcp-vpc-network",
  description:
    "Create a VPC network with custom subnet, Cloud NAT, Cloud Router, and firewall rules for internal traffic and IAP SSH access.",
  type: "resource",
  provider: "gcp",
  category: "networking",
  pulumiProgram: "resources/vpc-network",
  estimatedDuration: "~3 min",
  parameterSchema: {
    type: "object",
    properties: {
      networkName: {
        type: "string",
        title: "Network Name",
        description: "Name for the VPC network",
      },
      subnetCidr: {
        type: "string",
        title: "Subnet CIDR",
        default: "10.0.0.0/24",
        description: "IP range for the primary subnet",
      },
      enableNat: {
        type: "boolean",
        title: "Enable Cloud NAT",
        default: true,
      },
    },
  },
},

// --- GCP Bundles ---
{
  name: "Web App Backend",
  slug: "gcp-web-app-backend",
  description:
    "Full backend stack: VPC network, Cloud Run service, Cloud SQL PostgreSQL, Cloud Load Balancing, and IAM — everything needed for a production GCP web backend.",
  type: "bundle",
  provider: "gcp",
  category: "compute",
  pulumiProgram: "bundles/web-app-backend",
  estimatedDuration: "~15 min",
  parameterSchema: {
    type: "object",
    properties: {
      appName: {
        type: "string",
        title: "Application Name",
        description: "Name prefix for all resources",
      },
      containerImage: {
        type: "string",
        title: "Container Image",
        description: "Container image for Cloud Run",
      },
      dbTier: {
        type: "string",
        title: "Database Tier",
        default: "db-f1-micro",
        enum: ["db-f1-micro", "db-g1-small", "db-custom-2-7680"],
      },
    },
    required: ["appName", "containerImage"],
  },
},
{
  name: "Static Site",
  slug: "gcp-static-site",
  description:
    "Host a static website with GCS bucket, Cloud CDN, SSL certificate, and DNS — optimized for global content delivery.",
  type: "bundle",
  provider: "gcp",
  category: "storage",
  pulumiProgram: "bundles/static-site",
  estimatedDuration: "~8 min",
  parameterSchema: {
    type: "object",
    properties: {
      siteName: {
        type: "string",
        title: "Site Name",
        description: "Name prefix for all resources",
      },
      domainName: {
        type: "string",
        title: "Domain Name",
        description: "Custom domain (e.g., www.example.com)",
      },
      enableCdn: {
        type: "boolean",
        title: "Enable Cloud CDN",
        default: true,
      },
    },
    required: ["siteName"],
  },
},
```

**Step 3: Run the seed script to verify**

Run: `cd orbit-www && bun run tsx src/seed/launch-templates-seed.ts`
Expected: Outputs showing 6 GCP templates created (or upserted if idempotent)

**Step 4: Commit**

```bash
git add orbit-www/src/seed/launch-templates-seed.ts
git commit -m "feat(gcp-worker): seed 6 GCP launch templates"
```

---

## Task 14: Update Documentation

**Files:**
- Modify: `orbit-docs/content/docs/features/launches.mdx`

**Step 1: Update the Launches doc**

Add GCP to the "Pulumi Programs" section. After the existing AWS block (around line 108-121), add:

```markdown
For GCP, these are in `launches-worker-gcp/src/templates/`:

\`\`\`
launches-worker-gcp/src/templates/
  resources/
    gcs-bucket/
    cloud-sql-postgresql/
    cloud-run-service/
    vpc-network/
  bundles/
    web-app-backend/    (future)
    static-site/        (future)
\`\`\`
```

Also update the seed script section (around line 99-104) to mention GCP:

Change:
```
This creates 6 templates: 2 bundles (Web App Backend, Static Site) and 4 individual resources (S3 Bucket, RDS PostgreSQL, ECS Fargate Cluster, VPC).
```

To:
```
This creates 12 templates: 6 for AWS and 6 for GCP. Each provider has 2 bundles (Web App Backend, Static Site) and 4 individual resources.
```

**Step 2: Commit**

```bash
git add orbit-docs/content/docs/features/launches.mdx
git commit -m "docs: update Launches documentation for GCP support"
```

---

## Task 15: Run All Tests and Verify

**Step 1: Run GCP worker unit tests**

Run: `cd launches-worker-gcp && npx vitest run`
Expected: All tests pass

**Step 2: Verify TypeScript compiles**

Run: `cd launches-worker-gcp && npx tsc --noEmit`
Expected: No errors

**Step 3: Verify Docker Compose config**

Run: `docker compose config --quiet`
Expected: No errors

**Step 4: Run existing frontend tests to check nothing broke**

Run: `cd orbit-www && pnpm exec vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All existing tests still pass

**Step 5: Final commit (if any fixups needed)**

Only if tests revealed issues that required fixes.
