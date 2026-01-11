// temporal-workflows/internal/activities/lineage_activities.go
package activities

import (
	"context"
	"log/slog"
)

// ClientActivityRecord represents a single activity record from Bifrost
type ClientActivityRecord struct {
	VirtualClusterID string `json:"virtualClusterId"`
	ServiceAccountID string `json:"serviceAccountId"`
	TopicVirtualName string `json:"topicVirtualName"`
	Direction        string `json:"direction"` // "produce" or "consume"
	ConsumerGroupID  string `json:"consumerGroupId,omitempty"`
	Bytes            int64  `json:"bytes"`
	MessageCount     int64  `json:"messageCount"`
	WindowStart      string `json:"windowStart"` // RFC3339 timestamp
	WindowEnd        string `json:"windowEnd"`   // RFC3339 timestamp
}

// ProcessActivityBatchInput is the input for processing a batch of activity records
type ProcessActivityBatchInput struct {
	Records []ClientActivityRecord `json:"records"`
}

// ProcessActivityBatchOutput is the output of processing activity records
type ProcessActivityBatchOutput struct {
	ProcessedCount int    `json:"processedCount"`
	FailedCount    int    `json:"failedCount"`
	NewEdgesCount  int    `json:"newEdgesCount"`
}

// ResetStale24hMetricsInput is the input for resetting stale 24h metrics
type ResetStale24hMetricsInput struct{}

// ResetStale24hMetricsOutput is the output of resetting stale metrics
type ResetStale24hMetricsOutput struct {
	EdgesReset int `json:"edgesReset"`
}

// MarkInactiveEdgesInput is the input for marking inactive edges
type MarkInactiveEdgesInput struct {
	HoursThreshold int `json:"hoursThreshold"`
}

// MarkInactiveEdgesOutput is the output of marking inactive edges
type MarkInactiveEdgesOutput struct {
	EdgesMarked int `json:"edgesMarked"`
}

// CreateDailySnapshotsInput is the input for creating daily snapshots
type CreateDailySnapshotsInput struct {
	Date string `json:"date"` // YYYY-MM-DD format
}

// CreateDailySnapshotsOutput is the output of creating daily snapshots
type CreateDailySnapshotsOutput struct {
	SnapshotsCreated int `json:"snapshotsCreated"`
}

// LineageActivities defines the interface for lineage-related activities
type LineageActivities interface {
	// ProcessActivityBatch processes a batch of activity records and updates lineage edges
	ProcessActivityBatch(ctx context.Context, input ProcessActivityBatchInput) (*ProcessActivityBatchOutput, error)

	// ResetStale24hMetrics resets 24h rolling metrics for all edges
	ResetStale24hMetrics(ctx context.Context, input ResetStale24hMetricsInput) (*ResetStale24hMetricsOutput, error)

	// MarkInactiveEdges marks edges as inactive if not seen within threshold hours
	MarkInactiveEdges(ctx context.Context, input MarkInactiveEdgesInput) (*MarkInactiveEdgesOutput, error)

	// CreateDailySnapshots creates daily lineage snapshots for all active topics
	CreateDailySnapshots(ctx context.Context, input CreateDailySnapshotsInput) (*CreateDailySnapshotsOutput, error)
}

// LineageActivitiesImpl implements LineageActivities
type LineageActivitiesImpl struct {
	payloadURL string
	logger     *slog.Logger
}

// NewLineageActivities creates a new LineageActivities implementation
func NewLineageActivities(payloadURL string, logger *slog.Logger) *LineageActivitiesImpl {
	return &LineageActivitiesImpl{
		payloadURL: payloadURL,
		logger:     logger,
	}
}

// ProcessActivityBatch processes activity records and updates lineage edges
func (a *LineageActivitiesImpl) ProcessActivityBatch(ctx context.Context, input ProcessActivityBatchInput) (*ProcessActivityBatchOutput, error) {
	a.logger.Info("ProcessActivityBatch",
		"recordCount", len(input.Records))

	// TODO: For each record:
	// 1. Resolve virtual cluster to get application and workspace
	// 2. Resolve service account to get application and workspace
	// 3. Resolve topic by virtualClusterID and virtualName
	// 4. Upsert lineage edge via Payload API
	//
	// POST /api/kafka-lineage-edges/upsert (custom endpoint needed)
	// or find + create/update via standard endpoints

	processed := 0
	failed := 0
	newEdges := 0

	for _, record := range input.Records {
		a.logger.Debug("Processing activity record",
			"virtualClusterId", record.VirtualClusterID,
			"serviceAccountId", record.ServiceAccountID,
			"topic", record.TopicVirtualName,
			"direction", record.Direction,
			"bytes", record.Bytes,
			"messages", record.MessageCount)

		// TODO: Implement actual API calls
		processed++
	}

	return &ProcessActivityBatchOutput{
		ProcessedCount: processed,
		FailedCount:    failed,
		NewEdgesCount:  newEdges,
	}, nil
}

// ResetStale24hMetrics resets 24h rolling metrics for all edges
func (a *LineageActivitiesImpl) ResetStale24hMetrics(ctx context.Context, input ResetStale24hMetricsInput) (*ResetStale24hMetricsOutput, error) {
	a.logger.Info("ResetStale24hMetrics")

	// TODO: Call Payload API to reset 24h metrics
	// GET /api/kafka-lineage-edges?where[or][0][bytesLast24h][greater_than]=0&where[or][1][messagesLast24h][greater_than]=0
	// For each edge: PATCH /api/kafka-lineage-edges/:id { bytesLast24h: 0, messagesLast24h: 0 }

	return &ResetStale24hMetricsOutput{
		EdgesReset: 0, // Placeholder
	}, nil
}

// MarkInactiveEdges marks edges as inactive if not seen within threshold hours
func (a *LineageActivitiesImpl) MarkInactiveEdges(ctx context.Context, input MarkInactiveEdgesInput) (*MarkInactiveEdgesOutput, error) {
	a.logger.Info("MarkInactiveEdges",
		"hoursThreshold", input.HoursThreshold)

	// TODO: Call Payload API to mark inactive edges
	// Calculate threshold timestamp: now - hoursThreshold hours
	// GET /api/kafka-lineage-edges?where[and][0][isActive][equals]=true&where[and][1][lastSeen][less_than]=threshold
	// For each edge: PATCH /api/kafka-lineage-edges/:id { isActive: false }

	return &MarkInactiveEdgesOutput{
		EdgesMarked: 0, // Placeholder
	}, nil
}

// CreateDailySnapshots creates daily lineage snapshots for all active topics
func (a *LineageActivitiesImpl) CreateDailySnapshots(ctx context.Context, input CreateDailySnapshotsInput) (*CreateDailySnapshotsOutput, error) {
	a.logger.Info("CreateDailySnapshots",
		"date", input.Date)

	// TODO: For each active topic with lineage edges:
	// 1. Get all edges where topic = topicId
	// 2. Aggregate producer/consumer data
	// 3. Create snapshot record via Payload API
	//
	// POST /api/kafka-lineage-snapshots
	// {
	//   topic: topicId,
	//   workspace: workspaceId,
	//   snapshotDate: input.Date,
	//   producers: [...],
	//   consumers: [...],
	//   totalBytesIn: ...,
	//   totalBytesOut: ...,
	//   ...
	// }

	return &CreateDailySnapshotsOutput{
		SnapshotsCreated: 0, // Placeholder
	}, nil
}
