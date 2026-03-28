package main

import (
	"context"
	"fmt"
	"log"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func main() {
	conn, err := grpc.NewClient("localhost:50060", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	client := gatewayv1.NewBifrostAdminServiceClient(conn)

	// Seed virtual clusters
	clusters := []gatewayv1.VirtualClusterConfig{
		{
			Id:                       "69c71df64bd38b26df224f73",
			WorkspaceSlug:            "engineering",
			Environment:              "dev",
			TopicPrefix:              "engineering-engineering-dev-",
			GroupPrefix:              "engineering-engineering-dev-",
			AdvertisedHost:           "engineering-dev.dev.kafka.orbit.io",
			AdvertisedPort:           9092,
			PhysicalBootstrapServers: "redpanda:9092",
		},
		{
			Id:                       "69c7e3c1d0b6ac3981a08d39",
			WorkspaceSlug:            "engineering",
			Environment:              "prod",
			TopicPrefix:              "engineering-engineering-prod-",
			GroupPrefix:              "engineering-engineering-prod-",
			AdvertisedHost:           "engineering-prod.prod.kafka.orbit.io",
			AdvertisedPort:           9092,
			PhysicalBootstrapServers: "192.168.86.200:31092",
		},
	}

	for _, vc := range clusters {
		resp, err := client.UpsertVirtualCluster(context.Background(), &gatewayv1.UpsertVirtualClusterRequest{
			Config: &vc,
		})
		if err != nil {
			log.Printf("Failed to upsert %s: %v", vc.Id, err)
			continue
		}
		fmt.Printf("Upserted %s (%s-%s): success=%v\n", vc.Id, vc.WorkspaceSlug, vc.Environment, resp.Success)
	}

	status, err := client.GetStatus(context.Background(), &gatewayv1.GetStatusRequest{})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Bifrost status: %s, vc_count=%d\n", status.Status, status.VirtualClusterCount)
}
