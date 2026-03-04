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
