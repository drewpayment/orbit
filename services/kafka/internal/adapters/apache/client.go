// Package apache provides a Kafka adapter implementation for Apache Kafka clusters.
// This implementation uses franz-go for the Kafka protocol.
//
// NOTE: The full franz-go implementation requires the following dependencies:
//   - github.com/twmb/franz-go
//   - github.com/twmb/franz-go/pkg/kadm
//   - github.com/twmb/franz-go/pkg/sasl/plain
//   - github.com/twmb/franz-go/pkg/sasl/scram
//
// Until those dependencies are available, this package provides a stub implementation
// that returns ErrNotConfigured for all operations.
package apache

import (
	"context"
	"errors"
	"fmt"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
)

var (
	// ErrNotConfigured is returned when the Kafka client is not properly configured
	ErrNotConfigured = errors.New("kafka client not configured: franz-go dependency required")
)

// Config holds the connection configuration for Apache Kafka
type Config struct {
	BootstrapServers []string
	SecurityProtocol string // PLAINTEXT, SASL_PLAINTEXT, SASL_SSL, SSL
	SASLMechanism    string // PLAIN, SCRAM-SHA-256, SCRAM-SHA-512
	SASLUsername     string
	SASLPassword     string
	TLSEnabled       bool
	TLSSkipVerify    bool
}

// Validate checks if the configuration is valid
func (c Config) Validate() error {
	if len(c.BootstrapServers) == 0 {
		return errors.New("bootstrap servers required")
	}
	return nil
}

// Client implements the KafkaAdapter interface for Apache Kafka
type Client struct {
	config Config
}

// NewClient creates a new Apache Kafka client
func NewClient(config Config) (*Client, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}

	return &Client{
		config: config,
	}, nil
}

// ValidateConnection tests the connection to the cluster
func (c *Client) ValidateConnection(ctx context.Context) error {
	// TODO: Implement with franz-go when available
	// This requires:
	//   client, err := kgo.NewClient(kgo.SeedBrokers(c.config.BootstrapServers...))
	//   adminClient := kadm.NewClient(client)
	//   brokers, err := adminClient.ListBrokers(ctx)
	return ErrNotConfigured
}

// Close closes the client connection
func (c *Client) Close() error {
	// No-op for stub implementation
	return nil
}

// CreateTopic creates a new topic
func (c *Client) CreateTopic(ctx context.Context, spec adapters.TopicSpec) error {
	// TODO: Implement with franz-go
	// adminClient.CreateTopics(ctx, partitions, replicationFactor, configs, topicName)
	return ErrNotConfigured
}

// DeleteTopic deletes a topic
func (c *Client) DeleteTopic(ctx context.Context, topicName string) error {
	// TODO: Implement with franz-go
	// adminClient.DeleteTopics(ctx, topicName)
	return ErrNotConfigured
}

// DescribeTopic gets information about a topic
func (c *Client) DescribeTopic(ctx context.Context, topicName string) (*adapters.TopicInfo, error) {
	// TODO: Implement with franz-go
	// topics, err := adminClient.ListTopics(ctx, topicName)
	return nil, ErrNotConfigured
}

// UpdateTopicConfig updates topic configuration
func (c *Client) UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error {
	// TODO: Implement with franz-go
	// adminClient.AlterTopicConfigs(ctx, configs)
	return ErrNotConfigured
}

// ListTopics lists all topics
func (c *Client) ListTopics(ctx context.Context) ([]string, error) {
	// TODO: Implement with franz-go
	// adminClient.ListTopics(ctx)
	return nil, ErrNotConfigured
}

// CreateACL creates an ACL entry
func (c *Client) CreateACL(ctx context.Context, acl adapters.ACLSpec) error {
	// TODO: Implement with franz-go
	// adminClient.CreateACLs(ctx, &aclBuilder)
	return ErrNotConfigured
}

// DeleteACL deletes an ACL entry
func (c *Client) DeleteACL(ctx context.Context, acl adapters.ACLSpec) error {
	// TODO: Implement with franz-go
	// adminClient.DeleteACLs(ctx, &aclBuilder)
	return ErrNotConfigured
}

// ListACLs lists all ACLs
func (c *Client) ListACLs(ctx context.Context) ([]adapters.ACLInfo, error) {
	// TODO: Implement with franz-go
	// adminClient.DescribeACLs(ctx, nil)
	return nil, ErrNotConfigured
}

// GetTopicMetrics returns metrics for a topic
func (c *Client) GetTopicMetrics(ctx context.Context, topicName string) (*adapters.TopicMetrics, error) {
	// TODO: Implement - may require JMX or external metrics
	return nil, ErrNotConfigured
}

// GetConsumerGroupLag returns lag info for a consumer group
func (c *Client) GetConsumerGroupLag(ctx context.Context, groupID string) (*adapters.ConsumerGroupLag, error) {
	// TODO: Implement with franz-go
	// adminClient.Lag(ctx, groupID)
	return nil, ErrNotConfigured
}

// ListConsumerGroups lists all consumer groups
func (c *Client) ListConsumerGroups(ctx context.Context) ([]adapters.ConsumerGroupInfo, error) {
	// TODO: Implement with franz-go
	// adminClient.ListGroups(ctx)
	return nil, ErrNotConfigured
}

// TopicSpecToConfig converts topic spec config to pointer map
func TopicSpecToConfig(spec adapters.TopicSpec) map[string]*string {
	result := make(map[string]*string)
	for k, v := range spec.Config {
		val := v
		result[k] = &val
	}
	return result
}

// NewClientFromCluster creates a client from a domain cluster and credentials
func NewClientFromCluster(connectionConfig, credentials map[string]string) (*Client, error) {
	bootstrapServers, ok := connectionConfig["bootstrapServers"]
	if !ok || bootstrapServers == "" {
		return nil, errors.New("bootstrapServers required in connection config")
	}

	config := Config{
		BootstrapServers: splitServers(bootstrapServers),
		SecurityProtocol: connectionConfig["securityProtocol"],
		SASLMechanism:    connectionConfig["saslMechanism"],
		SASLUsername:     credentials["username"],
		SASLPassword:     credentials["password"],
	}

	return NewClient(config)
}

// splitServers splits a comma-separated server list
func splitServers(servers string) []string {
	if servers == "" {
		return nil
	}
	var result []string
	start := 0
	for i, c := range servers {
		if c == ',' {
			if s := servers[start:i]; s != "" {
				result = append(result, s)
			}
			start = i + 1
		}
	}
	if s := servers[start:]; s != "" {
		result = append(result, s)
	}
	return result
}

// Ensure Client implements KafkaAdapter
var _ adapters.KafkaAdapter = (*Client)(nil)

// String returns a string representation of the client for debugging
func (c *Client) String() string {
	return fmt.Sprintf("ApacheKafkaClient{servers=%v, protocol=%s}", c.config.BootstrapServers, c.config.SecurityProtocol)
}
