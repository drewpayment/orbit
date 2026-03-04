import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const vnetName = config.get("vnetName") || `orbit-${pulumi.getStack()}`;
const resourceGroupName = config.require("resourceGroupName");
const addressPrefix = config.get("addressPrefix") || "10.0.0.0/16";
const subnetPrefix = config.get("subnetPrefix") || "10.0.1.0/24";

const vnet = new azure.network.VirtualNetwork("orbit-vnet", {
  virtualNetworkName: vnetName,
  resourceGroupName,
  addressSpace: {
    addressPrefixes: [addressPrefix],
  },
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

const nsg = new azure.network.NetworkSecurityGroup("orbit-nsg", {
  networkSecurityGroupName: `${vnetName}-nsg`,
  resourceGroupName,
  securityRules: [
    {
      name: "allow-https-inbound",
      priority: 100,
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      sourcePortRange: "*",
      destinationPortRange: "443",
      sourceAddressPrefix: "*",
      destinationAddressPrefix: "*",
    },
    {
      name: "allow-ssh-inbound",
      priority: 110,
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      sourcePortRange: "*",
      destinationPortRange: "22",
      sourceAddressPrefix: "*",
      destinationAddressPrefix: "*",
    },
  ],
  tags: {
    managed_by: "orbit",
    stack: pulumi.getStack(),
  },
});

const subnet = new azure.network.Subnet("orbit-subnet", {
  subnetName: "default",
  virtualNetworkName: vnet.name,
  resourceGroupName,
  addressPrefix: subnetPrefix,
  networkSecurityGroup: {
    id: nsg.id,
  },
});

export const vnetId = vnet.id;
export const vnetName_output = vnet.name;
export const subnetId = subnet.id;
export const nsgId = nsg.id;
