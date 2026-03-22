import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const siteName = config.require("siteName");
const enableCdn = config.getBoolean("enableCdn") ?? false;

// Generate a short unique suffix from the stack name
const stackHash = pulumi.getStack().split("-").pop()?.substring(0, 8) || "default";

// GCS bucket for static site hosting
const bucket = new gcp.storage.Bucket("site-bucket", {
  name: `${siteName}-${stackHash}`,
  location: "US",
  forceDestroy: true,
  uniformBucketLevelAccess: false,
  website: {
    mainPageSuffix: "index.html",
    notFoundPage: "404.html",
  },
  labels: {
    managed_by: "orbit",
    site: siteName,
  },
});

// Make bucket publicly readable
const bucketIamBinding = new gcp.storage.BucketIAMBinding("site-public-read", {
  bucket: bucket.name,
  role: "roles/storage.objectViewer",
  members: ["allUsers"],
});

// Outputs
export const bucketName = bucket.name;
export const bucketUrl = pulumi.interpolate`gs://${bucket.name}`;
export const websiteUrl = pulumi.interpolate`https://storage.googleapis.com/${bucket.name}/index.html`;

// Optional: Cloud CDN with Load Balancer
let cdnIpOutput: pulumi.Output<string> | undefined;
let cdnUrlOutput: pulumi.Output<string> | undefined;

if (enableCdn) {
  const backendBucket = new gcp.compute.BackendBucket("site-backend", {
    bucketName: bucket.name,
    enableCdn: true,
    cdnPolicy: {
      cacheMode: "CACHE_ALL_STATIC",
      defaultTtl: 3600,
      maxTtl: 86400,
    },
  });

  const urlMap = new gcp.compute.URLMap("site-url-map", {
    defaultService: backendBucket.selfLink,
  });

  const httpProxy = new gcp.compute.TargetHttpProxy("site-http-proxy", {
    urlMap: urlMap.selfLink,
  });

  const globalAddress = new gcp.compute.GlobalAddress("site-ip", {});

  const forwardingRule = new gcp.compute.GlobalForwardingRule("site-forwarding", {
    target: httpProxy.selfLink,
    ipAddress: globalAddress.address,
    portRange: "80",
  });

  cdnIpOutput = globalAddress.address;
  cdnUrlOutput = pulumi.interpolate`http://${globalAddress.address}`;
}

export const cdnIp = cdnIpOutput;
export const cdnUrl = cdnUrlOutput;
