package main

import (
	"log"
	"log/slog"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
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

	workDir := os.Getenv("GIT_WORK_DIR")
	if workDir == "" {
		workDir = "/tmp/orbit-repos"
	}

	templateWorkDir := os.Getenv("TEMPLATE_WORK_DIR")
	if templateWorkDir == "" {
		templateWorkDir = "/tmp/orbit-templates"
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
	w.RegisterWorkflow(workflows.TemplateInstantiationWorkflow)

	// Initialize HTTP client for activities
	activityClients := clients.NewHTTPActivityClients(orbitAPIURL)

	// Register activities
	w.RegisterActivity(activityClients.RefreshGitHubInstallationTokenActivity)
	w.RegisterActivity(activityClients.UpdateInstallationStatusActivity)

	// TODO: Implement PayloadClient, EncryptionService, and GitHubClient
	// These will be created in later tasks
	// For now, using nil to allow compilation
	var payloadClient services.PayloadClient = nil       // TODO: Implement
	var encryptionService services.EncryptionService = nil // TODO: Implement
	var githubClient services.GitHubClient = nil         // TODO: Implement

	// Create GitHub service
	githubService := services.NewGitHubService(payloadClient, encryptionService, githubClient)

	// Create logger
	logger := slog.Default()

	// Create and register Git activities
	gitActivities := activities.NewGitActivities(workDir, githubService, logger)
	w.RegisterActivity(gitActivities.CloneTemplateActivity)
	w.RegisterActivity(gitActivities.ApplyVariablesActivity)
	w.RegisterActivity(gitActivities.InitializeGitActivity)
	w.RegisterActivity(gitActivities.PushToRemoteActivity)

	// Create GitHub template client (token will be passed per-workflow)
	githubTemplateClient := services.NewGitHubTemplateClient("", "")

	// Create and register template activities
	templateActivities := activities.NewTemplateActivities(
		githubTemplateClient,
		templateWorkDir,
		logger,
	)
	w.RegisterActivity(templateActivities.ValidateInstantiationInput)
	w.RegisterActivity(templateActivities.CreateRepoFromTemplate)
	w.RegisterActivity(templateActivities.CreateEmptyRepo)
	w.RegisterActivity(templateActivities.CloneTemplateRepo)
	w.RegisterActivity(templateActivities.ApplyTemplateVariables)
	w.RegisterActivity(templateActivities.PushToNewRepo)
	w.RegisterActivity(templateActivities.CleanupWorkDir)
	w.RegisterActivity(templateActivities.FinalizeInstantiation)

	log.Println("Starting Temporal worker...")
	log.Printf("Temporal address: %s", temporalAddress)
	log.Printf("Temporal namespace: %s", temporalNamespace)
	log.Printf("Orbit API URL: %s", orbitAPIURL)
	log.Printf("Git work directory: %s", workDir)
	log.Printf("Template work directory: %s", templateWorkDir)
	log.Println("Task queue: orbit-workflows")

	// Start worker
	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("Unable to start worker", err)
	}
}
