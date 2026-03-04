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
