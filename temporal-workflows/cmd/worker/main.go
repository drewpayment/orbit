package main

import (
	"context"
	"log"
	"log/slog"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	internalClients "github.com/drewpayment/orbit/temporal-workflows/internal/clients"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/clients"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// healthClientAdapter adapts services.PayloadHealthClientImpl to activities.PayloadHealthClient
type healthClientAdapter struct {
	impl *services.PayloadHealthClientImpl
}

func (a *healthClientAdapter) UpdateAppStatus(ctx context.Context, appID, status string) error {
	return a.impl.UpdateAppStatus(ctx, appID, status)
}

func (a *healthClientAdapter) CreateHealthCheck(ctx context.Context, appID string, result activities.HealthCheckResult) error {
	// Convert activities.HealthCheckResult to services.HealthCheckResult
	return a.impl.CreateHealthCheck(ctx, appID, services.HealthCheckResult{
		Status:       result.Status,
		StatusCode:   result.StatusCode,
		ResponseTime: result.ResponseTime,
		Error:        result.Error,
	})
}

// buildClientAdapter adapts services.PayloadBuildClientImpl to activities.PayloadBuildClient
type buildClientAdapter struct {
	impl *services.PayloadBuildClientImpl
}

func (a *buildClientAdapter) UpdateAppBuildStatus(ctx context.Context, appID, status, imageURL, imageDigest, errorMsg string, buildConfig *types.DetectedBuildConfig, availableChoices []string) error {
	var svcBuildConfig *services.DetectedBuildConfig
	if buildConfig != nil {
		svcBuildConfig = &services.DetectedBuildConfig{
			Language:        buildConfig.Language,
			LanguageVersion: buildConfig.LanguageVersion,
			Framework:       buildConfig.Framework,
			BuildCommand:    buildConfig.BuildCommand,
			StartCommand:    buildConfig.StartCommand,
		}
	}
	return a.impl.UpdateAppBuildStatus(ctx, appID, status, imageURL, imageDigest, errorMsg, svcBuildConfig, availableChoices)
}

func (a *buildClientAdapter) GetGitHubInstallationToken(ctx context.Context, workspaceID string) (string, error) {
	return a.impl.GetGitHubInstallationToken(ctx, workspaceID)
}

func (a *buildClientAdapter) GetRegistryConfig(ctx context.Context, registryID string) (*activities.RegistryConfigData, error) {
	result, err := a.impl.GetRegistryConfig(ctx, registryID)
	if err != nil {
		return nil, err
	}
	return &activities.RegistryConfigData{
		Type:           result.Type,
		GHCROwner:      result.GHCROwner,
		ACRLoginServer: result.ACRLoginServer,
		ACRUsername:    result.ACRUsername,
		ACRToken:       result.ACRToken,
	}, nil
}

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

	deploymentWorkDir := os.Getenv("DEPLOYMENT_WORK_DIR")
	if deploymentWorkDir == "" {
		deploymentWorkDir = "/tmp/orbit-deployments"
	}

	// MinIO/S3 configuration for archiving
	minioEndpoint := os.Getenv("MINIO_ENDPOINT")
	if minioEndpoint == "" {
		minioEndpoint = "localhost:9000"
	}

	minioAccessKey := os.Getenv("MINIO_ACCESS_KEY")
	if minioAccessKey == "" {
		minioAccessKey = "minioadmin"
	}

	minioSecretKey := os.Getenv("MINIO_SECRET_KEY")
	if minioSecretKey == "" {
		minioSecretKey = "minioadmin"
	}

	minioBucket := os.Getenv("MINIO_BUCKET")
	if minioBucket == "" {
		minioBucket = "orbit-archives"
	}

	minioUseSSL := os.Getenv("MINIO_USE_SSL") == "true"

	orbitInternalAPIKey := os.Getenv("ORBIT_INTERNAL_API_KEY")
	if orbitInternalAPIKey == "" {
		log.Println("Warning: ORBIT_INTERNAL_API_KEY not set, GitHub operations will fail")
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
	w.RegisterWorkflow(workflows.DeploymentWorkflow)

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

	// Create token service for GitHub authentication
	tokenService := services.NewPayloadTokenService(orbitAPIURL, orbitInternalAPIKey)

	// Create and register template activities
	templateActivities := activities.NewTemplateActivities(
		tokenService,
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

	// Create and register deployment activities
	// TODO: Create PayloadDeploymentClient when implementing full integration
	var deploymentPayloadClient activities.PayloadDeploymentClient = nil
	deploymentActivities := activities.NewDeploymentActivities(
		deploymentWorkDir,
		deploymentPayloadClient,
		logger,
	)
	w.RegisterActivity(deploymentActivities.ValidateDeploymentConfig)
	w.RegisterActivity(deploymentActivities.PrepareGeneratorContext)
	w.RegisterActivity(deploymentActivities.ExecuteGenerator)
	w.RegisterActivity(deploymentActivities.UpdateDeploymentStatus)
	w.RegisterActivity(deploymentActivities.CommitToRepo)

	// Create and register health check activities
	payloadHealthClientImpl := services.NewPayloadHealthClient(orbitAPIURL, orbitInternalAPIKey)
	payloadHealthClient := &healthClientAdapter{impl: payloadHealthClientImpl}
	healthCheckActivities := activities.NewHealthCheckActivities(payloadHealthClient)
	w.RegisterActivity(healthCheckActivities.PerformHealthCheckActivity)
	w.RegisterActivity(healthCheckActivities.RecordHealthResultActivity)

	// Register health check workflow
	w.RegisterWorkflow(workflows.HealthCheckWorkflow)

	// Build service address
	buildServiceAddr := os.Getenv("BUILD_SERVICE_ADDRESS")
	if buildServiceAddr == "" {
		buildServiceAddr = "build-service:50054"
	}

	// Register build workflow
	w.RegisterWorkflow(workflows.BuildWorkflow)

	// Create and register build activities
	payloadBuildClientImpl := services.NewPayloadBuildClient(orbitAPIURL, orbitInternalAPIKey)
	buildPayloadClient := &buildClientAdapter{impl: payloadBuildClientImpl}
	buildActivities := activities.NewBuildActivitiesWithAddr(
		buildPayloadClient,
		logger,
		buildServiceAddr,
	)
	w.RegisterActivity(buildActivities.AnalyzeRepository)
	w.RegisterActivity(buildActivities.BuildAndPushImage)
	w.RegisterActivity(buildActivities.UpdateBuildStatus)
	w.RegisterActivity(buildActivities.CheckQuotaAndCleanup)
	w.RegisterActivity(buildActivities.TrackImage)

	log.Printf("Build service address: %s", buildServiceAddr)

	// =======================================================================
	// Kafka/Bifrost Activities
	// =======================================================================

	// Bifrost admin URL for gRPC
	bifrostAdminURL := os.Getenv("BIFROST_ADMIN_URL")
	if bifrostAdminURL == "" {
		bifrostAdminURL = "localhost:50060"
	}

	// Create shared Payload CMS client for Kafka activities
	kafkaPayloadClient := internalClients.NewPayloadClient(orbitAPIURL, orbitInternalAPIKey, logger)

	// Create Bifrost gRPC client
	bifrostClient, err := internalClients.NewBifrostClient(bifrostAdminURL, logger)
	if err != nil {
		log.Printf("Warning: Failed to create Bifrost client: %v", err)
		log.Println("Virtual cluster activities will not work until Bifrost is available")
		bifrostClient = nil
	} else {
		defer bifrostClient.Close()
	}

	// Register virtual cluster provisioning workflows
	w.RegisterWorkflow(workflows.VirtualClusterProvisionWorkflow)
	w.RegisterWorkflow(workflows.SingleVirtualClusterProvisionWorkflow)

	// Create and register virtual cluster activities
	vcActivities := activities.NewVirtualClusterActivities(kafkaPayloadClient, bifrostClient, logger)
	w.RegisterActivity(vcActivities.GetEnvironmentMapping)
	w.RegisterActivity(vcActivities.CreateVirtualCluster)
	w.RegisterActivity(vcActivities.PushToBifrost)
	w.RegisterActivity(vcActivities.UpdateVirtualClusterStatus)
	w.RegisterActivity(vcActivities.UpdateApplicationProvisioningStatus)
	log.Printf("Bifrost admin URL: %s", bifrostAdminURL)

	// Register credential sync workflows
	w.RegisterWorkflow(workflows.CredentialUpsertWorkflow)
	w.RegisterWorkflow(workflows.CredentialRevokeWorkflow)

	// Create and register credential activities (uses same BifrostClient as virtual cluster activities)
	credActivities := activities.NewCredentialActivities(bifrostClient, logger)
	w.RegisterActivity(credActivities.SyncCredentialToBifrost)
	w.RegisterActivity(credActivities.RevokeCredentialFromBifrost)

	// Register topic sync workflows (gateway → orbit sync)
	w.RegisterWorkflow(workflows.TopicCreatedSyncWorkflow)
	w.RegisterWorkflow(workflows.TopicDeletedSyncWorkflow)
	w.RegisterWorkflow(workflows.TopicConfigSyncWorkflow)

	// Create and register topic sync activities
	topicSyncActivities := activities.NewTopicSyncActivities(kafkaPayloadClient, logger)
	w.RegisterActivity(topicSyncActivities.CreateTopicRecord)
	w.RegisterActivity(topicSyncActivities.MarkTopicDeleted)
	w.RegisterActivity(topicSyncActivities.UpdateTopicConfig)

	// Register Kafka topic provisioning workflows
	w.RegisterWorkflow(workflows.TopicProvisioningWorkflow)
	w.RegisterWorkflow(workflows.TopicDeletionWorkflow)

	// Register Kafka access provisioning/revocation workflows
	w.RegisterWorkflow(workflows.AccessProvisioningWorkflow)
	w.RegisterWorkflow(workflows.AccessRevocationWorkflow)

	// Create adapter factory for Kafka activities
	kafkaAdapterFactory := internalClients.NewKafkaAdapterFactory(kafkaPayloadClient)

	// Create and register Kafka activities (with adapter factory)
	kafkaActivities := activities.NewKafkaActivities(kafkaPayloadClient, kafkaAdapterFactory, logger)
	w.RegisterActivity(kafkaActivities.ProvisionTopic)
	w.RegisterActivity(kafkaActivities.UpdateTopicStatus)
	w.RegisterActivity(kafkaActivities.DeleteTopic)
	w.RegisterActivity(kafkaActivities.ValidateSchema)
	w.RegisterActivity(kafkaActivities.RegisterSchema)
	w.RegisterActivity(kafkaActivities.UpdateSchemaStatus)
	w.RegisterActivity(kafkaActivities.ProvisionAccess)
	w.RegisterActivity(kafkaActivities.RevokeAccess)
	w.RegisterActivity(kafkaActivities.UpdateShareStatus)

	// Register lineage processing workflows
	w.RegisterWorkflow(workflows.ActivityProcessingWorkflow)
	w.RegisterWorkflow(workflows.LineageAggregationWorkflow)
	w.RegisterWorkflow(workflows.ScheduledLineageMaintenanceWorkflow)

	// Create and register lineage activities
	lineageActivities := activities.NewLineageActivities(kafkaPayloadClient, logger)
	w.RegisterActivity(lineageActivities.ProcessActivityBatch)
	w.RegisterActivity(lineageActivities.ResetStale24hMetrics)
	w.RegisterActivity(lineageActivities.MarkInactiveEdges)
	w.RegisterActivity(lineageActivities.CreateDailySnapshots)
	log.Printf("Lineage activities registered with Payload URL: %s", orbitAPIURL)

	// Create storage client for archiving
	storageClient, err := internalClients.NewStorageClient(
		minioEndpoint,
		minioAccessKey,
		minioSecretKey,
		minioBucket,
		minioUseSSL,
		logger,
	)
	if err != nil {
		log.Printf("Warning: Failed to create storage client: %v", err)
		log.Println("Archiving activities will not work until MinIO is available")
		storageClient = nil
	} else {
		defer storageClient.Close()
		// Ensure bucket exists
		if err := storageClient.EnsureBucket(context.Background()); err != nil {
			log.Printf("Warning: Failed to ensure bucket exists: %v", err)
		}
	}

	// Register decommissioning/cleanup workflows
	w.RegisterWorkflow(workflows.ApplicationDecommissioningWorkflow)
	w.RegisterWorkflow(workflows.ApplicationCleanupWorkflow)

	// Create and register decommissioning activities
	decommissioningActivities := activities.NewDecommissioningActivities(
		kafkaPayloadClient,
		bifrostClient,
		kafkaAdapterFactory,
		storageClient,
		c, // Temporal client for schedule creation
		logger,
	)
	w.RegisterActivity(decommissioningActivities.CheckApplicationStatus)
	w.RegisterActivity(decommissioningActivities.SetVirtualClustersReadOnly)
	w.RegisterActivity(decommissioningActivities.MarkApplicationDeleted)
	w.RegisterActivity(decommissioningActivities.UpdateApplicationWorkflowID)
	w.RegisterActivity(decommissioningActivities.RevokeAllCredentials)
	w.RegisterActivity(decommissioningActivities.DeletePhysicalTopics)
	w.RegisterActivity(decommissioningActivities.DeleteVirtualClustersFromBifrost)
	w.RegisterActivity(decommissioningActivities.ArchiveMetricsData)
	w.RegisterActivity(decommissioningActivities.ScheduleCleanupWorkflow)
	w.RegisterActivity(decommissioningActivities.ExecuteImmediateCleanup)
	log.Printf("Decommissioning activities registered with MinIO endpoint: %s", minioEndpoint)

	log.Println("Starting Temporal worker...")
	log.Printf("Temporal address: %s", temporalAddress)
	log.Printf("Temporal namespace: %s", temporalNamespace)
	log.Printf("Orbit API URL: %s", orbitAPIURL)
	log.Printf("Git work directory: %s", workDir)
	log.Printf("Template work directory: %s", templateWorkDir)
	log.Printf("Deployment work directory: %s", deploymentWorkDir)
	log.Println("Task queue: orbit-workflows")

	// Start worker
	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalln("Unable to start worker", err)
	}
}
