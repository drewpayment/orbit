package temporal

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
)

// NewClient creates a new Temporal client
func NewClient() client.Client {
	// Get Temporal server address from environment
	address := os.Getenv("TEMPORAL_ADDRESS")
	if address == "" {
		address = "localhost:7233"
	}

	// Get namespace from environment
	namespace := os.Getenv("TEMPORAL_NAMESPACE")
	if namespace == "" {
		namespace = "default"
	}

	// Create client options
	clientOptions := client.Options{
		HostPort:  address,
		Namespace: namespace,
	}

	// Create and return client
	temporalClient, err := client.Dial(clientOptions)
	if err != nil {
		log.Fatalln("Unable to create Temporal client", err)
	}

	return temporalClient
}
