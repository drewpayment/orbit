package tests

import (
	"context"
	"testing"
	"time"

	pluginsv1 "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func TestListPlugins(t *testing.T) {
	// Connect to the gRPC server
	conn, err := grpc.Dial("localhost:50053", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	client := pluginsv1.NewPluginsServiceClient(conn)

	// Test ListPlugins
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	resp, err := client.ListPlugins(ctx, &pluginsv1.ListPluginsRequest{
		WorkspaceId: "ws-test",
	})
	if err != nil {
		t.Fatalf("ListPlugins failed: %v", err)
	}

	t.Logf("✅ ListPlugins successful! Found %d plugins", len(resp.Plugins))
	for _, plugin := range resp.Plugins {
		t.Logf("  - %s (%s): %s", plugin.Name, plugin.Id, plugin.Description)
	}
}
