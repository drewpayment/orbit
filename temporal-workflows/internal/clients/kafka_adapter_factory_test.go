package clients

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKafkaAdapterFactory_CreateKafkaAdapterFromConfig(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil) // nil PayloadClient for unit test

	config := map[string]any{
		"bootstrapServers": "localhost:9092",
		"securityProtocol": "PLAINTEXT",
	}
	credentials := map[string]string{}

	adapter, err := factory.CreateKafkaAdapterFromConfig(config, credentials)
	require.NoError(t, err)
	assert.NotNil(t, adapter)
}

func TestKafkaAdapterFactory_CreateSchemaRegistryAdapterFromURL(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	adapter, err := factory.CreateSchemaRegistryAdapterFromURL("http://localhost:8081", "", "")
	require.NoError(t, err)
	assert.NotNil(t, adapter)
}

func TestKafkaAdapterFactory_CreateKafkaAdapterFromConfig_MissingBootstrap(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	config := map[string]any{
		"securityProtocol": "PLAINTEXT",
	}
	credentials := map[string]string{}

	_, err := factory.CreateKafkaAdapterFromConfig(config, credentials)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "bootstrapServers")
}

func TestKafkaAdapterFactory_CreateKafkaAdapterFromConfig_DotNotation(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	config := map[string]any{
		"bootstrap.servers": "localhost:9092",
		"securityProtocol":  "PLAINTEXT",
	}
	credentials := map[string]string{}

	adapter, err := factory.CreateKafkaAdapterFromConfig(config, credentials)
	require.NoError(t, err)
	assert.NotNil(t, adapter)
}

func TestKafkaAdapterFactory_CreateKafkaAdapterFromConfig_WithCredentials(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	config := map[string]any{
		"bootstrapServers": "localhost:9092",
		"securityProtocol": "SASL_SSL",
		"saslMechanism":    "PLAIN",
	}
	credentials := map[string]string{
		"username": "testuser",
		"password": "testpass",
	}

	adapter, err := factory.CreateKafkaAdapterFromConfig(config, credentials)
	require.NoError(t, err)
	assert.NotNil(t, adapter)
}

func TestKafkaAdapterFactory_CreateSchemaRegistryAdapterFromURL_WithCredentials(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	adapter, err := factory.CreateSchemaRegistryAdapterFromURL("http://localhost:8081", "user", "pass")
	require.NoError(t, err)
	assert.NotNil(t, adapter)
}

func TestKafkaAdapterFactory_CreateSchemaRegistryAdapterFromURL_EmptyURL(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	_, err := factory.CreateSchemaRegistryAdapterFromURL("", "", "")
	assert.Error(t, err)
}

func TestKafkaAdapterFactory_CreateKafkaAdapterFromConfig_InvalidTypes(t *testing.T) {
	factory := NewKafkaAdapterFactory(nil)

	config := map[string]any{
		"bootstrapServers": 12345, // wrong type
	}

	_, err := factory.CreateKafkaAdapterFromConfig(config, map[string]string{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "bootstrapServers")
}
