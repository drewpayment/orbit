import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const networkName = config.get("networkName") || `orbit-${pulumi.getStack()}`;
const subnetCidr = config.get("subnetCidr") || "10.0.0.0/24";
const enableNat = config.getBoolean("enableNat") ?? true;

const network = new gcp.compute.Network("orbit-network", {
  name: networkName,
  autoCreateSubnetworks: false,
});

const subnet = new gcp.compute.Subnetwork("orbit-subnet", {
  name: `${networkName}-subnet`,
  ipCidrRange: subnetCidr,
  network: network.id,
  privateIpGoogleAccess: true,
});

// Allow internal traffic
new gcp.compute.Firewall("orbit-allow-internal", {
  name: `${networkName}-allow-internal`,
  network: network.id,
  allows: [
    { protocol: "tcp", ports: ["0-65535"] },
    { protocol: "udp", ports: ["0-65535"] },
    { protocol: "icmp" },
  ],
  sourceRanges: [subnetCidr],
});

// Allow SSH from IAP
new gcp.compute.Firewall("orbit-allow-iap-ssh", {
  name: `${networkName}-allow-iap-ssh`,
  network: network.id,
  allows: [{ protocol: "tcp", ports: ["22"] }],
  sourceRanges: ["35.235.240.0/20"], // Google IAP range
});

let natIpAddress: pulumi.Output<string> | undefined;

if (enableNat) {
  const router = new gcp.compute.Router("orbit-router", {
    name: `${networkName}-router`,
    network: network.id,
  });

  const nat = new gcp.compute.RouterNat("orbit-nat", {
    name: `${networkName}-nat`,
    router: router.name,
    natIpAllocateOption: "AUTO_ONLY",
    sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES",
  });

  natIpAddress = nat.name;
}

export const networkId = network.id;
export const networkSelfLink = network.selfLink;
export const subnetId = subnet.id;
export const subnetSelfLink = subnet.selfLink;
