package activities

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewLineageActivities(t *testing.T) {
	logger := slog.Default()
	payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)

	activities := NewLineageActivities(payloadClient, logger)
	assert.NotNil(t, activities)
	assert.NotNil(t, activities.payloadClient)
	assert.NotNil(t, activities.logger)
}

func TestProcessActivityBatch_NewEdge(t *testing.T) {
	callCount := 0
	var createData map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++

		switch {
		case callCount == 1:
			// Query virtual cluster
			assert.Contains(t, r.URL.Path, "/api/kafka-virtual-clusters")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":          "vc-123",
						"application": "app-456",
					},
				},
				TotalDocs: 1,
			})

		case callCount == 2:
			// Query application
			assert.Contains(t, r.URL.Path, "/api/kafka-applications")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":        "app-456",
						"workspace": "ws-789",
					},
				},
				TotalDocs: 1,
			})

		case callCount == 3:
			// Query topic
			assert.Contains(t, r.URL.Path, "/api/kafka-topics")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":   "topic-001",
						"name": "events",
					},
				},
				TotalDocs: 1,
			})

		case callCount == 4:
			// Query lineage edge (returns empty - no existing edge)
			assert.Contains(t, r.URL.Path, "/api/kafka-lineage-edges")
			assert.Equal(t, http.MethodGet, r.Method)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})

		case callCount == 5:
			// Create new lineage edge
			assert.Contains(t, r.URL.Path, "/api/kafka-lineage-edges")
			assert.Equal(t, http.MethodPost, r.Method)
			json.NewDecoder(r.Body).Decode(&createData)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"doc": map[string]any{
					"id": "edge-new-001",
				},
			})
		}
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	result, err := activities.ProcessActivityBatch(context.Background(), ProcessActivityBatchInput{
		Records: []ClientActivityRecord{
			{
				VirtualClusterID: "vc-123",
				ServiceAccountID: "sa-001",
				TopicVirtualName: "events",
				Direction:        "produce",
				Bytes:            1024,
				MessageCount:     10,
			},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, 1, result.ProcessedCount)
	assert.Equal(t, 0, result.FailedCount)
	assert.Equal(t, 1, result.NewEdgesCount)

	// Verify created data
	assert.Equal(t, "sa-001", createData["sourceServiceAccount"])
	assert.Equal(t, "topic-001", createData["topic"])
	assert.Equal(t, "produce", createData["direction"])
	assert.Equal(t, "ws-789", createData["workspace"])
	assert.Equal(t, float64(1024), createData["bytesAllTime"])
	assert.Equal(t, float64(10), createData["messagesAllTime"])
	assert.Equal(t, true, createData["isActive"])
}

func TestProcessActivityBatch_UpdateExistingEdge(t *testing.T) {
	callCount := 0
	var updateData map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++

		switch {
		case callCount == 1:
			// Query virtual cluster
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{"id": "vc-123", "application": "app-456"},
				},
				TotalDocs: 1,
			})

		case callCount == 2:
			// Query application
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{"id": "app-456", "workspace": "ws-789"},
				},
				TotalDocs: 1,
			})

		case callCount == 3:
			// Query topic
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{"id": "topic-001", "name": "events"},
				},
				TotalDocs: 1,
			})

		case callCount == 4:
			// Query lineage edge (returns existing edge)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":              "edge-existing-001",
						"bytesAllTime":      float64(5000),
						"messagesAllTime":   float64(50),
						"bytesLast24h":    float64(1000),
						"messagesLast24h": float64(10),
					},
				},
				TotalDocs: 1,
			})

		case callCount == 5:
			// Update existing edge (uses internal API route)
			assert.Contains(t, r.URL.Path, "/api/internal/kafka-lineage-edges/edge-existing-001")
			assert.Equal(t, http.MethodPatch, r.Method)
			json.NewDecoder(r.Body).Decode(&updateData)
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	result, err := activities.ProcessActivityBatch(context.Background(), ProcessActivityBatchInput{
		Records: []ClientActivityRecord{
			{
				VirtualClusterID: "vc-123",
				ServiceAccountID: "sa-001",
				TopicVirtualName: "events",
				Direction:        "produce",
				Bytes:            2048,
				MessageCount:     20,
			},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, 1, result.ProcessedCount)
	assert.Equal(t, 0, result.FailedCount)
	assert.Equal(t, 0, result.NewEdgesCount) // No new edge, updated existing

	// Verify accumulated values
	assert.Equal(t, float64(5000+2048), updateData["bytesAllTime"])
	assert.Equal(t, float64(50+20), updateData["messagesAllTime"])
	assert.Equal(t, float64(1000+2048), updateData["bytesLast24h"])
	assert.Equal(t, float64(10+20), updateData["messagesLast24h"])
	assert.Equal(t, true, updateData["isActive"])
}

func TestProcessActivityBatch_WithConsumerGroup(t *testing.T) {
	callCount := 0
	var createData map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++

		switch {
		case callCount <= 3:
			// Queries for VC, app, topic
			w.WriteHeader(http.StatusOK)
			var docs []map[string]any
			if callCount == 1 {
				docs = []map[string]any{{"id": "vc-123", "application": "app-456"}}
			} else if callCount == 2 {
				docs = []map[string]any{{"id": "app-456", "workspace": "ws-789"}}
			} else {
				docs = []map[string]any{{"id": "topic-001", "name": "events"}}
			}
			json.NewEncoder(w).Encode(clients.PayloadResponse{Docs: docs, TotalDocs: 1})

		case callCount == 4:
			// No existing edge
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{Docs: []map[string]any{}, TotalDocs: 0})

		case callCount == 5:
			// Create edge
			json.NewDecoder(r.Body).Decode(&createData)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{"doc": map[string]any{"id": "edge-001"}})
		}
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	_, err := activities.ProcessActivityBatch(context.Background(), ProcessActivityBatchInput{
		Records: []ClientActivityRecord{
			{
				VirtualClusterID: "vc-123",
				ServiceAccountID: "sa-001",
				TopicVirtualName: "events",
				Direction:        "consume",
				ConsumerGroupID:  "cg-my-group",
				Bytes:            512,
				MessageCount:     5,
			},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "cg-my-group", createData["consumerGroup"])
	assert.Equal(t, "consume", createData["direction"])
}

func TestProcessActivityBatch_VirtualClusterNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return empty result for virtual cluster query
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(clients.PayloadResponse{
			Docs:      []map[string]any{},
			TotalDocs: 0,
		})
	}))
	defer server.Close()

	logger := slog.Default()
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewLineageActivities(payloadClient, logger)

	result, err := activities.ProcessActivityBatch(context.Background(), ProcessActivityBatchInput{
		Records: []ClientActivityRecord{
			{
				VirtualClusterID: "nonexistent-vc",
				ServiceAccountID: "sa-001",
				TopicVirtualName: "events",
				Direction:        "produce",
			},
		},
	})

	require.NoError(t, err) // Method doesn't return error, tracks failures
	assert.Equal(t, 0, result.ProcessedCount)
	assert.Equal(t, 1, result.FailedCount)
}

func TestResetStale24hMetrics(t *testing.T) {
	t.Run("resets edges with stale metrics", func(t *testing.T) {
		callCount := 0
		var updatePaths []string
		var updateData []map[string]any

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++

			if callCount == 1 {
				// Find edges with stale metrics
				assert.Contains(t, r.URL.RawQuery, "bytesLast24h")
				assert.Contains(t, r.URL.RawQuery, "messagesLast24h")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs: []map[string]any{
						{"id": "edge-1", "bytesLast24h": float64(1000)},
						{"id": "edge-2", "messagesLast24h": float64(50)},
					},
					TotalDocs: 2,
				})
			} else {
				// Update calls
				updatePaths = append(updatePaths, r.URL.Path)
				var data map[string]any
				json.NewDecoder(r.Body).Decode(&data)
				updateData = append(updateData, data)
				w.WriteHeader(http.StatusOK)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		result, err := activities.ResetStale24hMetrics(context.Background(), ResetStale24hMetricsInput{})

		require.NoError(t, err)
		assert.Equal(t, 2, result.EdgesReset)
		assert.Len(t, updatePaths, 2)

		// Verify both edges were updated
		for _, data := range updateData {
			assert.Equal(t, float64(0), data["bytesLast24h"])
			assert.Equal(t, float64(0), data["messagesLast24h"])
		}
	})

	t.Run("handles empty result", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		result, err := activities.ResetStale24hMetrics(context.Background(), ResetStale24hMetricsInput{})

		require.NoError(t, err)
		assert.Equal(t, 0, result.EdgesReset)
	})

	t.Run("returns error on query failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		_, err := activities.ResetStale24hMetrics(context.Background(), ResetStale24hMetricsInput{})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "querying edges with stale metrics")
	})
}

func TestMarkInactiveEdges(t *testing.T) {
	t.Run("marks edges as inactive", func(t *testing.T) {
		callCount := 0
		var updatePaths []string
		var updateData []map[string]any

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++

			if callCount == 1 {
				// Find inactive edges
				assert.Contains(t, r.URL.RawQuery, "isActive")
				assert.Contains(t, r.URL.RawQuery, "lastSeen")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs: []map[string]any{
						{"id": "edge-old-1"},
						{"id": "edge-old-2"},
						{"id": "edge-old-3"},
					},
					TotalDocs: 3,
				})
			} else {
				// Update calls
				updatePaths = append(updatePaths, r.URL.Path)
				var data map[string]any
				json.NewDecoder(r.Body).Decode(&data)
				updateData = append(updateData, data)
				w.WriteHeader(http.StatusOK)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		result, err := activities.MarkInactiveEdges(context.Background(), MarkInactiveEdgesInput{
			HoursThreshold: 72,
		})

		require.NoError(t, err)
		assert.Equal(t, 3, result.EdgesMarked)

		// Verify all edges were marked inactive
		for _, data := range updateData {
			assert.Equal(t, false, data["isActive"])
		}
	})

	t.Run("handles empty result", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		result, err := activities.MarkInactiveEdges(context.Background(), MarkInactiveEdgesInput{
			HoursThreshold: 24,
		})

		require.NoError(t, err)
		assert.Equal(t, 0, result.EdgesMarked)
	})

	t.Run("returns error on query failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		_, err := activities.MarkInactiveEdges(context.Background(), MarkInactiveEdgesInput{
			HoursThreshold: 24,
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "querying inactive edges")
	})
}

func TestCreateDailySnapshots(t *testing.T) {
	t.Run("creates snapshots for active topics", func(t *testing.T) {
		callCount := 0
		var snapshotData map[string]any

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++

			if callCount == 1 {
				// Find active edges
				assert.Equal(t, http.MethodGet, r.Method)
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs: []map[string]any{
						{
							"id":                   "edge-1",
							"topic":                "topic-001",
							"workspace":            "ws-001",
							"direction":            "produce",
							"sourceServiceAccount": "sa-producer",
							"bytesAllTime":           float64(10000),
							"messagesAllTime":        float64(100),
						},
						{
							"id":                   "edge-2",
							"topic":                "topic-001",
							"workspace":            "ws-001",
							"direction":            "consume",
							"sourceServiceAccount": "sa-consumer",
							"consumerGroup":        "cg-001",
							"bytesAllTime":           float64(8000),
							"messagesAllTime":        float64(80),
						},
					},
					TotalDocs: 2,
				})
			} else {
				// Create snapshot
				assert.Equal(t, http.MethodPost, r.Method)
				assert.True(t, strings.Contains(r.URL.Path, "kafka-lineage-snapshots"))
				json.NewDecoder(r.Body).Decode(&snapshotData)
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(map[string]any{
					"doc": map[string]any{"id": "snapshot-001"},
				})
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		result, err := activities.CreateDailySnapshots(context.Background(), CreateDailySnapshotsInput{
			Date: "2025-01-14",
		})

		require.NoError(t, err)
		assert.Equal(t, 1, result.SnapshotsCreated)

		// Verify snapshot data
		assert.Equal(t, "topic-001", snapshotData["topic"])
		assert.Equal(t, "2025-01-14", snapshotData["snapshotDate"])
		assert.Equal(t, "ws-001", snapshotData["workspace"])
		assert.Equal(t, float64(10000), snapshotData["totalBytesIn"])
		assert.Equal(t, float64(8000), snapshotData["totalBytesOut"])
		assert.Equal(t, float64(100), snapshotData["totalMessagesIn"])
		assert.Equal(t, float64(80), snapshotData["totalMessagesOut"])
		assert.Equal(t, float64(1), snapshotData["producerCount"])
		assert.Equal(t, float64(1), snapshotData["consumerCount"])

		producers := snapshotData["producers"].([]any)
		assert.Len(t, producers, 1)
		producer := producers[0].(map[string]any)
		assert.Equal(t, "sa-producer", producer["serviceAccountId"])

		consumers := snapshotData["consumers"].([]any)
		assert.Len(t, consumers, 1)
		consumer := consumers[0].(map[string]any)
		assert.Equal(t, "sa-consumer", consumer["serviceAccountId"])
		assert.Equal(t, "cg-001", consumer["consumerGroupId"])
	})

	t.Run("handles no active edges", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		result, err := activities.CreateDailySnapshots(context.Background(), CreateDailySnapshotsInput{
			Date: "2025-01-14",
		})

		require.NoError(t, err)
		assert.Equal(t, 0, result.SnapshotsCreated)
	})

	t.Run("creates multiple snapshots for multiple topics", func(t *testing.T) {
		callCount := 0
		snapshotsCreated := 0

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++

			if callCount == 1 {
				// Find active edges for 2 topics
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs: []map[string]any{
						{
							"id":                   "edge-1",
							"topic":                "topic-001",
							"workspace":            "ws-001",
							"direction":            "produce",
							"sourceServiceAccount": "sa-1",
							"bytesAllTime":           float64(1000),
							"messagesAllTime":        float64(10),
						},
						{
							"id":                   "edge-2",
							"topic":                "topic-002",
							"workspace":            "ws-001",
							"direction":            "consume",
							"sourceServiceAccount": "sa-2",
							"bytesAllTime":           float64(2000),
							"messagesAllTime":        float64(20),
						},
					},
					TotalDocs: 2,
				})
			} else {
				// Create snapshots
				snapshotsCreated++
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(map[string]any{
					"doc": map[string]any{"id": "snapshot-" + string(rune('0'+snapshotsCreated))},
				})
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		result, err := activities.CreateDailySnapshots(context.Background(), CreateDailySnapshotsInput{
			Date: "2025-01-14",
		})

		require.NoError(t, err)
		assert.Equal(t, 2, result.SnapshotsCreated)
	})

	t.Run("returns error on query failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewLineageActivities(payloadClient, logger)

		_, err := activities.CreateDailySnapshots(context.Background(), CreateDailySnapshotsInput{
			Date: "2025-01-14",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "querying active edges")
	})
}

func TestExtractRelationID(t *testing.T) {
	tests := []struct {
		name     string
		doc      map[string]any
		field    string
		expected string
	}{
		{
			name:     "string ID",
			doc:      map[string]any{"application": "app-123"},
			field:    "application",
			expected: "app-123",
		},
		{
			name:     "populated object",
			doc:      map[string]any{"application": map[string]any{"id": "app-456", "name": "My App"}},
			field:    "application",
			expected: "app-456",
		},
		{
			name:     "nil value",
			doc:      map[string]any{"application": nil},
			field:    "application",
			expected: "",
		},
		{
			name:     "missing field",
			doc:      map[string]any{},
			field:    "application",
			expected: "",
		},
		{
			name:     "invalid type",
			doc:      map[string]any{"application": 123},
			field:    "application",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractRelationID(tt.doc, tt.field)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestGetIntValue(t *testing.T) {
	tests := []struct {
		name     string
		doc      map[string]any
		field    string
		expected int64
	}{
		{
			name:     "float64 value",
			doc:      map[string]any{"count": float64(1000)},
			field:    "count",
			expected: 1000,
		},
		{
			name:     "int value",
			doc:      map[string]any{"count": 500},
			field:    "count",
			expected: 500,
		},
		{
			name:     "int64 value",
			doc:      map[string]any{"count": int64(750)},
			field:    "count",
			expected: 750,
		},
		{
			name:     "nil value",
			doc:      map[string]any{"count": nil},
			field:    "count",
			expected: 0,
		},
		{
			name:     "missing field",
			doc:      map[string]any{},
			field:    "count",
			expected: 0,
		},
		{
			name:     "string value",
			doc:      map[string]any{"count": "not a number"},
			field:    "count",
			expected: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getIntValue(tt.doc, tt.field)
			assert.Equal(t, tt.expected, result)
		})
	}
}
