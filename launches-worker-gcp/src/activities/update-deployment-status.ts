import type { UpdateDeploymentStatusInput } from "../types";

const ORBIT_API_URL = process.env.ORBIT_API_URL || "http://host.docker.internal:3000";
const ORBIT_INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY || "orbit-internal-dev-key";

export async function updateDeploymentStatus(
  input: UpdateDeploymentStatusInput
): Promise<void> {
  const body: Record<string, unknown> = { status: input.status };
  if (input.error) body.error = input.error;
  if (input.url) body.url = input.url;
  if (input.status === "deployed") body.lastDeployedAt = new Date().toISOString();

  const response = await fetch(
    `${ORBIT_API_URL}/api/internal/deployments/${input.deploymentId}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ORBIT_INTERNAL_API_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update deployment status: ${response.status}`);
  }
}
