package domain

// ProviderType represents supported Kafka provider types
type ProviderType string

const (
	ProviderTypeUnspecified    ProviderType = ""
	ProviderTypeApacheKafka    ProviderType = "apache-kafka"
	ProviderTypeConfluentCloud ProviderType = "confluent-cloud"
	ProviderTypeAWSMSK         ProviderType = "aws-msk"
	ProviderTypeRedpanda       ProviderType = "redpanda"
	ProviderTypeAiven          ProviderType = "aiven"
)

// ProviderCapabilities defines what features a provider supports
type ProviderCapabilities struct {
	SchemaRegistry bool `json:"schemaRegistry"`
	Transactions   bool `json:"transactions"`
	QuotasAPI      bool `json:"quotasApi"`
	MetricsAPI     bool `json:"metricsApi"`
}

// KafkaProvider represents a Kafka-compatible provider definition
type KafkaProvider struct {
	ID                   string               `json:"id"`
	Name                 string               `json:"name"`
	DisplayName          string               `json:"displayName"`
	AdapterType          string               `json:"adapterType"`
	RequiredConfigFields []string             `json:"requiredConfigFields"`
	Capabilities         ProviderCapabilities `json:"capabilities"`
	DocumentationURL     string               `json:"documentationUrl"`
	IconURL              string               `json:"iconUrl"`
}

// DefaultProviders returns the built-in provider definitions
func DefaultProviders() []KafkaProvider {
	return []KafkaProvider{
		{
			ID:          "apache-kafka",
			Name:        "apache-kafka",
			DisplayName: "Apache Kafka",
			AdapterType: "apache",
			RequiredConfigFields: []string{
				"bootstrapServers",
				"securityProtocol",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      false,
				MetricsAPI:     false,
			},
			DocumentationURL: "https://kafka.apache.org/documentation/",
		},
		{
			ID:          "confluent-cloud",
			Name:        "confluent-cloud",
			DisplayName: "Confluent Cloud",
			AdapterType: "confluent",
			RequiredConfigFields: []string{
				"bootstrapServers",
				"apiKey",
				"apiSecret",
				"environmentId",
				"clusterId",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      true,
				MetricsAPI:     true,
			},
			DocumentationURL: "https://docs.confluent.io/cloud/current/",
		},
		{
			ID:          "aws-msk",
			Name:        "aws-msk",
			DisplayName: "Amazon MSK",
			AdapterType: "msk",
			RequiredConfigFields: []string{
				"bootstrapServers",
				"region",
				"clusterArn",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      false,
				MetricsAPI:     true,
			},
			DocumentationURL: "https://docs.aws.amazon.com/msk/",
		},
		{
			ID:          "redpanda",
			Name:        "redpanda",
			DisplayName: "Redpanda",
			AdapterType: "apache", // Redpanda is Kafka-compatible
			RequiredConfigFields: []string{
				"bootstrapServers",
				"securityProtocol",
			},
			Capabilities: ProviderCapabilities{
				SchemaRegistry: true,
				Transactions:   true,
				QuotasAPI:      false,
				MetricsAPI:     true,
			},
			DocumentationURL: "https://docs.redpanda.com/",
		},
	}
}
