import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const appName = config.require("appName");
const dbTier = config.get("dbTier") || "db-f1-micro";
const containerImage = config.get("containerImage") || "gcr.io/cloudrun/hello";

const stack = pulumi.getStack();

// VPC Network
const network = new gcp.compute.Network("app-network", {
  autoCreateSubnetworks: false,
});

const subnet = new gcp.compute.Subnetwork("app-subnet", {
  network: network.id,
  ipCidrRange: "10.0.0.0/24",
  privateIpGoogleAccess: true,
});

// Cloud SQL PostgreSQL
const dbPassword = new random.RandomPassword("db-password", { length: 24 });

const dbInstance = new gcp.sql.DatabaseInstance("app-db", {
  databaseVersion: "POSTGRES_15",
  settings: {
    tier: dbTier,
    ipConfiguration: {
      ipv4Enabled: true,
    },
    userLabels: {
      managed_by: "orbit",
      stack,
      app: appName,
    },
  },
  deletionProtection: false,
});

const db = new gcp.sql.Database("app-database", {
  instance: dbInstance.name,
  name: appName.replace(/[^a-z0-9_]/g, "_"),
});

const dbUser = new gcp.sql.User("app-db-user", {
  instance: dbInstance.name,
  name: `${appName}-user`,
  password: dbPassword.result,
});

// Cloud Run Service
const service = new gcp.cloudrunv2.Service("app-service", {
  location: gcp.config.region || "us-central1",
  template: {
    containers: [{
      image: containerImage,
      envs: [
        { name: "APP_NAME", value: appName },
        { name: "DB_HOST", value: dbInstance.publicIpAddress },
        { name: "DB_NAME", value: db.name },
      ],
      resources: {
        limits: {
          cpu: "1",
          memory: "512Mi",
        },
      },
    }],
    scaling: {
      minInstanceCount: 0,
      maxInstanceCount: 5,
    },
  },
  labels: {
    managed_by: "orbit",
    stack,
    app: appName,
  },
});

// Make Cloud Run publicly accessible
const iamMember = new gcp.cloudrunv2.ServiceIamMember("app-public", {
  name: service.name,
  location: service.location,
  role: "roles/run.invoker",
  member: "allUsers",
});

export const serviceUrl = service.uri;
export const serviceName = service.name;
export const dbConnectionName = dbInstance.connectionName;
export const dbPublicIp = dbInstance.publicIpAddress;
export const networkName = network.name;
