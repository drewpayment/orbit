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
