import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const bucketName = config.get("bucketName") || pulumi.getStack();
const versioning = config.getBoolean("versioning") ?? false;
const publicAccess = config.getBoolean("publicAccess") ?? false;

const bucket = new aws.s3.BucketV2("orbit-bucket", {
  bucket: bucketName,
  tags: {
    ManagedBy: "orbit",
    Stack: pulumi.getStack(),
  },
});

if (versioning) {
  new aws.s3.BucketVersioningV2("orbit-bucket-versioning", {
    bucket: bucket.id,
    versioningConfiguration: {
      status: "Enabled",
    },
  });
}

if (!publicAccess) {
  new aws.s3.BucketPublicAccessBlock("orbit-bucket-public-access", {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });
}

export const bucketId = bucket.id;
export const bucketArn = bucket.arn;
export const bucketDomainName = bucket.bucketDomainName;
