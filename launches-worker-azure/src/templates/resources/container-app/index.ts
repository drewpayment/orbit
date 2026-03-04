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
