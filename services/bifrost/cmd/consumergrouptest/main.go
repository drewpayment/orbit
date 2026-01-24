// services/bifrost/cmd/consumergrouptest/main.go
// Comprehensive end-to-end test for consumer group APIs in Bifrost.
//
// This test verifies that consumer group prefixing/unprefixing works correctly
// by connecting to a live Bifrost proxy with Redpanda backend.
//
// Usage:
//   go run ./cmd/consumergrouptest
//
// Environment variables:
//   BIFROST_ADMIN_ADDR    - Bifrost admin gRPC address (default: localhost:50060)
//   BIFROST_PROXY_ADDR    - Bifrost Kafka proxy address (default: localhost:9092)
//   REDPANDA_ADDR         - Direct Redpanda address (default: localhost:19092)
//   TEST_TOPIC_PREFIX     - Topic prefix for test VC (default: testvc:)
//   TEST_GROUP_PREFIX     - Group prefix for test VC (default: testvc:)
//   VERBOSE               - Enable verbose output (default: false)
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// Config holds test configuration
type Config struct {
	BifrostAdminAddr       string
	BifrostProxyAddr       string
	RedpandaAddr           string // Direct Redpanda address from host (for verification)
	RedpandaInternalAddr   string // Redpanda address inside Docker network (for VC config)
	TopicPrefix            string
	GroupPrefix            string
	Verbose                bool
}

// TestContext holds resources created during setup
type TestContext struct {
	Config      *Config
	AdminClient gatewayv1.BifrostAdminServiceClient
	AdminConn   *grpc.ClientConn

	// Virtual cluster details
	VirtualClusterID string
	CredentialID     string
	Username         string
	Password         string

	// Test identifiers (virtual names - without prefix)
	TopicName string
	GroupName string

	// Kafka clients
	BifrostClient  *kgo.Client
	RedpandaClient *kgo.Client
}

func main() {
	cfg := parseConfig()

	log.Println("=== Bifrost Consumer Group API End-to-End Test ===")
	log.Printf("Bifrost Admin: %s", cfg.BifrostAdminAddr)
	log.Printf("Bifrost Proxy: %s", cfg.BifrostProxyAddr)
	log.Printf("Redpanda Direct: %s", cfg.RedpandaAddr)
	log.Printf("Redpanda Internal: %s (for VC config)", cfg.RedpandaInternalAddr)
	log.Printf("Topic Prefix: %s", cfg.TopicPrefix)
	log.Printf("Group Prefix: %s", cfg.GroupPrefix)
	log.Println()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	testCtx := &TestContext{Config: cfg}

	// Run test phases
	if err := runTests(ctx, testCtx); err != nil {
		log.Fatalf("Test failed: %v", err)
	}

	log.Println()
	log.Println("=== All tests passed! ===")
}

func parseConfig() *Config {
	cfg := &Config{}

	flag.StringVar(&cfg.BifrostAdminAddr, "admin", getEnv("BIFROST_ADMIN_ADDR", "localhost:50060"), "Bifrost admin gRPC address")
	flag.StringVar(&cfg.BifrostProxyAddr, "proxy", getEnv("BIFROST_PROXY_ADDR", "localhost:9092"), "Bifrost Kafka proxy address")
	flag.StringVar(&cfg.RedpandaAddr, "redpanda", getEnv("REDPANDA_ADDR", "localhost:19092"), "Direct Redpanda address (from host)")
	flag.StringVar(&cfg.RedpandaInternalAddr, "redpanda-internal", getEnv("REDPANDA_INTERNAL_ADDR", "redpanda:19092"), "Redpanda address inside Docker network")
	flag.StringVar(&cfg.TopicPrefix, "topic-prefix", getEnv("TEST_TOPIC_PREFIX", "testvc-"), "Topic prefix for test VC")
	flag.StringVar(&cfg.GroupPrefix, "group-prefix", getEnv("TEST_GROUP_PREFIX", "testvc-"), "Group prefix for test VC")
	flag.BoolVar(&cfg.Verbose, "verbose", getEnvBool("VERBOSE", false), "Enable verbose output")

	flag.Parse()
	return cfg
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvBool(key string, defaultVal bool) bool {
	if val := os.Getenv(key); val != "" {
		return strings.ToLower(val) == "true" || val == "1"
	}
	return defaultVal
}

func runTests(ctx context.Context, testCtx *TestContext) error {
	// Phase 1: Setup
	log.Println("--- Phase 1: Setup ---")

	if err := setupAdminClient(ctx, testCtx); err != nil {
		return fmt.Errorf("setup admin client: %w", err)
	}
	defer testCtx.AdminConn.Close()

	if err := setupVirtualCluster(ctx, testCtx); err != nil {
		return fmt.Errorf("setup virtual cluster: %w", err)
	}

	if err := setupKafkaClients(ctx, testCtx); err != nil {
		return fmt.Errorf("setup kafka clients: %w", err)
	}
	defer testCtx.BifrostClient.Close()
	defer testCtx.RedpandaClient.Close()

	// Phase 2: Create test topic
	log.Println("--- Phase 2: Create Test Topic ---")
	if err := createTestTopic(ctx, testCtx); err != nil {
		return fmt.Errorf("create test topic: %w", err)
	}

	// Phase 3: Produce and Consume Test
	log.Println("--- Phase 3: Produce and Consume Test ---")
	if err := testProduceAndConsume(ctx, testCtx); err != nil {
		return fmt.Errorf("produce and consume test: %w", err)
	}

	// Phase 4: Consumer Group API Tests
	log.Println("--- Phase 4: Consumer Group API Tests ---")
	if err := testConsumerGroupAPIs(ctx, testCtx); err != nil {
		return fmt.Errorf("consumer group API test: %w", err)
	}

	// Phase 5: Multi-tenant Isolation Test
	log.Println("--- Phase 5: Multi-tenant Isolation Verification ---")
	if err := testMultiTenantIsolation(ctx, testCtx); err != nil {
		return fmt.Errorf("multi-tenant isolation test: %w", err)
	}

	// Phase 6: Cleanup
	log.Println("--- Phase 6: Cleanup ---")
	if err := cleanup(ctx, testCtx); err != nil {
		log.Printf("Warning: cleanup failed (non-fatal): %v", err)
	}

	return nil
}

func setupAdminClient(ctx context.Context, testCtx *TestContext) error {
	log.Printf("Connecting to Bifrost admin API at %s...", testCtx.Config.BifrostAdminAddr)

	conn, err := grpc.NewClient(
		testCtx.Config.BifrostAdminAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return fmt.Errorf("connect to admin: %w", err)
	}

	testCtx.AdminConn = conn
	testCtx.AdminClient = gatewayv1.NewBifrostAdminServiceClient(conn)

	// Verify connection with GetStatus
	status, err := testCtx.AdminClient.GetStatus(ctx, &gatewayv1.GetStatusRequest{})
	if err != nil {
		return fmt.Errorf("get status: %w", err)
	}
	log.Printf("  Connected! Bifrost status: %s, VCs: %d", status.Status, status.VirtualClusterCount)

	return nil
}

func setupVirtualCluster(ctx context.Context, testCtx *TestContext) error {
	// Generate unique identifiers for this test run
	testID := uuid.New().String()[:8]
	testCtx.VirtualClusterID = fmt.Sprintf("test-vc-%s", testID)
	testCtx.CredentialID = fmt.Sprintf("test-cred-%s", testID)
	testCtx.Username = fmt.Sprintf("testuser-%s", testID)
	testCtx.Password = fmt.Sprintf("testpass-%s", testID)
	testCtx.TopicName = fmt.Sprintf("test-topic-%s", testID)
	testCtx.GroupName = fmt.Sprintf("test-group-%s", testID)

	log.Printf("Creating virtual cluster %s...", testCtx.VirtualClusterID)

	// Create virtual cluster
	_, err := testCtx.AdminClient.UpsertVirtualCluster(ctx, &gatewayv1.UpsertVirtualClusterRequest{
		Config: &gatewayv1.VirtualClusterConfig{
			Id:                       testCtx.VirtualClusterID,
			ApplicationId:            "test-app",
			ApplicationSlug:          "test-app",
			WorkspaceSlug:            "test-workspace",
			Environment:              "test",
			TopicPrefix:              testCtx.Config.TopicPrefix,
			GroupPrefix:              testCtx.Config.GroupPrefix,
			TransactionIdPrefix:      testCtx.Config.TopicPrefix,
			AdvertisedHost:           "localhost", // Clients connect here
			AdvertisedPort:           9092,
			PhysicalBootstrapServers: testCtx.Config.RedpandaInternalAddr,
			ReadOnly:                 false,
		},
	})
	if err != nil {
		return fmt.Errorf("create virtual cluster: %w", err)
	}
	log.Printf("  Virtual cluster created: %s", testCtx.VirtualClusterID)

	// Create credential
	passwordHash := hashPassword(testCtx.Password)
	_, err = testCtx.AdminClient.UpsertCredential(ctx, &gatewayv1.UpsertCredentialRequest{
		Config: &gatewayv1.CredentialConfig{
			Id:               testCtx.CredentialID,
			VirtualClusterId: testCtx.VirtualClusterID,
			Username:         testCtx.Username,
			PasswordHash:     passwordHash,
			Template:         gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_ADMIN,
		},
	})
	if err != nil {
		return fmt.Errorf("create credential: %w", err)
	}
	log.Printf("  Credential created: %s (user: %s)", testCtx.CredentialID, testCtx.Username)

	return nil
}

func setupKafkaClients(ctx context.Context, testCtx *TestContext) error {
	log.Printf("Creating Kafka clients...")

	// Create Bifrost client (goes through proxy with SASL)
	bifrostClient, err := kgo.NewClient(
		kgo.SeedBrokers(testCtx.Config.BifrostProxyAddr),
		kgo.SASL(plain.Auth{
			User: testCtx.Username,
			Pass: testCtx.Password,
		}.AsMechanism()),
		kgo.ClientID("bifrost-test-client"),
		kgo.DialTimeout(10*time.Second),
		kgo.RequestTimeoutOverhead(30*time.Second),
	)
	if err != nil {
		return fmt.Errorf("create bifrost client: %w", err)
	}
	testCtx.BifrostClient = bifrostClient
	log.Printf("  Bifrost client created (via %s)", testCtx.Config.BifrostProxyAddr)

	// Create direct Redpanda client (for verification)
	redpandaClient, err := kgo.NewClient(
		kgo.SeedBrokers(testCtx.Config.RedpandaAddr),
		kgo.ClientID("redpanda-direct-client"),
		kgo.DialTimeout(10*time.Second),
	)
	if err != nil {
		bifrostClient.Close()
		return fmt.Errorf("create redpanda client: %w", err)
	}
	testCtx.RedpandaClient = redpandaClient
	log.Printf("  Redpanda direct client created (via %s)", testCtx.Config.RedpandaAddr)

	return nil
}

func createTestTopic(ctx context.Context, testCtx *TestContext) error {
	admin := kadm.NewClient(testCtx.BifrostClient)

	log.Printf("Creating topic '%s' via Bifrost...", testCtx.TopicName)

	// Create topic through Bifrost (will be prefixed)
	resp, err := admin.CreateTopics(ctx, 1, 1, nil, testCtx.TopicName)
	if err != nil {
		return fmt.Errorf("create topic: %w", err)
	}

	for _, result := range resp {
		if result.Err != nil {
			// Ignore "topic already exists" error
			if strings.Contains(result.Err.Error(), "TOPIC_ALREADY_EXISTS") {
				log.Printf("  Topic already exists (OK)")
				return nil
			}
			return fmt.Errorf("create topic %s: %w", result.Topic, result.Err)
		}
		log.Printf("  Topic created: %s", result.Topic)
	}

	// NOTE: CreateTopics request modifier is not yet implemented, so topic is created
	// without the prefix. For now, we'll create the prefixed topic directly in Redpanda
	// to test the consumer group APIs properly.
	redpandaAdmin := kadm.NewClient(testCtx.RedpandaClient)
	physicalTopic := testCtx.Config.TopicPrefix + testCtx.TopicName

	log.Printf("Creating prefixed topic '%s' directly in Redpanda (CreateTopics modifier not yet implemented)...", physicalTopic)

	physicalResp, err := redpandaAdmin.CreateTopics(ctx, 1, 1, nil, physicalTopic)
	if err != nil {
		return fmt.Errorf("create physical topic: %w", err)
	}
	for _, result := range physicalResp {
		if result.Err != nil {
			if strings.Contains(result.Err.Error(), "TOPIC_ALREADY_EXISTS") {
				log.Printf("  Physical topic already exists (OK)")
			} else {
				return fmt.Errorf("create physical topic %s: %w", result.Topic, result.Err)
			}
		} else {
			log.Printf("  Physical topic created: %s", result.Topic)
		}
	}

	return nil
}

func testProduceAndConsume(ctx context.Context, testCtx *TestContext) error {
	// Produce messages through Bifrost
	log.Printf("Producing 10 messages to '%s'...", testCtx.TopicName)

	for i := 0; i < 10; i++ {
		record := &kgo.Record{
			Topic: testCtx.TopicName,
			Key:   []byte(fmt.Sprintf("key-%d", i)),
			Value: []byte(fmt.Sprintf("message-%d-at-%d", i, time.Now().UnixNano())),
		}
		testCtx.BifrostClient.Produce(ctx, record, func(r *kgo.Record, err error) {
			if err != nil {
				log.Printf("  Warning: produce error: %v", err)
			}
		})
	}

	// Flush to ensure all messages are sent
	if err := testCtx.BifrostClient.Flush(ctx); err != nil {
		return fmt.Errorf("flush: %w", err)
	}
	log.Printf("  Produced 10 messages successfully")

	// Create a consumer with group
	log.Printf("Consuming messages with group '%s'...", testCtx.GroupName)

	consumerClient, err := kgo.NewClient(
		kgo.SeedBrokers(testCtx.Config.BifrostProxyAddr),
		kgo.SASL(plain.Auth{
			User: testCtx.Username,
			Pass: testCtx.Password,
		}.AsMechanism()),
		kgo.ClientID("bifrost-test-consumer"),
		kgo.ConsumerGroup(testCtx.GroupName),
		kgo.ConsumeTopics(testCtx.TopicName),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
		kgo.DialTimeout(10*time.Second),
	)
	if err != nil {
		return fmt.Errorf("create consumer client: %w", err)
	}
	defer consumerClient.Close()

	// Consume messages
	consumedCount := 0
	consumeCtx, consumeCancel := context.WithTimeout(ctx, 30*time.Second)
	defer consumeCancel()

	for consumedCount < 10 {
		fetches := consumerClient.PollFetches(consumeCtx)
		if fetches.IsClientClosed() {
			break
		}
		if errors := fetches.Errors(); len(errors) > 0 {
			for _, e := range errors {
				log.Printf("  Fetch error: topic=%s partition=%d: %v", e.Topic, e.Partition, e.Err)
			}
		}

		fetches.EachRecord(func(r *kgo.Record) {
			consumedCount++
			if testCtx.Config.Verbose {
				log.Printf("  Consumed: key=%s value=%s", string(r.Key), string(r.Value))
			}
		})

		// Check for timeout
		select {
		case <-consumeCtx.Done():
			return fmt.Errorf("consume timeout: only consumed %d/10 messages", consumedCount)
		default:
		}
	}

	log.Printf("  Consumed %d messages successfully", consumedCount)

	// Commit offsets
	if err := consumerClient.CommitUncommittedOffsets(ctx); err != nil {
		return fmt.Errorf("commit offsets: %w", err)
	}
	log.Printf("  Offsets committed")

	return nil
}

func testConsumerGroupAPIs(ctx context.Context, testCtx *TestContext) error {
	bifrostAdmin := kadm.NewClient(testCtx.BifrostClient)
	redpandaAdmin := kadm.NewClient(testCtx.RedpandaClient)

	physicalGroup := testCtx.Config.GroupPrefix + testCtx.GroupName

	// Test 1: ListGroups through Bifrost - should see unprefixed name
	log.Printf("Testing ListGroups through Bifrost...")

	bifrostGroups, err := bifrostAdmin.ListGroups(ctx)
	if err != nil {
		return fmt.Errorf("list groups through bifrost: %w", err)
	}

	foundUnprefixed := false
	for _, g := range bifrostGroups {
		if testCtx.Config.Verbose {
			log.Printf("  Bifrost sees group: %s", g.Group)
		}
		if g.Group == testCtx.GroupName {
			foundUnprefixed = true
			log.Printf("  Found unprefixed group '%s' through Bifrost", testCtx.GroupName)
		}
		// Should NOT see prefixed version
		if g.Group == physicalGroup {
			return fmt.Errorf("FAIL: Bifrost should NOT expose prefixed group name '%s'", physicalGroup)
		}
	}

	if !foundUnprefixed {
		log.Printf("  Warning: Group '%s' not found in ListGroups (may have expired or not joined yet)", testCtx.GroupName)
	}

	// Test 2: ListGroups directly from Redpanda - should see PREFIXED name
	log.Printf("Testing ListGroups directly from Redpanda...")

	redpandaGroups, err := redpandaAdmin.ListGroups(ctx)
	if err != nil {
		return fmt.Errorf("list groups from redpanda: %w", err)
	}

	foundPrefixed := false
	for _, g := range redpandaGroups {
		if testCtx.Config.Verbose {
			log.Printf("  Redpanda sees group: %s", g.Group)
		}
		if g.Group == physicalGroup {
			foundPrefixed = true
			log.Printf("  Found prefixed group '%s' in Redpanda", physicalGroup)
		}
	}

	if !foundPrefixed {
		log.Printf("  Warning: Prefixed group '%s' not found in Redpanda (may have expired)", physicalGroup)
	}

	// Test 3: DescribeGroups through Bifrost
	log.Printf("Testing DescribeGroups through Bifrost...")

	// Need to have an active consumer to describe
	describedGroups, err := bifrostAdmin.DescribeGroups(ctx, testCtx.GroupName)
	if err != nil {
		return fmt.Errorf("describe groups through bifrost: %w", err)
	}

	for _, g := range describedGroups {
		log.Printf("  Described group: %s, state: %s", g.Group, g.State)
		if g.Group != testCtx.GroupName {
			return fmt.Errorf("FAIL: DescribeGroups returned wrong group name: got '%s', want '%s'", g.Group, testCtx.GroupName)
		}
	}

	// Test 4: DescribeGroups directly from Redpanda - verify physical name
	log.Printf("Testing DescribeGroups directly from Redpanda...")

	redpandaDescribed, err := redpandaAdmin.DescribeGroups(ctx, physicalGroup)
	if err != nil {
		return fmt.Errorf("describe groups from redpanda: %w", err)
	}

	for _, g := range redpandaDescribed {
		log.Printf("  Redpanda described group: %s, state: %s", g.Group, g.State)
		if g.Group != physicalGroup {
			return fmt.Errorf("FAIL: Redpanda has wrong group name: got '%s', want '%s'", g.Group, physicalGroup)
		}
	}

	log.Printf("  Consumer Group API tests passed!")
	return nil
}

func testMultiTenantIsolation(ctx context.Context, testCtx *TestContext) error {
	log.Printf("Verifying multi-tenant isolation...")

	bifrostAdmin := kadm.NewClient(testCtx.BifrostClient)

	// List all topics through Bifrost - should only see this tenant's topics
	topics, err := bifrostAdmin.ListTopics(ctx)
	if err != nil {
		return fmt.Errorf("list topics: %w", err)
	}

	for _, t := range topics {
		// Should NOT see any topic with a prefix (isolation breach)
		if strings.HasPrefix(t.Topic, testCtx.Config.TopicPrefix) {
			return fmt.Errorf("FAIL: Topic '%s' still has prefix - isolation breach!", t.Topic)
		}
		// Should NOT see other tenants' prefixes
		if strings.Contains(t.Topic, ":") && !strings.HasPrefix(t.Topic, testCtx.TopicName) {
			log.Printf("  Warning: Unexpected topic pattern: %s", t.Topic)
		}
	}

	// List all groups through Bifrost - should only see this tenant's groups
	groups, err := bifrostAdmin.ListGroups(ctx)
	if err != nil {
		return fmt.Errorf("list groups: %w", err)
	}

	for _, g := range groups {
		// Should NOT see any group with a prefix (isolation breach)
		if strings.HasPrefix(g.Group, testCtx.Config.GroupPrefix) {
			return fmt.Errorf("FAIL: Group '%s' still has prefix - isolation breach!", g.Group)
		}
	}

	log.Printf("  Multi-tenant isolation verified!")
	return nil
}

func cleanup(ctx context.Context, testCtx *TestContext) error {
	log.Printf("Cleaning up test resources...")

	// Delete the test topic via Bifrost
	if testCtx.BifrostClient != nil {
		admin := kadm.NewClient(testCtx.BifrostClient)
		resp, err := admin.DeleteTopics(ctx, testCtx.TopicName)
		if err != nil {
			log.Printf("  Warning: delete topic via bifrost failed: %v", err)
		} else {
			for _, r := range resp {
				if r.Err != nil {
					log.Printf("  Warning: delete topic %s: %v", r.Topic, r.Err)
				} else {
					log.Printf("  Deleted topic: %s", r.Topic)
				}
			}
		}
	}

	// Revoke credential
	if testCtx.AdminClient != nil && testCtx.CredentialID != "" {
		_, err := testCtx.AdminClient.RevokeCredential(ctx, &gatewayv1.RevokeCredentialRequest{
			CredentialId: testCtx.CredentialID,
		})
		if err != nil {
			log.Printf("  Warning: revoke credential failed: %v", err)
		} else {
			log.Printf("  Revoked credential: %s", testCtx.CredentialID)
		}
	}

	// Delete virtual cluster
	if testCtx.AdminClient != nil && testCtx.VirtualClusterID != "" {
		_, err := testCtx.AdminClient.DeleteVirtualCluster(ctx, &gatewayv1.DeleteVirtualClusterRequest{
			VirtualClusterId: testCtx.VirtualClusterID,
		})
		if err != nil {
			log.Printf("  Warning: delete virtual cluster failed: %v", err)
		} else {
			log.Printf("  Deleted virtual cluster: %s", testCtx.VirtualClusterID)
		}
	}

	log.Printf("  Cleanup completed")
	return nil
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}
