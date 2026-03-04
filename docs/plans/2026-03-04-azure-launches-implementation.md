# Azure Launches Worker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `launches-worker-azure/`, a TypeScript Temporal worker that provisions and destroys Azure infrastructure via Pulumi, mirroring `launches-worker-gcp/` and `launches-worker-aws/`.

**Architecture:** A standalone TypeScript service listens on the `launches_azure` Temporal task queue. The existing Go `LaunchWorkflow` already routes `provisionInfra` and `destroyInfra` activities to provider-specific queues via `taskQueueForProvider("azure")`. No Go, proto, or frontend changes needed. Azure credentials use service principal auth (Tenant ID + Client ID + Client Secret) via `@azure/identity`.

**Tech Stack:** TypeScript, Temporal SDK (`@temporalio/worker`), Pulumi Automation API (`@pulumi/pulumi`, `@pulumi/azure-native`), `@azure/identity` for credential validation.

**Reference:** `launches-worker-gcp/` — the GCP worker we're mirroring.

---

## Task 1: Scaffold the Azure Worker Package

**Files:**
- Create: `launches-worker-azure/package.json`
- Create: `launches-worker-azure/tsconfig.json`
- Create: `launches-worker-azure/.gitignore`

**Step 1: Create `package.json`**

```json
{
  "name": "@orbit/launches-worker-azure",
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
    "@pulumi/azure-native": "^3",
    "@pulumi/random": "^4",
    "@azure/identity": "^4"
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

Run: `cd launches-worker-azure && npm install`
Expected: `node_modules/` created, `package-lock.json` generated

**Step 5: Verify TypeScript compiles**

Run: `cd launches-worker-azure && mkdir -p src && echo "export {}" > src/index.ts && npx tsc --noEmit && rm src/index.ts`
Expected: No errors

**Step 6: Commit**

```bash
git add launches-worker-azure/package.json launches-worker-azure/tsconfig.json launches-worker-azure/.gitignore launches-worker-azure/package-lock.json
git commit -m "feat(azure-worker): scaffold launches-worker-azure package"
```

---

## Task 2: Create Shared Types

**Files:**
- Create: `launches-worker-azure/src/types.ts`
- Create: `launches-worker-azure/src/__tests__/types.test.ts`

These are identical to the GCP/AWS workers — they match the Go workflow's JSON serialization contract.

**Step 1: Write the failing test**

Create: `launches-worker-azure/src/__tests__/types.test.ts`

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
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-456",
      provider: "azure",
      region: "eastus",
      parameters: { storageAccountName: "myaccount" },
    };
    expect(input.launchId).toBe("launch-123");
    expect(input.provider).toBe("azure");
    expect(input.parameters).toEqual({ storageAccountName: "myaccount" });
  });

  it("ProvisionInfraResult has outputs and summary", () => {
    const result: ProvisionInfraResult = {
      outputs: { storageAccountId: "/subscriptions/.../storageAccounts/myaccount" },
      summary: ["Created storage account"],
    };
    expect(result.outputs).toHaveProperty("storageAccountId");
    expect(result.summary).toHaveLength(1);
  });

  it("DestroyInfraInput has no parameters field", () => {
    const input: DestroyInfraInput = {
      launchId: "launch-123",
      stackName: "orbit-ws1-launch-123",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-456",
      provider: "azure",
      region: "eastus",
    };
    expect(input).not.toHaveProperty("parameters");
  });

  it("ValidateCredentialsResult shape", () => {
    const result: ValidateCredentialsResult = {
      valid: true,
      accountIdentifier: "sub-12345678-1234-1234-1234-123456789abc",
    };
    expect(result.valid).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-azure && npx vitest run src/__tests__/types.test.ts`
Expected: FAIL — `Cannot find module '../types'`

**Step 3: Write the types**

Create: `launches-worker-azure/src/types.ts`

```typescript
/**
 * Matches Go type: temporal-workflows/pkg/types/launch_types.go ProvisionInfraInput
 * The Go workflow serializes this as JSON when dispatching to launches_azure queue.
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

Run: `cd launches-worker-azure && npx vitest run src/__tests__/types.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add launches-worker-azure/src/types.ts launches-worker-azure/src/__tests__/types.test.ts
git commit -m "feat(azure-worker): add shared types matching Go workflow interface"
```

---

## Task 3: Implement the `provisionInfra` Activity

**Files:**
- Create: `launches-worker-azure/src/activities/provision.ts`
- Create: `launches-worker-azure/src/__tests__/provision.test.ts`

Key differences from GCP:
- Config keys: `azure-native:location` (from `input.region`), `azure-native:subscriptionId` (from `input.parameters.subscriptionId` or `AZURE_SUBSCRIPTION_ID` env var)
- Reserved parameter keys: `subscriptionId`, `location` (not passed as user config)
- Credentials via env vars: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

**Step 1: Write the failing test**

Create: `launches-worker-azure/src/__tests__/provision.test.ts`

```typescript
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

  it("sets azure-native:location and azure-native:subscriptionId config", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
      parameters: { storageAccountName: "myaccount", subscriptionId: "sub-123" },
    };

    await provisionInfra(input);

    expect(mockSetConfig).toHaveBeenCalledWith("azure-native:location", {
      value: "eastus",
    });
    expect(mockSetConfig).toHaveBeenCalledWith("azure-native:subscriptionId", {
      value: "sub-123",
    });
  });

  it("sets user parameters as Pulumi config", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
      parameters: { storageAccountName: "custom", subscriptionId: "sub-123" },
    };

    await provisionInfra(input);

    expect(mockSetConfig).toHaveBeenCalledWith("storageAccountName", {
      value: "custom",
    });
  });

  it("returns outputs from stack.up()", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
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
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
      parameters: { subscriptionId: "sub-123", storageAccountName: "b" },
    };

    await provisionInfra(input);

    const userConfigCalls = mockSetConfig.mock.calls.filter(
      (call: unknown[]) =>
        call[0] !== "azure-native:location" && call[0] !== "azure-native:subscriptionId"
    );
    const userKeys = userConfigCalls.map((call: unknown[]) => call[0]);
    expect(userKeys).not.toContain("subscriptionId");
    expect(userKeys).not.toContain("location");
  });

  it("throws if subscriptionId is not provided", async () => {
    const input: ProvisionInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
      parameters: {},
    };

    // Clear env var if set
    const origEnv = process.env.AZURE_SUBSCRIPTION_ID;
    delete process.env.AZURE_SUBSCRIPTION_ID;

    await expect(provisionInfra(input)).rejects.toThrow("Azure subscription ID is required");

    process.env.AZURE_SUBSCRIPTION_ID = origEnv;
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-azure && npx vitest run src/__tests__/provision.test.ts`
Expected: FAIL — `Cannot find module '../activities/provision'`

**Step 3: Write the implementation**

Create: `launches-worker-azure/src/activities/provision.ts`

```typescript
import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { ProvisionInfraInput, ProvisionInfraResult } from "../types";

/** Keys extracted from parameters and set as Azure provider config, not user config. */
const RESERVED_PARAM_KEYS = ["subscriptionId", "location"];

export async function provisionInfra(
  input: ProvisionInfraInput
): Promise<ProvisionInfraResult> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting Azure infrastructure provisioning", {
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

    // Azure requires subscriptionId and location
    const subscriptionId =
      (input.parameters.subscriptionId as string) ||
      process.env.AZURE_SUBSCRIPTION_ID ||
      "";
    if (!subscriptionId) {
      throw new Error(
        "Azure subscription ID is required: set parameters.subscriptionId or AZURE_SUBSCRIPTION_ID env var"
      );
    }
    await stack.setConfig("azure-native:subscriptionId", { value: subscriptionId });
    await stack.setConfig("azure-native:location", { value: input.region });

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

Run: `cd launches-worker-azure && npx vitest run src/__tests__/provision.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add launches-worker-azure/src/activities/provision.ts launches-worker-azure/src/__tests__/provision.test.ts
git commit -m "feat(azure-worker): implement provisionInfra activity"
```

---

## Task 4: Implement the `destroyInfra` Activity

**Files:**
- Create: `launches-worker-azure/src/activities/destroy.ts`
- Create: `launches-worker-azure/src/__tests__/destroy.test.ts`

Identical logic to GCP — only log messages change.

**Step 1: Write the failing test**

Create: `launches-worker-azure/src/__tests__/destroy.test.ts`

```typescript
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects the existing stack and destroys it", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
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
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
    };

    await destroyInfra(input);

    expect(mockRemoveStack).toHaveBeenCalledWith("orbit-ws1-launch-1");
  });

  it("returns void", async () => {
    const input: DestroyInfraInput = {
      launchId: "launch-1",
      stackName: "orbit-ws1-launch-1",
      templatePath: "resources/blob-storage",
      cloudAccountId: "ca-1",
      provider: "azure",
      region: "eastus",
    };

    const result = await destroyInfra(input);
    expect(result).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-azure && npx vitest run src/__tests__/destroy.test.ts`
Expected: FAIL — `Cannot find module '../activities/destroy'`

**Step 3: Write the implementation**

Create: `launches-worker-azure/src/activities/destroy.ts`

```typescript
import { Context } from "@temporalio/activity";
import { LocalWorkspace } from "@pulumi/pulumi/automation";
import * as path from "path";
import type { DestroyInfraInput } from "../types";

export async function destroyInfra(input: DestroyInfraInput): Promise<void> {
  const ctx = Context.current();
  const logger = ctx.log;

  logger.info("Starting Azure infrastructure destruction (deorbit)", {
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

    logger.info("Azure infrastructure deorbited successfully", {
      launchId: input.launchId,
    });
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd launches-worker-azure && npx vitest run src/__tests__/destroy.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add launches-worker-azure/src/activities/destroy.ts launches-worker-azure/src/__tests__/destroy.test.ts
git commit -m "feat(azure-worker): implement destroyInfra activity"
```

---

## Task 5: Implement the `validateCredentials` Activity

**Files:**
- Create: `launches-worker-azure/src/activities/validate-credentials.ts`
- Create: `launches-worker-azure/src/__tests__/validate-credentials.test.ts`

Uses `@azure/identity` `DefaultAzureCredential` to acquire a token for the ARM scope. Env vars `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` are read automatically by the SDK.

**Step 1: Write the failing test**

Create: `launches-worker-azure/src/__tests__/validate-credentials.test.ts`

```typescript
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns valid=true when credentials work", async () => {
    mockGetToken.mockResolvedValue({
      token: "eyJ...",
      expiresOnTimestamp: Date.now() + 3600000,
    });

    const origEnv = process.env.AZURE_SUBSCRIPTION_ID;
    process.env.AZURE_SUBSCRIPTION_ID = "sub-12345";

    const result = await validateCredentials({
      cloudAccountId: "ca-1",
      provider: "azure",
    });

    expect(result.valid).toBe(true);
    expect(result.accountIdentifier).toBe("sub-12345");
    expect(result.error).toBeUndefined();

    process.env.AZURE_SUBSCRIPTION_ID = origEnv;
  });

  it("returns valid=false when credentials fail", async () => {
    mockGetToken.mockRejectedValue(
      new Error("ClientSecretCredential authentication failed")
    );

    const result = await validateCredentials({
      cloudAccountId: "ca-1",
      provider: "azure",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("ClientSecretCredential authentication failed");
  });

  it("handles non-Error thrown values", async () => {
    mockGetToken.mockRejectedValue("unexpected string error");

    const result = await validateCredentials({
      cloudAccountId: "ca-1",
      provider: "azure",
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unknown error");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd launches-worker-azure && npx vitest run src/__tests__/validate-credentials.test.ts`
Expected: FAIL — `Cannot find module '../activities/validate-credentials'`

**Step 3: Write the implementation**

Create: `launches-worker-azure/src/activities/validate-credentials.ts`

```typescript
import { DefaultAzureCredential } from "@azure/identity";
import type {
  ValidateCredentialsInput,
  ValidateCredentialsResult,
} from "../types";

export async function validateCredentials(
  input: ValidateCredentialsInput
): Promise<ValidateCredentialsResult> {
  try {
    const credential = new DefaultAzureCredential();
    // Request a token for the Azure Resource Manager scope.
    // This will throw if AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
    // are not set or are invalid.
    await credential.getToken("https://management.azure.com/.default");

    return {
      valid: true,
      accountIdentifier: process.env.AZURE_SUBSCRIPTION_ID || "unknown",
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

Run: `cd launches-worker-azure && npx vitest run src/__tests__/validate-credentials.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add launches-worker-azure/src/activities/validate-credentials.ts launches-worker-azure/src/__tests__/validate-credentials.test.ts
git commit -m "feat(azure-worker): implement validateCredentials activity"
```

---

## Task 6: Activity Barrel Export + Worker Entry Point

**Files:**
- Create: `launches-worker-azure/src/activities/index.ts`
- Create: `launches-worker-azure/src/worker.ts`
- Create: `launches-worker-azure/src/__tests__/worker.test.ts`

**Step 1: Create barrel export**

Create: `launches-worker-azure/src/activities/index.ts`

```typescript
export { provisionInfra } from "./provision";
export { destroyInfra } from "./destroy";
export { validateCredentials } from "./validate-credentials";
```

**Step 2: Write worker test**

Create: `launches-worker-azure/src/__tests__/worker.test.ts`

```typescript
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
```

**Step 3: Write the Temporal worker**

Create: `launches-worker-azure/src/worker.ts`

```typescript
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";

async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS || "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE || "default";
  const taskQueue = process.env.TASK_QUEUE || "launches_azure";

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

  console.log(`Azure worker started, listening on task queue: ${taskQueue}`);
  await worker.run();
}

run().catch((err) => {
  console.error("Azure worker failed:", err);
  process.exit(1);
});
```

**Step 4: Run test and verify tsc**

Run: `cd launches-worker-azure && npx vitest run src/__tests__/worker.test.ts && npx tsc --noEmit`
Expected: PASS, no TS errors

**Step 5: Commit**

```bash
git add launches-worker-azure/src/activities/index.ts launches-worker-azure/src/worker.ts launches-worker-azure/src/__tests__/worker.test.ts
git commit -m "feat(azure-worker): add activity exports and Temporal worker entry point"
```

---

## Task 7: Blob Storage Pulumi Template

**Files:**
- Create: `launches-worker-azure/src/templates/resources/blob-storage/index.ts`
- Create: `launches-worker-azure/src/templates/resources/blob-storage/Pulumi.yaml`

Azure equivalent of S3 Bucket / GCS Bucket. Creates a Storage Account + Blob Container.

**Step 1: Create Pulumi config**

Create: `launches-worker-azure/src/templates/resources/blob-storage/Pulumi.yaml`

```yaml
name: orbit-blob-storage
runtime: nodejs
description: Provisions an Azure Storage Account with a Blob Container
```

**Step 2: Write the implementation**

Create: `launches-worker-azure/src/templates/resources/blob-storage/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const storageAccountName = config.get("storageAccountName") || `orbit${pulumi.getStack().replace(/-/g, "").slice(0, 18)}`;
const containerName = config.get("containerName") || "default";
const resourceGroupName = config.require("resourceGroupName");
const enableVersioning = config.getBoolean("enableVersioning") ?? false;
const publicAccess = config.getBoolean("publicAccess") ?? false;

const storageAccount = new azure.storage.StorageAccount("orbit-storage", {
  accountName: storageAccountName,
  resourceGroupName,
  kind: azure.storage.Kind.StorageV2,
  sku: { name: azure.storage.SkuName.Standard_LRS },
  enableHttpsTrafficOnly: true,
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

if (enableVersioning) {
  new azure.storage.BlobServiceProperties("orbit-versioning", {
    accountName: storageAccount.name,
    resourceGroupName,
    blobServiceName: "default",
    isVersioningEnabled: true,
  });
}

const container = new azure.storage.BlobContainer("orbit-container", {
  containerName,
  accountName: storageAccount.name,
  resourceGroupName,
  publicAccess: publicAccess
    ? azure.storage.PublicAccess.Container
    : azure.storage.PublicAccess.None,
});

export const storageAccountId = storageAccount.id;
export const storageAccountNameOutput = storageAccount.name;
export const primaryEndpoint = storageAccount.primaryEndpoints.apply(
  (ep) => ep.blob
);
export const containerNameOutput = container.name;
```

**Step 3: Commit**

```bash
git add launches-worker-azure/src/templates/resources/blob-storage/
git commit -m "feat(azure-worker): add Blob Storage Pulumi template"
```

---

## Task 8: PostgreSQL Flexible Server Pulumi Template

**Files:**
- Create: `launches-worker-azure/src/templates/resources/postgresql-flexible/index.ts`
- Create: `launches-worker-azure/src/templates/resources/postgresql-flexible/Pulumi.yaml`

**Step 1: Create Pulumi config**

Create: `launches-worker-azure/src/templates/resources/postgresql-flexible/Pulumi.yaml`

```yaml
name: orbit-postgresql-flexible
runtime: nodejs
description: Provisions an Azure Database for PostgreSQL Flexible Server
```

**Step 2: Write the implementation**

Create: `launches-worker-azure/src/templates/resources/postgresql-flexible/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const serverName = config.get("serverName") || `orbit-${pulumi.getStack()}`;
const resourceGroupName = config.require("resourceGroupName");
const skuName = config.get("skuName") || "Standard_B1ms";
const skuTier = config.get("skuTier") || "Burstable";
const storageSizeGB = config.getNumber("storageSizeGB") || 32;
const dbName = config.get("databaseName") || "orbit";
const adminUser = config.get("adminUser") || "orbitadmin";
const postgresVersion = config.get("postgresVersion") || "16";

const password = new random.RandomPassword("db-password", {
  length: 24,
  special: false,
});

const server = new azure.dbforpostgresql.Server("orbit-pg-server", {
  serverName,
  resourceGroupName,
  administratorLogin: adminUser,
  administratorLoginPassword: password.result,
  version: postgresVersion,
  sku: {
    name: skuName,
    tier: skuTier,
  },
  storage: {
    storageSizeGB,
  },
  backup: {
    backupRetentionDays: 7,
    geoRedundantBackup: "Disabled",
  },
  highAvailability: {
    mode: "Disabled",
  },
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

const database = new azure.dbforpostgresql.Database("orbit-database", {
  databaseName: dbName,
  serverName: server.name,
  resourceGroupName,
});

// Allow Azure services to connect
new azure.dbforpostgresql.FirewallRule("allow-azure-services", {
  firewallRuleName: "AllowAzureServices",
  serverName: server.name,
  resourceGroupName,
  startIpAddress: "0.0.0.0",
  endIpAddress: "0.0.0.0",
});

export const fullyQualifiedDomainName = server.fullyQualifiedDomainName;
export const databaseName = database.name;
export const adminUsername = pulumi.output(adminUser);
export const adminPassword = pulumi.secret(password.result);
```

**Step 3: Commit**

```bash
git add launches-worker-azure/src/templates/resources/postgresql-flexible/
git commit -m "feat(azure-worker): add PostgreSQL Flexible Server Pulumi template"
```

---

## Task 9: Container App Pulumi Template

**Files:**
- Create: `launches-worker-azure/src/templates/resources/container-app/index.ts`
- Create: `launches-worker-azure/src/templates/resources/container-app/Pulumi.yaml`

Azure equivalent of Cloud Run / ECS Fargate. Creates a Managed Environment + Container App.

**Step 1: Create Pulumi config**

Create: `launches-worker-azure/src/templates/resources/container-app/Pulumi.yaml`

```yaml
name: orbit-container-app
runtime: nodejs
description: Provisions an Azure Container App with a Managed Environment
```

**Step 2: Write the implementation**

Create: `launches-worker-azure/src/templates/resources/container-app/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const appName = config.get("appName") || `orbit-${pulumi.getStack()}`;
const resourceGroupName = config.require("resourceGroupName");
const image =
  config.get("containerImage") ||
  "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest";
const targetPort = config.getNumber("containerPort") || 80;
const cpu = config.getNumber("cpu") || 0.5;
const memory = config.get("memory") || "1Gi";
const maxReplicas = config.getNumber("maxReplicas") || 10;
const minReplicas = config.getNumber("minReplicas") || 1;
const externalIngress = config.getBoolean("externalIngress") ?? true;

const environment = new azure.app.ManagedEnvironment("orbit-env", {
  environmentName: `${appName}-env`,
  resourceGroupName,
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

const containerApp = new azure.app.ContainerApp("orbit-app", {
  containerAppName: appName,
  resourceGroupName,
  managedEnvironmentId: environment.id,
  template: {
    containers: [
      {
        name: "app",
        image,
        resources: {
          cpu,
          memory,
        },
      },
    ],
    scale: {
      minReplicas,
      maxReplicas,
    },
  },
  configuration: {
    ingress: {
      external: externalIngress,
      targetPort,
    },
  },
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

export const appUrl = containerApp.configuration.apply(
  (c) => c?.ingress?.fqdn ?? ""
);
export const appId = containerApp.id;
export const environmentId = environment.id;
```

**Step 3: Commit**

```bash
git add launches-worker-azure/src/templates/resources/container-app/
git commit -m "feat(azure-worker): add Container App Pulumi template"
```

---

## Task 10: Virtual Network (VNet) Pulumi Template

**Files:**
- Create: `launches-worker-azure/src/templates/resources/vnet/index.ts`
- Create: `launches-worker-azure/src/templates/resources/vnet/Pulumi.yaml`

**Step 1: Create Pulumi config**

Create: `launches-worker-azure/src/templates/resources/vnet/Pulumi.yaml`

```yaml
name: orbit-vnet
runtime: nodejs
description: Provisions an Azure Virtual Network with subnet and NSG
```

**Step 2: Write the implementation**

Create: `launches-worker-azure/src/templates/resources/vnet/index.ts`

```typescript
import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const vnetName = config.get("vnetName") || `orbit-${pulumi.getStack()}`;
const resourceGroupName = config.require("resourceGroupName");
const addressPrefix = config.get("addressPrefix") || "10.0.0.0/16";
const subnetPrefix = config.get("subnetPrefix") || "10.0.1.0/24";

const vnet = new azure.network.VirtualNetwork("orbit-vnet", {
  virtualNetworkName: vnetName,
  resourceGroupName,
  addressSpace: {
    addressPrefixes: [addressPrefix],
  },
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

const nsg = new azure.network.NetworkSecurityGroup("orbit-nsg", {
  networkSecurityGroupName: `${vnetName}-nsg`,
  resourceGroupName,
  securityRules: [
    {
      name: "allow-https-inbound",
      priority: 100,
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      sourcePortRange: "*",
      destinationPortRange: "443",
      sourceAddressPrefix: "*",
      destinationAddressPrefix: "*",
    },
    {
      name: "allow-ssh-inbound",
      priority: 110,
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      sourcePortRange: "*",
      destinationPortRange: "22",
      sourceAddressPrefix: "*",
      destinationAddressPrefix: "*",
    },
  ],
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

const subnet = new azure.network.Subnet("orbit-subnet", {
  subnetName: "default",
  virtualNetworkName: vnet.name,
  resourceGroupName,
  addressPrefix: subnetPrefix,
  networkSecurityGroup: {
    id: nsg.id,
  },
});

export const vnetId = vnet.id;
export const vnetName_output = vnet.name;
export const subnetId = subnet.id;
export const nsgId = nsg.id;
```

**Step 3: Commit**

```bash
git add launches-worker-azure/src/templates/resources/vnet/
git commit -m "feat(azure-worker): add VNet Pulumi template"
```

---

## Task 11: Dockerfile

**Files:**
- Create: `launches-worker-azure/Dockerfile`

**Step 1: Write the Dockerfile**

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/worker.js"]
```

**Step 2: Commit**

```bash
git add launches-worker-azure/Dockerfile
git commit -m "feat(azure-worker): add Dockerfile"
```

---

## Task 12: Docker Compose Service

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Read the file to find insertion point**

Run: `grep -n "launches-worker-gcp" docker-compose.yml | tail -1`
Find the last line of the GCP worker block and add Azure after it.

**Step 2: Add the Azure worker service**

Add after the `launches-worker-gcp` service:

```yaml
  launches-worker-azure:
    container_name: orbit-launches-worker-azure
    build:
      context: ./launches-worker-azure
      dockerfile: Dockerfile
    depends_on:
      temporal-server:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      - TEMPORAL_ADDRESS=temporal-server:7233
      - TEMPORAL_NAMESPACE=default
      - TASK_QUEUE=launches_azure
      - PULUMI_BACKEND_URL=s3://pulumi-state?endpoint=minio:9000&s3ForcePathStyle=true
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AZURE_TENANT_ID=${AZURE_TENANT_ID:-}
      - AZURE_CLIENT_ID=${AZURE_CLIENT_ID:-}
      - AZURE_CLIENT_SECRET=${AZURE_CLIENT_SECRET:-}
      - AZURE_SUBSCRIPTION_ID=${AZURE_SUBSCRIPTION_ID:-}
    restart: unless-stopped
```

Note: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are for the MinIO Pulumi state backend. `AZURE_*` vars are for Azure service principal auth.

**Step 3: Verify**

Run: `docker compose config --quiet`
Expected: No errors

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(azure-worker): add launches-worker-azure to docker-compose"
```

---

## Task 13: Seed Azure Launch Templates

**Files:**
- Modify: `orbit-www/src/seed/launch-templates-seed.ts`

IMPORTANT: The collection field is `pulumiProjectPath` (NOT `pulumiProgram`). Use `pulumiProjectPath` for all entries.

**Step 1: Read the current seed file**

Run: `cat orbit-www/src/seed/launch-templates-seed.ts`

**Step 2: Add 6 Azure templates to the array**

Append these to the templates array:

```typescript
    // --- Azure Individual Resources ---
    {
      name: 'Blob Storage',
      slug: 'azure-blob-storage',
      description: 'Provision an Azure Storage Account with a Blob Container, configurable versioning, and access controls.',
      type: 'resource',
      provider: 'azure',
      category: 'storage',
      pulumiProjectPath: 'resources/blob-storage',
      estimatedDuration: '~2 min',
      parameterSchema: {
        type: 'object',
        properties: {
          resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
          storageAccountName: { type: 'string', title: 'Storage Account Name', description: 'Globally unique, lowercase, 3-24 chars' },
          containerName: { type: 'string', title: 'Container Name', default: 'default' },
          enableVersioning: { type: 'boolean', title: 'Enable Versioning', default: false },
          publicAccess: { type: 'boolean', title: 'Allow Public Access', default: false },
        },
        required: ['resourceGroupName', 'storageAccountName'],
      },
    },
    {
      name: 'PostgreSQL Flexible Server',
      slug: 'azure-postgresql-flexible',
      description: 'Provision an Azure Database for PostgreSQL Flexible Server with automated backups, a database, and admin credentials.',
      type: 'resource',
      provider: 'azure',
      category: 'database',
      pulumiProjectPath: 'resources/postgresql-flexible',
      estimatedDuration: '~10 min',
      parameterSchema: {
        type: 'object',
        properties: {
          resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
          serverName: { type: 'string', title: 'Server Name', description: 'PostgreSQL server name' },
          postgresVersion: { type: 'string', title: 'PostgreSQL Version', default: '16', enum: ['16', '15', '14'] },
          skuName: { type: 'string', title: 'SKU Name', default: 'Standard_B1ms', enum: ['Standard_B1ms', 'Standard_B2s', 'Standard_D4ds_v5'] },
          skuTier: { type: 'string', title: 'SKU Tier', default: 'Burstable', enum: ['Burstable', 'GeneralPurpose', 'MemoryOptimized'] },
          storageSizeGB: { type: 'number', title: 'Storage (GB)', default: 32 },
          databaseName: { type: 'string', title: 'Database Name', default: 'orbit' },
          adminUser: { type: 'string', title: 'Admin User', default: 'orbitadmin' },
        },
        required: ['resourceGroupName'],
      },
    },
    {
      name: 'Container App',
      slug: 'azure-container-app',
      description: 'Deploy a containerized application to Azure Container Apps with auto-scaling, managed environment, and ingress configuration.',
      type: 'resource',
      provider: 'azure',
      category: 'container',
      pulumiProjectPath: 'resources/container-app',
      estimatedDuration: '~3 min',
      parameterSchema: {
        type: 'object',
        properties: {
          resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
          appName: { type: 'string', title: 'App Name', description: 'Container app name' },
          containerImage: { type: 'string', title: 'Container Image', description: 'Container image URL' },
          containerPort: { type: 'number', title: 'Container Port', default: 80 },
          cpu: { type: 'number', title: 'CPU (cores)', default: 0.5, enum: [0.25, 0.5, 1, 2, 4] },
          memory: { type: 'string', title: 'Memory', default: '1Gi', enum: ['0.5Gi', '1Gi', '2Gi', '4Gi'] },
          maxReplicas: { type: 'number', title: 'Max Replicas', default: 10 },
          minReplicas: { type: 'number', title: 'Min Replicas', default: 1 },
          externalIngress: { type: 'boolean', title: 'External Ingress', default: true },
        },
        required: ['resourceGroupName', 'containerImage'],
      },
    },
    {
      name: 'Virtual Network',
      slug: 'azure-vnet',
      description: 'Create an Azure Virtual Network with subnet, Network Security Group, and configurable address space.',
      type: 'resource',
      provider: 'azure',
      category: 'networking',
      pulumiProjectPath: 'resources/vnet',
      estimatedDuration: '~2 min',
      parameterSchema: {
        type: 'object',
        properties: {
          resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
          vnetName: { type: 'string', title: 'VNet Name', description: 'Name for the virtual network' },
          addressPrefix: { type: 'string', title: 'Address Space', default: '10.0.0.0/16' },
          subnetPrefix: { type: 'string', title: 'Subnet CIDR', default: '10.0.1.0/24' },
        },
        required: ['resourceGroupName'],
      },
    },
    // --- Azure Bundles ---
    {
      name: 'Web App Backend',
      slug: 'azure-web-app-backend',
      description: 'Full backend stack: VNet, Container App, PostgreSQL Flexible Server, Application Gateway, and managed identities — everything needed for a production Azure web backend.',
      type: 'bundle',
      provider: 'azure',
      category: 'compute',
      pulumiProjectPath: 'bundles/web-app-backend',
      estimatedDuration: '~15 min',
      parameterSchema: {
        type: 'object',
        properties: {
          resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
          appName: { type: 'string', title: 'Application Name', description: 'Name prefix for all resources' },
          containerImage: { type: 'string', title: 'Container Image', description: 'Container image for the app' },
          dbSkuName: { type: 'string', title: 'Database SKU', default: 'Standard_B1ms', enum: ['Standard_B1ms', 'Standard_B2s', 'Standard_D4ds_v5'] },
        },
        required: ['resourceGroupName', 'appName', 'containerImage'],
      },
    },
    {
      name: 'Static Site',
      slug: 'azure-static-site',
      description: 'Host a static website with Azure Storage static website hosting, CDN profile, and custom domain — optimized for global content delivery.',
      type: 'bundle',
      provider: 'azure',
      category: 'storage',
      pulumiProjectPath: 'bundles/static-site',
      estimatedDuration: '~5 min',
      parameterSchema: {
        type: 'object',
        properties: {
          resourceGroupName: { type: 'string', title: 'Resource Group', description: 'Azure resource group name' },
          siteName: { type: 'string', title: 'Site Name', description: 'Name prefix for all resources' },
          domainName: { type: 'string', title: 'Domain Name', description: 'Custom domain (e.g., www.example.com)' },
          enableCdn: { type: 'boolean', title: 'Enable CDN', default: true },
        },
        required: ['resourceGroupName', 'siteName'],
      },
    },
```

**Step 3: Run the seed script**

Run: `cd orbit-www && bun run tsx src/scripts/seed-launch-templates.ts`
Expected: 6 Azure templates created, 12 skipped

**Step 4: Commit**

```bash
git add orbit-www/src/seed/launch-templates-seed.ts
git commit -m "feat(azure-worker): seed 6 Azure launch templates"
```

---

## Task 14: Update Documentation

**Files:**
- Modify: `orbit-docs/content/docs/features/launches.mdx`

**Step 1: Add Azure to the Pulumi Programs section**

After the GCP block, add:

```markdown
For Azure, these are in `launches-worker-azure/src/templates/`:

\`\`\`
launches-worker-azure/src/templates/
  resources/
    blob-storage/
    postgresql-flexible/
    container-app/
    vnet/
\`\`\`
```

**Step 2: Update seed script count**

Change "12 templates: 6 for AWS and 6 for GCP" to "18 templates: 6 each for AWS, GCP, and Azure".

**Step 3: Commit**

```bash
git add orbit-docs/content/docs/features/launches.mdx
git commit -m "docs: update Launches documentation for Azure support"
```

---

## Task 15: Run All Tests and Verify

**Step 1: Run Azure worker unit tests**

Run: `cd launches-worker-azure && npx vitest run`
Expected: All tests pass (13+ tests)

**Step 2: Verify TypeScript compiles**

Run: `cd launches-worker-azure && npx tsc --noEmit`
Expected: No errors

**Step 3: Verify Docker Compose config**

Run: `docker compose config --quiet`
Expected: No errors

**Step 4: Run GCP worker tests to verify nothing broke**

Run: `cd launches-worker-gcp && npx vitest run`
Expected: All 15 tests still pass

**Step 5: Final commit if any fixups needed**

Only if tests revealed issues.
