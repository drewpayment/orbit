package contract

import (
	"context"
	"log"
	"os"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	kafkapb "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
)

var testClient kafkapb.KafkaServiceClient

func TestMain(m *testing.M) {
	// Setup test client
	addr := os.Getenv("KAFKA_SERVICE_ADDR")
	if addr == "" {
		addr = "localhost:50055"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		log.Printf("Warning: Could not connect to Kafka service at %s: %v", addr, err)
		log.Printf("Contract tests will be skipped if service is not available")
	} else {
		testClient = kafkapb.NewKafkaServiceClient(conn)
		defer conn.Close()
	}

	os.Exit(m.Run())
}

// getTestClient returns the test client, skipping the test if not available
func getTestClient(t *testing.T) kafkapb.KafkaServiceClient {
	if testClient == nil {
		t.Skip("Kafka service not available - skipping contract test")
	}
	return testClient
}

// skipIfNoService skips the test if the Kafka service is not available
func skipIfNoService(t *testing.T) {
	if testClient == nil {
		t.Skip("Kafka service not available")
	}
}
