//go:build integration

package apache

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
)

// getTestConfig returns configuration for the test Kafka/Redpanda cluster.
// Override with environment variables for different setups.
func getTestConfig() Config {
	bootstrapServers := os.Getenv("KAFKA_BOOTSTRAP_SERVERS")
	if bootstrapServers == "" {
		bootstrapServers = "localhost:19092" // Default Redpanda from docker-compose
	}

	return Config{
		BootstrapServers: splitServers(bootstrapServers),
		SecurityProtocol: os.Getenv("KAFKA_SECURITY_PROTOCOL"), // PLAINTEXT by default
		SASLMechanism:    os.Getenv("KAFKA_SASL_MECHANISM"),
		SASLUsername:     os.Getenv("KAFKA_SASL_USERNAME"),
		SASLPassword:     os.Getenv("KAFKA_SASL_PASSWORD"),
	}
}

func TestIntegration_ValidateConnection(t *testing.T) {
	client, err := NewClient(getTestConfig())
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := client.ValidateConnection(ctx); err != nil {
		t.Fatalf("ValidateConnection() failed: %v", err)
	}
}

func TestIntegration_TopicLifecycle(t *testing.T) {
	client, err := NewClient(getTestConfig())
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	topicName := fmt.Sprintf("integration-test-topic-%d", time.Now().UnixNano())

	// Step 1: Create topic
	t.Run("CreateTopic", func(t *testing.T) {
		spec := adapters.TopicSpec{
			Name:              topicName,
			Partitions:        3,
			ReplicationFactor: 1, // Single node cluster
			Config: map[string]string{
				"retention.ms": "86400000", // 1 day
			},
		}

		if err := client.CreateTopic(ctx, spec); err != nil {
			t.Fatalf("CreateTopic() failed: %v", err)
		}
	})

	// Step 2: Verify topic appears in list
	t.Run("ListTopics", func(t *testing.T) {
		topics, err := client.ListTopics(ctx)
		if err != nil {
			t.Fatalf("ListTopics() failed: %v", err)
		}

		found := false
		for _, topic := range topics {
			if topic == topicName {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("created topic %q not found in topic list", topicName)
		}
	})

	// Step 3: Describe topic
	t.Run("DescribeTopic", func(t *testing.T) {
		info, err := client.DescribeTopic(ctx, topicName)
		if err != nil {
			t.Fatalf("DescribeTopic() failed: %v", err)
		}

		if info.Name != topicName {
			t.Errorf("DescribeTopic() name = %q, want %q", info.Name, topicName)
		}
		if info.Partitions != 3 {
			t.Errorf("DescribeTopic() partitions = %d, want 3", info.Partitions)
		}
		if info.ReplicationFactor != 1 {
			t.Errorf("DescribeTopic() replicationFactor = %d, want 1", info.ReplicationFactor)
		}
		if info.Config["retention.ms"] != "86400000" {
			t.Errorf("DescribeTopic() retention.ms = %q, want 86400000", info.Config["retention.ms"])
		}
	})

	// Step 4: Update topic config
	t.Run("UpdateTopicConfig", func(t *testing.T) {
		newConfig := map[string]string{
			"retention.ms": "172800000", // 2 days
		}

		if err := client.UpdateTopicConfig(ctx, topicName, newConfig); err != nil {
			t.Fatalf("UpdateTopicConfig() failed: %v", err)
		}

		// Verify the update
		info, err := client.DescribeTopic(ctx, topicName)
		if err != nil {
			t.Fatalf("DescribeTopic() after update failed: %v", err)
		}

		if info.Config["retention.ms"] != "172800000" {
			t.Errorf("retention.ms after update = %q, want 172800000", info.Config["retention.ms"])
		}
	})

	// Step 5: Get topic metrics
	t.Run("GetTopicMetrics", func(t *testing.T) {
		metrics, err := client.GetTopicMetrics(ctx, topicName)
		if err != nil {
			t.Fatalf("GetTopicMetrics() failed: %v", err)
		}

		if metrics.TopicName != topicName {
			t.Errorf("GetTopicMetrics() topicName = %q, want %q", metrics.TopicName, topicName)
		}
		if metrics.PartitionCount != 3 {
			t.Errorf("GetTopicMetrics() partitionCount = %d, want 3", metrics.PartitionCount)
		}
		// ReplicaCount = partitions * replication factor = 3 * 1 = 3
		if metrics.ReplicaCount != 3 {
			t.Errorf("GetTopicMetrics() replicaCount = %d, want 3", metrics.ReplicaCount)
		}
	})

	// Step 6: Delete topic (cleanup)
	t.Run("DeleteTopic", func(t *testing.T) {
		if err := client.DeleteTopic(ctx, topicName); err != nil {
			t.Fatalf("DeleteTopic() failed: %v", err)
		}

		// Allow time for deletion to propagate
		time.Sleep(500 * time.Millisecond)

		// Verify deletion
		_, err := client.DescribeTopic(ctx, topicName)
		if err != adapters.ErrTopicNotFound {
			t.Errorf("DescribeTopic() after delete error = %v, want ErrTopicNotFound", err)
		}
	})
}

func TestIntegration_DescribeTopic_NotFound(t *testing.T) {
	client, err := NewClient(getTestConfig())
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = client.DescribeTopic(ctx, "nonexistent-topic-12345")
	if err != adapters.ErrTopicNotFound {
		t.Errorf("DescribeTopic() for nonexistent topic error = %v, want ErrTopicNotFound", err)
	}
}

func TestIntegration_ACLLifecycle(t *testing.T) {
	client, err := NewClient(getTestConfig())
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Create a test topic for the ACL
	topicName := fmt.Sprintf("acl-test-topic-%d", time.Now().UnixNano())
	spec := adapters.TopicSpec{
		Name:              topicName,
		Partitions:        1,
		ReplicationFactor: 1,
	}
	if err := client.CreateTopic(ctx, spec); err != nil {
		t.Fatalf("failed to create test topic: %v", err)
	}
	defer func() {
		_ = client.DeleteTopic(ctx, topicName)
	}()

	aclSpec := adapters.ACLSpec{
		ResourceType:   adapters.ResourceTypeTopic,
		ResourceName:   topicName,
		PatternType:    adapters.PatternTypeLiteral,
		Principal:      "User:test-user",
		Host:           "*",
		Operation:      adapters.ACLOperationRead,
		PermissionType: adapters.ACLPermissionAllow,
	}

	// Step 1: Create ACL
	t.Run("CreateACL", func(t *testing.T) {
		if err := client.CreateACL(ctx, aclSpec); err != nil {
			t.Fatalf("CreateACL() failed: %v", err)
		}
	})

	// Step 2: List ACLs and verify
	t.Run("ListACLs", func(t *testing.T) {
		acls, err := client.ListACLs(ctx)
		if err != nil {
			t.Fatalf("ListACLs() failed: %v", err)
		}

		found := false
		for _, acl := range acls {
			if acl.ResourceName == topicName &&
				acl.Principal == "User:test-user" &&
				acl.Operation == adapters.ACLOperationRead {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("created ACL not found in ACL list")
		}
	})

	// Step 3: Delete ACL
	t.Run("DeleteACL", func(t *testing.T) {
		if err := client.DeleteACL(ctx, aclSpec); err != nil {
			t.Fatalf("DeleteACL() failed: %v", err)
		}

		// Verify deletion
		acls, err := client.ListACLs(ctx)
		if err != nil {
			t.Fatalf("ListACLs() after delete failed: %v", err)
		}

		for _, acl := range acls {
			if acl.ResourceName == topicName &&
				acl.Principal == "User:test-user" &&
				acl.Operation == adapters.ACLOperationRead {
				t.Errorf("ACL still exists after deletion")
			}
		}
	})
}

func TestIntegration_ConsumerGroups(t *testing.T) {
	client, err := NewClient(getTestConfig())
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// ListConsumerGroups should work even with no active groups
	t.Run("ListConsumerGroups", func(t *testing.T) {
		groups, err := client.ListConsumerGroups(ctx)
		if err != nil {
			t.Fatalf("ListConsumerGroups() failed: %v", err)
		}

		// Just verify we got a result (may be empty or have existing groups)
		t.Logf("Found %d consumer groups", len(groups))
		for _, g := range groups {
			t.Logf("  - %s (state: %s, members: %d)", g.GroupID, g.State, g.Members)
		}
	})

	// GetConsumerGroupLag for a non-existent group should fail gracefully
	t.Run("GetConsumerGroupLag_NonExistent", func(t *testing.T) {
		_, err := client.GetConsumerGroupLag(ctx, "nonexistent-group-12345")
		if err == nil {
			t.Error("GetConsumerGroupLag() for nonexistent group should fail")
		}
	})
}

func TestIntegration_ListTopics_FiltersInternalTopics(t *testing.T) {
	client, err := NewClient(getTestConfig())
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	topics, err := client.ListTopics(ctx)
	if err != nil {
		t.Fatalf("ListTopics() failed: %v", err)
	}

	// Verify no internal topics (starting with __) are returned
	for _, topic := range topics {
		if len(topic) >= 2 && topic[:2] == "__" {
			t.Errorf("ListTopics() returned internal topic %q", topic)
		}
	}

	t.Logf("Found %d non-internal topics", len(topics))
}
