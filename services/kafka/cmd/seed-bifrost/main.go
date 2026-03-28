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

	resp, err := client.UpsertVirtualCluster(context.Background(), &gatewayv1.UpsertVirtualClusterRequest{
		Config: &gatewayv1.VirtualClusterConfig{
			Id:                       "69c71df64bd38b26df224f73",
			WorkspaceSlug:            "engineering",
			Environment:              "dev",
			TopicPrefix:              "engineering-engineering-dev-",
			GroupPrefix:              "engineering-engineering-dev-",
			AdvertisedHost:           "engineering-dev.dev.kafka.orbit.io",
			AdvertisedPort:           9092,
			PhysicalBootstrapServers: "redpanda:19092",
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Upserted virtual cluster: success=%v\n", resp.Success)

	status, err := client.GetStatus(context.Background(), &gatewayv1.GetStatusRequest{})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Bifrost status: %s, vc_count=%d\n", status.Status, status.VirtualClusterCount)
}
