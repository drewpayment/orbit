import { Context } from "@temporalio/activity";
import { Storage } from "@google-cloud/storage";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { DeployToLaunchInput, DeployToLaunchResult } from "../types";

export async function deployStaticSite(
  input: DeployToLaunchInput
): Promise<DeployToLaunchResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const bucketName = input.launchOutputs.bucketName as string;

  if (!bucketName) {
    throw new Error("Launch outputs missing bucketName");
  }

  logger.info("Starting static site deployment", {
    deploymentId: input.deploymentId,
    repoUrl: input.repoUrl,
    bucket: bucketName,
  });

  const heartbeatInterval = setInterval(() => {
    ctx.heartbeat("deploying static site");
  }, 5000);

  const workDir = path.join(os.tmpdir(), `deploy-${input.deploymentId}`);

  try {
    // Clone repo
    logger.info(`Cloning ${input.repoUrl} (branch: ${input.branch})`);
    execSync(
      `git clone --depth 1 --branch ${input.branch} ${input.repoUrl} ${workDir}`,
      { stdio: "pipe", timeout: 120000 }
    );

    // Install dependencies
    logger.info("Installing dependencies");
    const hasYarnLock = fs.existsSync(path.join(workDir, "yarn.lock"));
    const hasPnpmLock = fs.existsSync(path.join(workDir, "pnpm-lock.yaml"));
    const hasBunLock = fs.existsSync(path.join(workDir, "bun.lockb"));

    const hasPackageLock = fs.existsSync(path.join(workDir, "package-lock.json"));

    let installCmd = "npm install";
    if (hasBunLock) installCmd = "bun install --frozen-lockfile";
    else if (hasPnpmLock) installCmd = "npx pnpm install --frozen-lockfile";
    else if (hasYarnLock) installCmd = "yarn install --frozen-lockfile";
    else if (hasPackageLock) installCmd = "npm ci";

    execSync(installCmd, { cwd: workDir, stdio: "pipe", timeout: 300000 });

    // Build
    logger.info(`Running build: ${input.buildCommand}`);
    execSync(input.buildCommand, {
      cwd: workDir,
      stdio: "pipe",
      timeout: 600000,
      env: { ...process.env, NODE_ENV: "production", ...(input.buildEnv || {}) },
    });

    // Find output directory
    const outputDir = path.join(workDir, input.outputDirectory);
    if (!fs.existsSync(outputDir)) {
      const dirs = fs.readdirSync(workDir).filter(f =>
        fs.statSync(path.join(workDir, f)).isDirectory() && !f.startsWith('.') && f !== 'node_modules'
      );
      throw new Error(
        `Output directory '${input.outputDirectory}' not found after build. ` +
        `Available directories: ${dirs.join(", ")}`
      );
    }

    // Upload to GCS
    logger.info(`Uploading to gs://${bucketName}`);
    const storage = new Storage();
    const bucket = storage.bucket(bucketName);

    let filesCount = 0;
    const uploadDir = async (dir: string, prefix: string = "") => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const destination = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await uploadDir(fullPath, destination);
        } else {
          await bucket.upload(fullPath, {
            destination,
            metadata: {
              cacheControl: entry.name.match(/\.(js|css|woff2?|png|jpg|svg|ico)$/)
                ? "public, max-age=31536000, immutable"
                : "public, max-age=60",
            },
          });
          filesCount++;
        }
      }
    };

    await uploadDir(outputDir);

    const websiteUrl =
      (input.launchOutputs.websiteUrl as string) ||
      `https://storage.googleapis.com/${bucketName}/index.html`;

    logger.info(`Deployment complete: ${filesCount} files uploaded to ${websiteUrl}`);

    return {
      deployedUrl: websiteUrl,
      filesCount,
      summary: [`Uploaded ${filesCount} files to gs://${bucketName}`, `URL: ${websiteUrl}`],
    };
  } finally {
    clearInterval(heartbeatInterval);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}
