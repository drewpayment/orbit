package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// ErrKafkaVirtualClusterNotFound is returned by
// PayloadKafkaTopicClient.CreateTopic when the caller-supplied virtual
// cluster id does not resolve to a kafka-virtual-clusters doc.
var ErrKafkaVirtualClusterNotFound = errors.New("kafka virtual cluster not found")

// KafkaTopicCreateInput is the body of POST /api/internal/kafka-topics.
type KafkaTopicCreateInput struct {
	WorkspaceID      string `json:"workspaceId"`
	VirtualClusterID string `json:"virtualClusterId"`
	Name             string `json:"name"`
	Description      string `json:"description,omitempty"`
	Environment      string `json:"environment,omitempty"`
	Partitions       int    `json:"partitions,omitempty"`
	RetentionMs      int64  `json:"retentionMs,omitempty"`
	// Owner is a free-text team/user label. kafka-topics has no owner field
	// today, so the route stores it as a topic tag (owner:<value>) rather
	// than a dedicated column.
	Owner string `json:"owner,omitempty"`
}

// KafkaTopicDoc is the subset of a kafka-topics row the scaffolder action
// needs back from the create call.
type KafkaTopicDoc struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	Partitions int    `json:"partitions"`
	// FullTopicName is `${topicPrefix}${name}`, set by the route at create
	// time and refreshed by KafkaActivitiesImpl.UpdateTopicStatus once
	// ProvisionTopic confirms it.
	FullTopicName string `json:"fullTopicName"`
	// TopicPrefix is the owning virtual cluster's prefix for physical topic
	// names, e.g. "acme-dev-". The route resolves it once (it already has
	// to look up the cluster to check workspace ownership), so the action
	// can pass it straight into KafkaTopicProvisionInput.TopicPrefix
	// without a second lookup — ProvisionTopic computes the same physical
	// name (TopicPrefix + TopicName) itself.
	TopicPrefix string `json:"topicPrefix"`
}

// PayloadKafkaTopicClient talks to orbit-www's internal kafka-topics API on
// behalf of the kafka:topic:provision scaffolder action.
type PayloadKafkaTopicClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewPayloadKafkaTopicClient constructs a PayloadKafkaTopicClient.
func NewPayloadKafkaTopicClient(baseURL, apiKey string, logger *slog.Logger) *PayloadKafkaTopicClient {
	if logger == nil {
		logger = slog.Default()
	}
	return &PayloadKafkaTopicClient{
		baseURL:    baseURL,
		apiKey:     apiKey,
		httpClient: &http.Client{Timeout: 15 * time.Second},
		logger:     logger,
	}
}

// CreateTopic creates the kafka-topics row for (workspace, virtualCluster,
// name), or returns the existing one if a prior call (or a Temporal retry of
// the same step) already created it — the route is idempotent on that
// tuple, so a retried kafka:topic:provision step never duplicates the row.
func (c *PayloadKafkaTopicClient) CreateTopic(ctx context.Context, in KafkaTopicCreateInput) (KafkaTopicDoc, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return KafkaTopicDoc{}, fmt.Errorf("marshal create kafka topic request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/internal/kafka-topics", bytes.NewReader(body))
	if err != nil {
		return KafkaTopicDoc{}, fmt.Errorf("create kafka topic request: %w", err)
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return KafkaTopicDoc{}, fmt.Errorf("create kafka topic: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode == http.StatusNotFound {
		return KafkaTopicDoc{}, ErrKafkaVirtualClusterNotFound
	}
	if resp.StatusCode/100 != 2 {
		return KafkaTopicDoc{}, fmt.Errorf("create kafka topic: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var doc KafkaTopicDoc
	if err := json.Unmarshal(respBody, &doc); err != nil {
		return KafkaTopicDoc{}, fmt.Errorf("create kafka topic: decode response: %w", err)
	}
	if doc.ID == "" {
		return KafkaTopicDoc{}, fmt.Errorf("create kafka topic: response missing id")
	}
	return doc, nil
}
