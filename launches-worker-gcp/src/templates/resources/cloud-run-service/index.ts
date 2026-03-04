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
const location = config.get("location") || "us-central1";
const allowUnauthenticated = config.getBoolean("allowUnauthenticated") ?? false;

const service = new gcp.cloudrunv2.Service("orbit-run-service", {
  name: serviceName,
  location,
  ingress: "INGRESS_TRAFFIC_ALL",
  template: {
    scaling: {
      maxInstanceCount: maxInstances,
    },
    containers: [
      {
        image,
        ports: { containerPort: port },
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
