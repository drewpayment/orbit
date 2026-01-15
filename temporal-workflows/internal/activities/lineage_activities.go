// temporal-workflows/internal/activities/lineage_activities.go
package activities

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
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
	payloadClient *clients.PayloadClient
	logger        *slog.Logger
}

// NewLineageActivities creates a new LineageActivities implementation
func NewLineageActivities(payloadClient *clients.PayloadClient, logger *slog.Logger) *LineageActivitiesImpl {
	return &LineageActivitiesImpl{
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// Ensure LineageActivitiesImpl implements LineageActivities
var _ LineageActivities = (*LineageActivitiesImpl)(nil)

// ProcessActivityBatch processes activity records and updates lineage edges
func (a *LineageActivitiesImpl) ProcessActivityBatch(ctx context.Context, input ProcessActivityBatchInput) (*ProcessActivityBatchOutput, error) {
	a.logger.Info("ProcessActivityBatch",
		"recordCount", len(input.Records))

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

		err := a.processRecord(ctx, record, &newEdges)
		if err != nil {
			a.logger.Error("Failed to process activity record",
				"error", err,
				"virtualClusterId", record.VirtualClusterID,
				"topic", record.TopicVirtualName)
			failed++
			continue
		}
		processed++
	}

	return &ProcessActivityBatchOutput{
		ProcessedCount: processed,
		FailedCount:    failed,
		NewEdgesCount:  newEdges,
	}, nil
}

// processRecord processes a single activity record
func (a *LineageActivitiesImpl) processRecord(ctx context.Context, record ClientActivityRecord, newEdges *int) error {
	// 1. Query virtual cluster to get application
	vcQuery := clients.NewQueryBuilder().
		WhereEquals("id", record.VirtualClusterID).
		Depth(1).
		Build()

	vcDoc, err := a.payloadClient.FindOne(ctx, "kafka-virtual-clusters", vcQuery)
	if err != nil {
		return fmt.Errorf("querying virtual cluster: %w", err)
	}
	if vcDoc == nil {
		return fmt.Errorf("virtual cluster not found: %s", record.VirtualClusterID)
	}

	// Extract application from virtual cluster (could be string ID or populated object)
	applicationID := extractRelationID(vcDoc, "application")
	if applicationID == "" {
		return fmt.Errorf("virtual cluster has no application: %s", record.VirtualClusterID)
	}

	// 2. Query application to get workspace
	appQuery := clients.NewQueryBuilder().
		WhereEquals("id", applicationID).
		Depth(1).
		Build()

	appDoc, err := a.payloadClient.FindOne(ctx, "kafka-applications", appQuery)
	if err != nil {
		return fmt.Errorf("querying application: %w", err)
	}
	if appDoc == nil {
		return fmt.Errorf("application not found: %s", applicationID)
	}

	workspaceID := extractRelationID(appDoc, "workspace")
	if workspaceID == "" {
		return fmt.Errorf("application has no workspace: %s", applicationID)
	}

	// 3. Query topic by virtual cluster and virtual name
	topicQuery := clients.NewQueryBuilder().
		WhereEquals("virtualCluster", record.VirtualClusterID).
		WhereEquals("name", record.TopicVirtualName).
		Limit(1).
		Build()

	topicDoc, err := a.payloadClient.FindOne(ctx, "kafka-topics", topicQuery)
	if err != nil {
		return fmt.Errorf("querying topic: %w", err)
	}
	if topicDoc == nil {
		return fmt.Errorf("topic not found: %s in cluster %s", record.TopicVirtualName, record.VirtualClusterID)
	}

	topicID, _ := topicDoc["id"].(string)
	if topicID == "" {
		return fmt.Errorf("topic has no ID")
	}

	// 4. Check for existing lineage edge
	edgeQuery := clients.NewQueryBuilder().
		WhereEquals("sourceServiceAccount", record.ServiceAccountID).
		WhereEquals("topic", topicID).
		WhereEquals("direction", record.Direction).
		Limit(1).
		Build()

	existingEdge, err := a.payloadClient.FindOne(ctx, "kafka-lineage-edges", edgeQuery)
	if err != nil {
		return fmt.Errorf("querying lineage edge: %w", err)
	}

	now := time.Now().Format(time.RFC3339)

	if existingEdge != nil {
		// Update existing edge: accumulate metrics
		edgeID, _ := existingEdge["id"].(string)
		existingBytesTotal := getIntValue(existingEdge, "bytesAllTime")
		existingMessagesTotal := getIntValue(existingEdge, "messagesAllTime")
		existingBytesLast24h := getIntValue(existingEdge, "bytesLast24h")
		existingMessagesLast24h := getIntValue(existingEdge, "messagesLast24h")

		updateData := map[string]any{
			"bytesAllTime":       existingBytesTotal + record.Bytes,
			"messagesAllTime":    existingMessagesTotal + record.MessageCount,
			"bytesLast24h":     existingBytesLast24h + record.Bytes,
			"messagesLast24h":  existingMessagesLast24h + record.MessageCount,
			"lastSeen":         now,
			"isActive":         true,
		}

		// Add consumer group if present
		if record.ConsumerGroupID != "" {
			updateData["consumerGroup"] = record.ConsumerGroupID
		}

		if err := a.payloadClient.Update(ctx, "kafka-lineage-edges", edgeID, updateData); err != nil {
			return fmt.Errorf("updating lineage edge: %w", err)
		}
	} else {
		// Create new edge
		createData := map[string]any{
			"sourceServiceAccount": record.ServiceAccountID,
			"topic":                topicID,
			"direction":            record.Direction,
			"workspace":            workspaceID,
			"bytesAllTime":           record.Bytes,
			"messagesAllTime":        record.MessageCount,
			"bytesLast24h":         record.Bytes,
			"messagesLast24h":      record.MessageCount,
			"lastSeen":             now,
			"firstSeen":            now,
			"isActive":             true,
		}

		// Add consumer group if present
		if record.ConsumerGroupID != "" {
			createData["consumerGroup"] = record.ConsumerGroupID
		}

		_, err := a.payloadClient.Create(ctx, "kafka-lineage-edges", createData)
		if err != nil {
			return fmt.Errorf("creating lineage edge: %w", err)
		}
		*newEdges++
	}

	return nil
}

// extractRelationID extracts a relation ID which could be a string or populated object
func extractRelationID(doc map[string]any, field string) string {
	val := doc[field]
	if val == nil {
		return ""
	}

	// Check if it's a direct string ID
	if strID, ok := val.(string); ok {
		return strID
	}

	// Check if it's a populated object with an id field
	if objVal, ok := val.(map[string]any); ok {
		if id, ok := objVal["id"].(string); ok {
			return id
		}
	}

	return ""
}

// getIntValue safely extracts an int64 value from a document field
func getIntValue(doc map[string]any, field string) int64 {
	val := doc[field]
	if val == nil {
		return 0
	}

	switch v := val.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case float32:
		return int64(v)
	default:
		return 0
	}
}

// ResetStale24hMetrics resets 24h rolling metrics for all edges
func (a *LineageActivitiesImpl) ResetStale24hMetrics(ctx context.Context, input ResetStale24hMetricsInput) (*ResetStale24hMetricsOutput, error) {
	a.logger.Info("ResetStale24hMetrics")

	// Build query for edges with non-zero 24h metrics
	// Using OR condition: bytesLast24h > 0 OR messagesLast24h > 0
	query := url.Values{}
	query.Set("where[or][0][bytesLast24h][greater_than]", "0")
	query.Set("where[or][1][messagesLast24h][greater_than]", "0")
	query.Set("limit", "1000") // Process in batches

	edges, err := a.payloadClient.Find(ctx, "kafka-lineage-edges", query)
	if err != nil {
		return nil, fmt.Errorf("querying edges with stale metrics: %w", err)
	}

	resetCount := 0
	for _, edge := range edges {
		edgeID, _ := edge["id"].(string)
		if edgeID == "" {
			continue
		}

		updateData := map[string]any{
			"bytesLast24h":    0,
			"messagesLast24h": 0,
		}

		if err := a.payloadClient.Update(ctx, "kafka-lineage-edges", edgeID, updateData); err != nil {
			a.logger.Error("Failed to reset edge metrics",
				"error", err,
				"edgeId", edgeID)
			continue
		}
		resetCount++
	}

	a.logger.Info("ResetStale24hMetrics completed",
		"edgesReset", resetCount)

	return &ResetStale24hMetricsOutput{
		EdgesReset: resetCount,
	}, nil
}

// MarkInactiveEdges marks edges as inactive if not seen within threshold hours
func (a *LineageActivitiesImpl) MarkInactiveEdges(ctx context.Context, input MarkInactiveEdgesInput) (*MarkInactiveEdgesOutput, error) {
	a.logger.Info("MarkInactiveEdges",
		"hoursThreshold", input.HoursThreshold)

	// Calculate threshold timestamp: now - hoursThreshold hours
	threshold := time.Now().Add(-time.Duration(input.HoursThreshold) * time.Hour)
	thresholdStr := threshold.Format(time.RFC3339)

	// Build query for edges that are active but haven't been seen since threshold
	query := url.Values{}
	query.Set("where[and][0][isActive][equals]", "true")
	query.Set("where[and][1][lastSeen][less_than]", thresholdStr)
	query.Set("limit", "1000") // Process in batches

	edges, err := a.payloadClient.Find(ctx, "kafka-lineage-edges", query)
	if err != nil {
		return nil, fmt.Errorf("querying inactive edges: %w", err)
	}

	markedCount := 0
	for _, edge := range edges {
		edgeID, _ := edge["id"].(string)
		if edgeID == "" {
			continue
		}

		updateData := map[string]any{
			"isActive": false,
		}

		if err := a.payloadClient.Update(ctx, "kafka-lineage-edges", edgeID, updateData); err != nil {
			a.logger.Error("Failed to mark edge as inactive",
				"error", err,
				"edgeId", edgeID)
			continue
		}
		markedCount++
	}

	a.logger.Info("MarkInactiveEdges completed",
		"edgesMarked", markedCount,
		"threshold", thresholdStr)

	return &MarkInactiveEdgesOutput{
		EdgesMarked: markedCount,
	}, nil
}

// CreateDailySnapshots creates daily lineage snapshots for all active topics
func (a *LineageActivitiesImpl) CreateDailySnapshots(ctx context.Context, input CreateDailySnapshotsInput) (*CreateDailySnapshotsOutput, error) {
	a.logger.Info("CreateDailySnapshots",
		"date", input.Date)

	// Query all active edges with populated topic
	query := clients.NewQueryBuilder().
		WhereEquals("isActive", "true").
		Depth(1). // Populate topic
		Limit(1000).
		Build()

	edges, err := a.payloadClient.Find(ctx, "kafka-lineage-edges", query)
	if err != nil {
		return nil, fmt.Errorf("querying active edges: %w", err)
	}

	if len(edges) == 0 {
		a.logger.Info("No active edges found, skipping snapshot creation")
		return &CreateDailySnapshotsOutput{
			SnapshotsCreated: 0,
		}, nil
	}

	// Group edges by topic ID
	topicEdges := make(map[string][]map[string]any)
	topicWorkspaces := make(map[string]string)

	for _, edge := range edges {
		topicID := extractRelationID(edge, "topic")
		if topicID == "" {
			continue
		}

		topicEdges[topicID] = append(topicEdges[topicID], edge)

		// Track workspace for this topic
		if _, exists := topicWorkspaces[topicID]; !exists {
			workspaceID := extractRelationID(edge, "workspace")
			if workspaceID != "" {
				topicWorkspaces[topicID] = workspaceID
			}
		}
	}

	snapshotsCreated := 0

	// Create a snapshot for each topic
	for topicID, edges := range topicEdges {
		snapshot, err := a.aggregateTopicSnapshot(topicID, topicWorkspaces[topicID], input.Date, edges)
		if err != nil {
			a.logger.Error("Failed to aggregate snapshot",
				"error", err,
				"topicId", topicID)
			continue
		}

		_, err = a.payloadClient.Create(ctx, "kafka-lineage-snapshots", snapshot)
		if err != nil {
			a.logger.Error("Failed to create snapshot",
				"error", err,
				"topicId", topicID)
			continue
		}
		snapshotsCreated++
	}

	a.logger.Info("CreateDailySnapshots completed",
		"snapshotsCreated", snapshotsCreated,
		"totalTopics", len(topicEdges))

	return &CreateDailySnapshotsOutput{
		SnapshotsCreated: snapshotsCreated,
	}, nil
}

// ProducerSummary represents producer aggregation for a snapshot
type ProducerSummary struct {
	ServiceAccountID string `json:"serviceAccountId"`
	BytesTotal       int64  `json:"bytesAllTime"`
	MessagesTotal    int64  `json:"messagesAllTime"`
}

// ConsumerSummary represents consumer aggregation for a snapshot
type ConsumerSummary struct {
	ServiceAccountID string `json:"serviceAccountId"`
	ConsumerGroupID  string `json:"consumerGroupId,omitempty"`
	BytesTotal       int64  `json:"bytesAllTime"`
	MessagesTotal    int64  `json:"messagesAllTime"`
}

// aggregateTopicSnapshot aggregates edges for a topic into a snapshot
func (a *LineageActivitiesImpl) aggregateTopicSnapshot(topicID, workspaceID, date string, edges []map[string]any) (map[string]any, error) {
	var producers []map[string]any
	var consumers []map[string]any
	var totalBytesIn int64
	var totalBytesOut int64
	var totalMessagesIn int64
	var totalMessagesOut int64

	for _, edge := range edges {
		direction, _ := edge["direction"].(string)
		serviceAccountID := extractRelationID(edge, "sourceServiceAccount")
		bytesAllTime := getIntValue(edge, "bytesAllTime")
		messagesAllTime := getIntValue(edge, "messagesAllTime")

		if direction == "produce" {
			producers = append(producers, map[string]any{
				"serviceAccountId": serviceAccountID,
				"bytesAllTime":       bytesAllTime,
				"messagesAllTime":    messagesAllTime,
			})
			totalBytesIn += bytesAllTime
			totalMessagesIn += messagesAllTime
		} else if direction == "consume" {
			consumerGroupID := ""
			if cg := edge["consumerGroup"]; cg != nil {
				if cgStr, ok := cg.(string); ok {
					consumerGroupID = cgStr
				}
			}
			consumers = append(consumers, map[string]any{
				"serviceAccountId": serviceAccountID,
				"consumerGroupId":  consumerGroupID,
				"bytesAllTime":       bytesAllTime,
				"messagesAllTime":    messagesAllTime,
			})
			totalBytesOut += bytesAllTime
			totalMessagesOut += messagesAllTime
		}
	}

	snapshot := map[string]any{
		"topic":            topicID,
		"snapshotDate":     date,
		"producers":        producers,
		"consumers":        consumers,
		"totalBytesIn":     totalBytesIn,
		"totalBytesOut":    totalBytesOut,
		"totalMessagesIn":  totalMessagesIn,
		"totalMessagesOut": totalMessagesOut,
		"producerCount":    len(producers),
		"consumerCount":    len(consumers),
	}

	if workspaceID != "" {
		snapshot["workspace"] = workspaceID
	}

	return snapshot, nil
}
