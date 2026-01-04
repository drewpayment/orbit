// Package apache provides a Kafka adapter implementation for Apache Kafka clusters.
// This implementation uses franz-go for the Kafka protocol.
package apache

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
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

// newKgoClient creates a new kgo client with the configured settings
func (c *Client) newKgoClient() (*kgo.Client, error) {
	opts := []kgo.Opt{
		kgo.SeedBrokers(c.config.BootstrapServers...),
		kgo.DialTimeout(10 * time.Second),
		kgo.RequestTimeoutOverhead(10 * time.Second),
		// Use a custom dialer that rewrites broker addresses.
		// This is needed when connecting to Kafka/Redpanda clusters that advertise
		// internal addresses (e.g., K8s DNS names) but are accessed externally.
		kgo.Dialer(c.createDialer()),
	}

	// TODO: Add SASL/TLS configuration when needed
	// if c.config.SASLUsername != "" {
	//     opts = append(opts, kgo.SASL(...))
	// }

	return kgo.NewClient(opts...)
}

// createDialer returns a custom dialer that intelligently handles broker address resolution.
// It rewrites internal/unresolvable addresses (e.g., K8s DNS names) to use the bootstrap
// server address, while allowing properly configured external addresses to work unchanged.
func (c *Client) createDialer() func(ctx context.Context, network, host string) (net.Conn, error) {
	// Build a map of bootstrap servers for multi-broker support
	bootstrapAddrs := make(map[int]string) // broker index -> address
	for i, addr := range c.config.BootstrapServers {
		bootstrapAddrs[i] = addr
	}

	// Get the first bootstrap server as fallback
	var fallbackHost string
	var fallbackPort int
	if len(c.config.BootstrapServers) > 0 {
		fallbackHost, fallbackPort = parseHostPort(c.config.BootstrapServers[0], "", 9092)
	}

	return func(ctx context.Context, network, host string) (net.Conn, error) {
		originalHost := host

		// Check if the address looks like an internal K8s/Docker address
		if isInternalAddress(host) && fallbackHost != "" {
			// Rewrite to use bootstrap server
			host = fmt.Sprintf("%s:%d", fallbackHost, fallbackPort)
		}

		var d net.Dialer
		conn, err := d.DialContext(ctx, network, host)
		if err != nil && host == originalHost && fallbackHost != "" {
			// If connection failed and we didn't rewrite, try the fallback
			// This handles cases where the address is technically resolvable
			// but not reachable from this network
			fallbackAddr := fmt.Sprintf("%s:%d", fallbackHost, fallbackPort)
			if fallbackAddr != host {
				return d.DialContext(ctx, network, fallbackAddr)
			}
		}
		return conn, err
	}
}

// isInternalAddress checks if an address appears to be an internal/private address
// that likely won't be reachable from outside a container/k8s network.
func isInternalAddress(host string) bool {
	// Extract hostname without port
	hostname := host
	if lastColon := findLastColon(host); lastColon != -1 {
		hostname = host[:lastColon]
	}

	// Check for common internal address patterns
	internalPatterns := []string{
		".svc.cluster.local",  // Kubernetes service DNS
		".pod.cluster.local",  // Kubernetes pod DNS
		".internal",           // Generic internal domain
		".local",              // mDNS/local domains (but be careful - some are valid)
		"localhost",           // Localhost
	}

	for _, pattern := range internalPatterns {
		if len(hostname) >= len(pattern) && hostname[len(hostname)-len(pattern):] == pattern {
			// Special case: don't treat *.orb.local as internal (OrbStack domains)
			if pattern == ".local" && len(hostname) > 10 && hostname[len(hostname)-10:] == ".orb.local" {
				return false
			}
			return true
		}
	}

	// Check for internal IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x are usually fine)
	// But Docker/K8s internal IPs like 10.x.x.x might not be routable from host
	// For now, we only flag obvious K8s/Docker patterns above

	return false
}

// findLastColon finds the last colon in a string (for IPv6 support)
func findLastColon(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == ':' {
			return i
		}
	}
	return -1
}

// ValidateConnection tests the connection to the cluster
func (c *Client) ValidateConnection(ctx context.Context) error {
	client, err := c.newKgoClient()
	if err != nil {
		return fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	// Use admin client to list brokers - this validates the connection
	adminClient := kadm.NewClient(client)

	// Try to list brokers with a timeout
	timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	brokers, err := adminClient.ListBrokers(timeoutCtx)
	if err != nil {
		return fmt.Errorf("failed to connect to kafka cluster: %w", err)
	}

	if len(brokers) == 0 {
		return errors.New("no brokers found in cluster")
	}

	return nil
}

// Close closes the client connection
func (c *Client) Close() error {
	// No-op for stub implementation
	return nil
}

// CreateTopic creates a new topic on the Kafka cluster
func (c *Client) CreateTopic(ctx context.Context, spec adapters.TopicSpec) error {
	client, err := c.newKgoClient()
	if err != nil {
		return fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// Convert config to pointer map as required by kadm
	configs := TopicSpecToConfig(spec)

	// Create the topic
	resp, err := adminClient.CreateTopics(ctx, int32(spec.Partitions), int16(spec.ReplicationFactor), configs, spec.Name)
	if err != nil {
		return fmt.Errorf("failed to create topic: %w", err)
	}

	// Check for topic-level errors in the response
	for _, topic := range resp.Sorted() {
		if topic.Err != nil {
			return fmt.Errorf("failed to create topic %s: %w", topic.Topic, topic.Err)
		}
	}

	return nil
}

// DeleteTopic deletes a topic from the Kafka cluster
func (c *Client) DeleteTopic(ctx context.Context, topicName string) error {
	client, err := c.newKgoClient()
	if err != nil {
		return fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	resp, err := adminClient.DeleteTopics(ctx, topicName)
	if err != nil {
		return fmt.Errorf("failed to delete topic: %w", err)
	}

	// Check for topic-level errors in the response
	for _, topic := range resp.Sorted() {
		if topic.Err != nil {
			return fmt.Errorf("failed to delete topic %s: %w", topic.Topic, topic.Err)
		}
	}

	return nil
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

// ListTopics lists all topics on the Kafka cluster
func (c *Client) ListTopics(ctx context.Context) ([]string, error) {
	client, err := c.newKgoClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	topics, err := adminClient.ListTopics(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list topics: %w", err)
	}

	names := make([]string, 0, len(topics))
	for _, t := range topics.Sorted() {
		// Skip internal topics (those starting with __)
		if len(t.Topic) >= 2 && t.Topic[:2] == "__" {
			continue
		}
		names = append(names, t.Topic)
	}

	return names, nil
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
	// Support both "bootstrapServers" (camelCase) and "bootstrap.servers" (dot notation)
	bootstrapServers := connectionConfig["bootstrapServers"]
	if bootstrapServers == "" {
		bootstrapServers = connectionConfig["bootstrap.servers"]
	}
	if bootstrapServers == "" {
		return nil, errors.New("bootstrapServers or bootstrap.servers required in connection config")
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

// parseHostPort extracts host and port from a "host:port" string.
// If parsing fails, returns the original host and port.
func parseHostPort(addr string, defaultHost string, defaultPort int) (string, int) {
	// Find the last colon (to handle IPv6 addresses)
	lastColon := -1
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			lastColon = i
			break
		}
	}
	if lastColon == -1 {
		// No port specified, use default port
		return addr, defaultPort
	}

	host := addr[:lastColon]
	portStr := addr[lastColon+1:]

	// Parse port
	port := 0
	for _, c := range portStr {
		if c < '0' || c > '9' {
			return defaultHost, defaultPort
		}
		port = port*10 + int(c-'0')
	}

	if host == "" {
		host = defaultHost
	}

	return host, port
}

// Ensure Client implements KafkaAdapter
var _ adapters.KafkaAdapter = (*Client)(nil)

// String returns a string representation of the client for debugging
func (c *Client) String() string {
	return fmt.Sprintf("ApacheKafkaClient{servers=%v, protocol=%s}", c.config.BootstrapServers, c.config.SecurityProtocol)
}
