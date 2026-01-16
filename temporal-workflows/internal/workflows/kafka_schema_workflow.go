package workflows

import (
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	// KafkaSchemaValidationTaskQueue is the task queue for schema validation workflows
	KafkaSchemaValidationTaskQueue = "orbit-workflows"
)

// SchemaValidationWorkflowInput defines input for the schema validation workflow
type SchemaValidationWorkflowInput struct {
	SchemaID      string
	TopicID       string
	WorkspaceID   string
	Type          string // "key" or "value"
	Format        string // "avro", "protobuf", "json"
	Content       string
	Compatibility string
	AutoRegister  bool // If true, register the schema after validation
}

// SchemaValidationWorkflowResult defines the output of the schema validation workflow
type SchemaValidationWorkflowResult struct {
	SchemaID     string
	RegistryID   int32
	Version      int32
	IsCompatible bool
	Status       string
	Error        string
}

// SchemaValidationWorkflow orchestrates the validation and optional registration of a schema
func SchemaValidationWorkflow(ctx workflow.Context, input SchemaValidationWorkflowInput) (SchemaValidationWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting schema validation workflow",
		"SchemaID", input.SchemaID,
		"TopicID", input.TopicID,
		"Type", input.Type,
		"Format", input.Format,
	)

	// Configure activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var kafkaActivities *activities.KafkaActivitiesImpl

	// Step 1: Update status to validating
	logger.Info("Step 1: Updating schema status to validating")
	_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateSchemaStatus, activities.KafkaUpdateSchemaStatusInput{
		SchemaID: input.SchemaID,
		Status:   "validating",
	}).Get(ctx, nil)

	// Step 2: Validate schema compatibility
	logger.Info("Step 2: Validating schema compatibility")
	validateInput := activities.KafkaSchemaValidationInput{
		SchemaID:      input.SchemaID,
		TopicID:       input.TopicID,
		Type:          input.Type,
		Format:        input.Format,
		Content:       input.Content,
		Compatibility: input.Compatibility,
	}

	var validateOutput *activities.KafkaSchemaValidationOutput
	err := workflow.ExecuteActivity(ctx, kafkaActivities.ValidateSchema, validateInput).Get(ctx, &validateOutput)
	if err != nil {
		logger.Error("Failed to validate schema", "Error", err)

		_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateSchemaStatus, activities.KafkaUpdateSchemaStatusInput{
			SchemaID: input.SchemaID,
			Status:   "validation_failed",
			Error:    err.Error(),
		}).Get(ctx, nil)

		return SchemaValidationWorkflowResult{
			SchemaID:     input.SchemaID,
			IsCompatible: false,
			Status:       "validation_failed",
			Error:        err.Error(),
		}, err
	}

	// Check if schema is compatible
	if !validateOutput.IsCompatible {
		logger.Warn("Schema is not compatible", "SchemaID", input.SchemaID)

		_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateSchemaStatus, activities.KafkaUpdateSchemaStatusInput{
			SchemaID: input.SchemaID,
			Status:   "incompatible",
		}).Get(ctx, nil)

		return SchemaValidationWorkflowResult{
			SchemaID:     input.SchemaID,
			IsCompatible: false,
			Status:       "incompatible",
		}, nil
	}

	// Step 3: Register schema if auto-register is enabled
	if input.AutoRegister {
		logger.Info("Step 3: Registering schema with Schema Registry")

		var registerOutput *activities.KafkaSchemaValidationOutput
		err = workflow.ExecuteActivity(ctx, kafkaActivities.RegisterSchema, validateInput).Get(ctx, &registerOutput)
		if err != nil {
			logger.Error("Failed to register schema", "Error", err)

			_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateSchemaStatus, activities.KafkaUpdateSchemaStatusInput{
				SchemaID: input.SchemaID,
				Status:   "registration_failed",
				Error:    err.Error(),
			}).Get(ctx, nil)

			return SchemaValidationWorkflowResult{
				SchemaID:     input.SchemaID,
				IsCompatible: true,
				Status:       "registration_failed",
				Error:        err.Error(),
			}, err
		}

		// Update status to registered
		_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateSchemaStatus, activities.KafkaUpdateSchemaStatusInput{
			SchemaID:   input.SchemaID,
			Status:     "registered",
			RegistryID: registerOutput.RegistryID,
			Version:    registerOutput.Version,
		}).Get(ctx, nil)

		logger.Info("Schema validation and registration completed successfully",
			"SchemaID", input.SchemaID,
			"RegistryID", registerOutput.RegistryID,
			"Version", registerOutput.Version,
		)

		return SchemaValidationWorkflowResult{
			SchemaID:     input.SchemaID,
			RegistryID:   registerOutput.RegistryID,
			Version:      registerOutput.Version,
			IsCompatible: true,
			Status:       "registered",
		}, nil
	}

	// Update status to validated (not registered)
	_ = workflow.ExecuteActivity(ctx, kafkaActivities.UpdateSchemaStatus, activities.KafkaUpdateSchemaStatusInput{
		SchemaID: input.SchemaID,
		Status:   "validated",
	}).Get(ctx, nil)

	logger.Info("Schema validation completed successfully", "SchemaID", input.SchemaID)

	return SchemaValidationWorkflowResult{
		SchemaID:     input.SchemaID,
		IsCompatible: true,
		Status:       "validated",
	}, nil
}
