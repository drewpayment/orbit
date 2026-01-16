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
	"github.com/twmb/franz-go/pkg/kmsg"
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
	TLSCACert        string // PEM-encoded CA certificate (optional)
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

	// Add SASL authentication if configured
	saslMechanism, err := buildSASLMechanism(c.config.SASLMechanism, c.config.SASLUsername, c.config.SASLPassword)
	if err != nil {
		return nil, fmt.Errorf("failed to configure SASL: %w", err)
	}
	if saslMechanism != nil {
		opts = append(opts, kgo.SASL(saslMechanism))
	}

	// Add TLS configuration if enabled
	if shouldEnableTLS(c.config.TLSEnabled, c.config.SecurityProtocol) {
		tlsConfig, err := buildTLSConfig(true, c.config.TLSSkipVerify, c.config.TLSCACert)
		if err != nil {
			return nil, fmt.Errorf("failed to configure TLS: %w", err)
		}
		if tlsConfig != nil {
			opts = append(opts, kgo.DialTLSConfig(tlsConfig))
		}
	}

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
	client, err := c.newKgoClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// List topics to get partition/replication info
	topics, err := adminClient.ListTopics(ctx, topicName)
	if err != nil {
		return nil, fmt.Errorf("failed to list topics: %w", err)
	}

	topic, ok := topics[topicName]
	if !ok {
		return nil, adapters.ErrTopicNotFound
	}

	// Check if the topic actually exists (kadm returns an entry with Err for non-existent topics)
	if topic.Err != nil {
		return nil, adapters.ErrTopicNotFound
	}

	// Get topic config
	configs, err := adminClient.DescribeTopicConfigs(ctx, topicName)
	if err != nil {
		return nil, fmt.Errorf("failed to describe topic configs: %w", err)
	}

	configMap := make(map[string]string)
	_, err = configs.On(topicName, func(rc *kadm.ResourceConfig) error {
		for _, cfg := range rc.Configs {
			if cfg.Value != nil {
				configMap[cfg.Key] = *cfg.Value
			}
		}
		return nil
	})
	if err != nil {
		// Ignore error - just means no config found for this topic
		// The error is typically "resource not found" which we can safely ignore
	}

	// Calculate replication factor from first partition
	replicationFactor := 0
	if len(topic.Partitions) > 0 {
		replicationFactor = len(topic.Partitions[0].Replicas)
	}

	return &adapters.TopicInfo{
		Name:              topicName,
		Partitions:        len(topic.Partitions),
		ReplicationFactor: replicationFactor,
		Config:            configMap,
		Internal:          topic.IsInternal,
	}, nil
}

// UpdateTopicConfig updates topic configuration
func (c *Client) UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error {
	client, err := c.newKgoClient()
	if err != nil {
		return fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// Build alter configs
	alterConfigs := make([]kadm.AlterConfig, 0, len(config))
	for key, value := range config {
		alterConfigs = append(alterConfigs, kadm.AlterConfig{
			Name:  key,
			Value: &value,
		})
	}

	// Alter topic configs
	resp, err := adminClient.AlterTopicConfigs(ctx, alterConfigs, topicName)
	if err != nil {
		return fmt.Errorf("failed to alter topic configs: %w", err)
	}

	// Check for topic-level errors
	for _, r := range resp {
		if r.Err != nil {
			return fmt.Errorf("failed to alter config for topic %s: %w", r.Name, r.Err)
		}
	}

	return nil
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
	client, err := c.newKgoClient()
	if err != nil {
		return fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// Build ACL
	builder := kadm.NewACLs().
		ResourcePatternType(mapPatternType(acl.PatternType)).
		Operations(mapOperation(acl.Operation))

	// Add resource based on type
	switch acl.ResourceType {
	case adapters.ResourceTypeTopic:
		builder = builder.Topics(acl.ResourceName)
	case adapters.ResourceTypeGroup:
		builder = builder.Groups(acl.ResourceName)
	case adapters.ResourceTypeCluster:
		builder = builder.Clusters()
	case adapters.ResourceTypeTransactional:
		builder = builder.TransactionalIDs(acl.ResourceName)
	}

	// Add principal with host
	host := acl.Host
	if host == "" {
		host = "*"
	}
	if isAllowPermission(acl.PermissionType) {
		builder = builder.Allow(acl.Principal).AllowHosts(host)
	} else {
		builder = builder.Deny(acl.Principal).DenyHosts(host)
	}

	// Create ACL
	results, err := adminClient.CreateACLs(ctx, builder)
	if err != nil {
		return fmt.Errorf("failed to create ACL: %w", err)
	}

	// Check for errors in results
	for _, r := range results {
		if r.Err != nil {
			return fmt.Errorf("failed to create ACL: %w", r.Err)
		}
	}

	return nil
}

// DeleteACL deletes an ACL entry
func (c *Client) DeleteACL(ctx context.Context, acl adapters.ACLSpec) error {
	client, err := c.newKgoClient()
	if err != nil {
		return fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// Build ACL filter
	builder := kadm.NewACLs().
		ResourcePatternType(mapPatternType(acl.PatternType)).
		Operations(mapOperation(acl.Operation))

	// Add resource based on type
	switch acl.ResourceType {
	case adapters.ResourceTypeTopic:
		builder = builder.Topics(acl.ResourceName)
	case adapters.ResourceTypeGroup:
		builder = builder.Groups(acl.ResourceName)
	case adapters.ResourceTypeCluster:
		builder = builder.Clusters()
	case adapters.ResourceTypeTransactional:
		builder = builder.TransactionalIDs(acl.ResourceName)
	}

	// Add principal with host
	host := acl.Host
	if host == "" {
		host = "*"
	}
	if isAllowPermission(acl.PermissionType) {
		builder = builder.Allow(acl.Principal).AllowHosts(host)
	} else {
		builder = builder.Deny(acl.Principal).DenyHosts(host)
	}

	// Delete ACLs
	results, err := adminClient.DeleteACLs(ctx, builder)
	if err != nil {
		return fmt.Errorf("failed to delete ACL: %w", err)
	}

	// Check if any ACLs were deleted
	deletedCount := 0
	for _, r := range results {
		if r.Err == nil {
			deletedCount++
		}
	}

	if deletedCount == 0 {
		return fmt.Errorf("no ACLs matched for deletion")
	}

	return nil
}

// ListACLs lists all ACLs
func (c *Client) ListACLs(ctx context.Context) ([]adapters.ACLInfo, error) {
	client, err := c.newKgoClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	// Use direct kmsg request to list all ACLs
	// The kadm wrapper doesn't properly support listing all ACLs with "Any" filters
	req := kmsg.NewPtrDescribeACLsRequest()
	req.ResourceType = kmsg.ACLResourceTypeAny
	req.ResourcePatternType = kmsg.ACLResourcePatternTypeAny
	req.Operation = kmsg.ACLOperationAny
	req.PermissionType = kmsg.ACLPermissionTypeAny
	// nil Principal and Host means match all
	req.Principal = nil
	req.Host = nil

	resp, err := req.RequestWith(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("failed to list ACLs: %w", err)
	}

	if resp.ErrorCode != 0 {
		errMsg := ""
		if resp.ErrorMessage != nil {
			errMsg = *resp.ErrorMessage
		}
		return nil, fmt.Errorf("failed to list ACLs: error code %d: %s", resp.ErrorCode, errMsg)
	}

	// Extract ACLs from response
	var acls []adapters.ACLInfo
	for _, resource := range resp.Resources {
		for _, acl := range resource.ACLs {
			acls = append(acls, adapters.ACLInfo{
				ResourceType:   mapResourceTypeFromKmsg(resource.ResourceType),
				ResourceName:   resource.ResourceName,
				PatternType:    mapPatternTypeFromKmsg(resource.ResourcePatternType),
				Principal:      acl.Principal,
				Host:           acl.Host,
				Operation:      mapOperationFromKmsg(acl.Operation),
				PermissionType: mapPermissionTypeFromKmsg(acl.PermissionType),
			})
		}
	}

	return acls, nil
}

// GetTopicMetrics returns metrics for a topic
// Note: This returns structural metrics only (partitions, replicas).
// Throughput metrics (bytes/sec, messages/sec) require JMX or external monitoring.
func (c *Client) GetTopicMetrics(ctx context.Context, topicName string) (*adapters.TopicMetrics, error) {
	client, err := c.newKgoClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// Get topic details
	topics, err := adminClient.ListTopics(ctx, topicName)
	if err != nil {
		return nil, fmt.Errorf("failed to list topics: %w", err)
	}

	topic, ok := topics[topicName]
	if !ok {
		return nil, adapters.ErrTopicNotFound
	}

	// Calculate total replica count
	replicaCount := 0
	for _, partition := range topic.Partitions {
		replicaCount += len(partition.Replicas)
	}

	return &adapters.TopicMetrics{
		TopicName:      topicName,
		PartitionCount: len(topic.Partitions),
		ReplicaCount:   replicaCount,
		// BytesInPerSec, BytesOutPerSec, MessagesInPerSec, LogSizeBytes
		// require JMX or external metrics - left as zero
	}, nil
}

// GetConsumerGroupLag returns lag info for a consumer group
func (c *Client) GetConsumerGroupLag(ctx context.Context, groupID string) (*adapters.ConsumerGroupLag, error) {
	client, err := c.newKgoClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// First check if the group exists by describing it
	// DescribeGroups returns State="Dead" for non-existent groups
	groups, err := adminClient.DescribeGroups(ctx, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to describe consumer group: %w", err)
	}

	group, ok := groups[groupID]
	if !ok || group.State == "Dead" {
		return nil, fmt.Errorf("consumer group %s not found", groupID)
	}

	// Get lag for the group
	lag, err := adminClient.Lag(ctx, groupID)
	if err != nil {
		return nil, fmt.Errorf("failed to get consumer group lag: %w", err)
	}

	groupLag, ok := lag[groupID]
	if !ok {
		return nil, fmt.Errorf("consumer group %s not found", groupID)
	}

	// Aggregate lag by topic
	topicLags := make(map[string]int64)
	var totalLag int64
	for topic, partitionLags := range groupLag.Lag {
		var topicTotal int64
		for _, pl := range partitionLags {
			topicTotal += pl.Lag
		}
		topicLags[topic] = topicTotal
		totalLag += topicTotal
	}

	return &adapters.ConsumerGroupLag{
		GroupID:   groupID,
		State:     group.State,
		Members:   len(group.Members),
		TopicLags: topicLags,
		TotalLag:  totalLag,
	}, nil
}

// ListConsumerGroups lists all consumer groups
func (c *Client) ListConsumerGroups(ctx context.Context) ([]adapters.ConsumerGroupInfo, error) {
	client, err := c.newKgoClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}
	defer client.Close()

	adminClient := kadm.NewClient(client)

	// List all groups
	groups, err := adminClient.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list consumer groups: %w", err)
	}

	// Get group IDs for describe
	groupIDs := make([]string, 0, len(groups))
	for _, g := range groups.Sorted() {
		groupIDs = append(groupIDs, g.Group)
	}

	if len(groupIDs) == 0 {
		return []adapters.ConsumerGroupInfo{}, nil
	}

	// Describe groups to get state/protocol details
	described, err := adminClient.DescribeGroups(ctx, groupIDs...)
	if err != nil {
		return nil, fmt.Errorf("failed to describe consumer groups: %w", err)
	}

	result := make([]adapters.ConsumerGroupInfo, 0, len(described))
	for _, g := range described.Sorted() {
		result = append(result, adapters.ConsumerGroupInfo{
			GroupID:      g.Group,
			State:        g.State,
			Protocol:     g.Protocol,
			ProtocolType: g.ProtocolType,
			Members:      len(g.Members),
		})
	}

	return result, nil
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
