package clients

import (
	"fmt"

	"github.com/drewpayment/orbit/services/kafka/pkg/adapters"
)

// KafkaAdapterFactory creates Kafka and Schema Registry adapters from configuration.
// It wraps the adapters from the kafka service module for use in Temporal activities.
type KafkaAdapterFactory struct {
	payloadClient *PayloadClient
}

// NewKafkaAdapterFactory creates a new adapter factory.
// The payloadClient can be nil for unit testing or when not needed.
func NewKafkaAdapterFactory(payloadClient *PayloadClient) *KafkaAdapterFactory {
	return &KafkaAdapterFactory{payloadClient: payloadClient}
}

// CreateKafkaAdapterFromConfig creates a Kafka adapter from connection config map.
// Supports both camelCase keys (bootstrapServers) and dot notation (bootstrap.servers).
func (f *KafkaAdapterFactory) CreateKafkaAdapterFromConfig(config map[string]any, credentials map[string]string) (adapters.KafkaAdapter, error) {
	// Extract bootstrap servers - try camelCase first, then dot notation
	var bootstrapServers string
	if val, ok := config["bootstrapServers"].(string); ok {
		bootstrapServers = val
	} else if config["bootstrapServers"] != nil {
		return nil, fmt.Errorf("bootstrapServers must be a string, got %T", config["bootstrapServers"])
	}
	if bootstrapServers == "" {
		if bs, ok := config["bootstrap.servers"].(string); ok {
			bootstrapServers = bs
		} else if config["bootstrap.servers"] != nil {
			return nil, fmt.Errorf("bootstrap.servers must be a string, got %T", config["bootstrap.servers"])
		}
	}
	if bootstrapServers == "" {
		return nil, fmt.Errorf("bootstrapServers or bootstrap.servers required in connection config")
	}

	// Extract optional config - validate types if key exists
	securityProtocol, ok := config["securityProtocol"].(string)
	if !ok && config["securityProtocol"] != nil {
		return nil, fmt.Errorf("securityProtocol must be a string, got %T", config["securityProtocol"])
	}
	saslMechanism, ok := config["saslMechanism"].(string)
	if !ok && config["saslMechanism"] != nil {
		return nil, fmt.Errorf("saslMechanism must be a string, got %T", config["saslMechanism"])
	}

	// Build connection config map for the apache adapter - only include non-empty optional values
	connConfig := map[string]string{
		"bootstrapServers": bootstrapServers,
	}
	if securityProtocol != "" {
		connConfig["securityProtocol"] = securityProtocol
	}
	if saslMechanism != "" {
		connConfig["saslMechanism"] = saslMechanism
	}

	return adapters.NewApacheClientFromCluster(connConfig, credentials)
}

// CreateSchemaRegistryAdapterFromURL creates a Schema Registry adapter from URL and credentials.
func (f *KafkaAdapterFactory) CreateSchemaRegistryAdapterFromURL(url, username, password string) (adapters.SchemaRegistryAdapter, error) {
	return adapters.NewSchemaRegistryClient(adapters.SchemaRegistryConfig{
		URL:      url,
		Username: username,
		Password: password,
	})
}

// PayloadClient returns the factory's payload client for fetching cluster configurations.
func (f *KafkaAdapterFactory) PayloadClient() *PayloadClient {
	return f.payloadClient
}
