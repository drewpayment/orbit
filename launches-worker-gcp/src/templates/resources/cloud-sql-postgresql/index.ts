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
