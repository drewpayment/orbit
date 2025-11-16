package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/clients"
)

func main() {
	// Get configuration from environment
	temporalAddress := os.Getenv("TEMPORAL_ADDRESS")
	if temporalAddress == "" {
		temporalAddress = "localhost:7233"
	}

	temporalNamespace := os.Getenv("TEMPORAL_NAMESPACE")
	if temporalNamespace == "" {
		temporalNamespace = "default"
	}

	orbitAPIURL := os.Getenv("ORBIT_API_URL")
	if orbitAPIURL == "" {
		orbitAPIURL = "http://localhost:3000"
	}

	// Create Temporal client
	c, err := client.Dial(client.Options{
		HostPort:  temporalAddress,
		Namespace: temporalNamespace,
	})
	if err != nil {
		log.Fatalln("Unable to create Temporal client", err)
	}
	defer c.Close()

	// Create worker
	w := worker.New(c, "orbit-workflows", worker.Options{})

	// Register workflows
	w.RegisterWorkflow(workflows.GitHubTokenRefreshWorkflow)

	// Initialize HTTP client for activities
	activityClients := clients.NewHTTPActivityClients(orbitAPIURL)

	// Register activities
	w.RegisterActivity(activityClients.RefreshGitHubInstallationTokenActivity)
	w.RegisterActivity(activityClients.UpdateInstallationStatusActivity)

	log.Println("Starting Temporal worker...")
	log.Printf("Temporal address: %s", temporalAddress)
	log.Printf("Temporal namespace: %s", temporalNamespace)
	log.Printf("Orbit API URL: %s", orbitAPIURL)
	log.Println("Task queue: orbit-workflows")

	// Start worker
	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("Unable to start worker", err)
	}
}
