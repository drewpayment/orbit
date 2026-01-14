package clients

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"log/slog"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewPayloadClient(t *testing.T) {
	logger := slog.Default()
	client := NewPayloadClient("http://localhost:3000", "test-api-key", logger)

	assert.NotNil(t, client)
	assert.Equal(t, "http://localhost:3000", client.baseURL)
	assert.Equal(t, "test-api-key", client.apiKey)
	assert.NotNil(t, client.httpClient)
	assert.NotNil(t, client.logger)
}

func TestPayloadClient_Get(t *testing.T) {
	tests := []struct {
		name           string
		collection     string
		id             string
		responseStatus int
		responseBody   map[string]any
		expectError    bool
		errorContains  string
	}{
		{
			name:           "successful get",
			collection:     "kafka-topics",
			id:             "topic-123",
			responseStatus: http.StatusOK,
			responseBody: map[string]any{
				"id":     "topic-123",
				"name":   "my-topic",
				"status": "active",
			},
			expectError: false,
		},
		{
			name:           "not found",
			collection:     "kafka-topics",
			id:             "nonexistent",
			responseStatus: http.StatusNotFound,
			responseBody:   nil,
			expectError:    true,
			errorContains:  "document not found",
		},
		{
			name:           "server error",
			collection:     "kafka-topics",
			id:             "topic-123",
			responseStatus: http.StatusInternalServerError,
			responseBody:   nil,
			expectError:    true,
			errorContains:  "unexpected status 500",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodGet, r.Method)
				assert.Contains(t, r.URL.Path, "/api/"+tt.collection+"/"+tt.id)
				assert.Equal(t, "users API-Key test-api-key", r.Header.Get("Authorization"))
				assert.Equal(t, "application/json", r.Header.Get("Accept"))

				w.WriteHeader(tt.responseStatus)
				if tt.responseBody != nil {
					json.NewEncoder(w).Encode(tt.responseBody)
				}
			}))
			defer server.Close()

			logger := slog.Default()
			client := NewPayloadClient(server.URL, "test-api-key", logger)

			result, err := client.Get(context.Background(), tt.collection, tt.id)

			if tt.expectError {
				assert.Error(t, err)
				if tt.errorContains != "" {
					assert.Contains(t, err.Error(), tt.errorContains)
				}
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.responseBody["id"], result["id"])
				assert.Equal(t, tt.responseBody["name"], result["name"])
			}
		})
	}
}

func TestPayloadClient_Find(t *testing.T) {
	tests := []struct {
		name           string
		collection     string
		query          url.Values
		responseStatus int
		responseBody   PayloadResponse
		expectError    bool
	}{
		{
			name:       "successful find with results",
			collection: "kafka-topics",
			query: url.Values{
				"where[status][equals]": []string{"active"},
			},
			responseStatus: http.StatusOK,
			responseBody: PayloadResponse{
				Docs: []map[string]any{
					{"id": "topic-1", "name": "topic-one"},
					{"id": "topic-2", "name": "topic-two"},
				},
				TotalDocs: 2,
			},
			expectError: false,
		},
		{
			name:           "successful find with no results",
			collection:     "kafka-topics",
			query:          url.Values{},
			responseStatus: http.StatusOK,
			responseBody: PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			},
			expectError: false,
		},
		{
			name:           "server error",
			collection:     "kafka-topics",
			query:          url.Values{},
			responseStatus: http.StatusInternalServerError,
			expectError:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodGet, r.Method)
				assert.Contains(t, r.URL.Path, "/api/"+tt.collection)

				w.WriteHeader(tt.responseStatus)
				if tt.responseStatus == http.StatusOK {
					json.NewEncoder(w).Encode(tt.responseBody)
				}
			}))
			defer server.Close()

			logger := slog.Default()
			client := NewPayloadClient(server.URL, "test-api-key", logger)

			result, err := client.Find(context.Background(), tt.collection, tt.query)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Len(t, result, len(tt.responseBody.Docs))
			}
		})
	}
}

func TestPayloadClient_FindOne(t *testing.T) {
	t.Run("returns first document", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Verify limit=1 is set
			assert.Equal(t, "1", r.URL.Query().Get("limit"))

			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(PayloadResponse{
				Docs: []map[string]any{
					{"id": "topic-1", "name": "first-topic"},
				},
				TotalDocs: 1,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		client := NewPayloadClient(server.URL, "test-api-key", logger)

		query := NewQueryBuilder().WhereEquals("status", "active").Build()
		result, err := client.FindOne(context.Background(), "kafka-topics", query)

		require.NoError(t, err)
		assert.Equal(t, "topic-1", result["id"])
	})

	t.Run("returns nil when no results", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		client := NewPayloadClient(server.URL, "test-api-key", logger)

		result, err := client.FindOne(context.Background(), "kafka-topics", url.Values{})

		require.NoError(t, err)
		assert.Nil(t, result)
	})
}

func TestPayloadClient_Create(t *testing.T) {
	tests := []struct {
		name           string
		collection     string
		data           map[string]any
		responseStatus int
		responseBody   map[string]any
		expectError    bool
	}{
		{
			name:       "successful create with doc wrapper",
			collection: "kafka-topics",
			data: map[string]any{
				"name":   "new-topic",
				"status": "provisioning",
			},
			responseStatus: http.StatusCreated,
			responseBody: map[string]any{
				"doc": map[string]any{
					"id":     "topic-new",
					"name":   "new-topic",
					"status": "provisioning",
				},
			},
			expectError: false,
		},
		{
			name:       "successful create without doc wrapper",
			collection: "kafka-topics",
			data: map[string]any{
				"name": "new-topic",
			},
			responseStatus: http.StatusOK,
			responseBody: map[string]any{
				"id":   "topic-new",
				"name": "new-topic",
			},
			expectError: false,
		},
		{
			name:           "server error",
			collection:     "kafka-topics",
			data:           map[string]any{"name": "test"},
			responseStatus: http.StatusBadRequest,
			expectError:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Contains(t, r.URL.Path, "/api/"+tt.collection)
				assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

				w.WriteHeader(tt.responseStatus)
				if tt.responseBody != nil {
					json.NewEncoder(w).Encode(tt.responseBody)
				}
			}))
			defer server.Close()

			logger := slog.Default()
			client := NewPayloadClient(server.URL, "test-api-key", logger)

			result, err := client.Create(context.Background(), tt.collection, tt.data)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.NotNil(t, result)
				// Check that we get the unwrapped doc
				assert.NotNil(t, result["id"])
			}
		})
	}
}

func TestPayloadClient_Update(t *testing.T) {
	tests := []struct {
		name           string
		collection     string
		id             string
		data           map[string]any
		responseStatus int
		expectError    bool
	}{
		{
			name:       "successful update",
			collection: "kafka-topics",
			id:         "topic-123",
			data: map[string]any{
				"status": "active",
			},
			responseStatus: http.StatusOK,
			expectError:    false,
		},
		{
			name:           "not found",
			collection:     "kafka-topics",
			id:             "nonexistent",
			data:           map[string]any{"status": "active"},
			responseStatus: http.StatusNotFound,
			expectError:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPatch, r.Method)
				assert.Contains(t, r.URL.Path, "/api/"+tt.collection+"/"+tt.id)

				w.WriteHeader(tt.responseStatus)
			}))
			defer server.Close()

			logger := slog.Default()
			client := NewPayloadClient(server.URL, "test-api-key", logger)

			err := client.Update(context.Background(), tt.collection, tt.id, tt.data)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestPayloadClient_Delete(t *testing.T) {
	tests := []struct {
		name           string
		collection     string
		id             string
		responseStatus int
		expectError    bool
	}{
		{
			name:           "successful delete with 200",
			collection:     "kafka-topics",
			id:             "topic-123",
			responseStatus: http.StatusOK,
			expectError:    false,
		},
		{
			name:           "successful delete with 204",
			collection:     "kafka-topics",
			id:             "topic-123",
			responseStatus: http.StatusNoContent,
			expectError:    false,
		},
		{
			name:           "server error",
			collection:     "kafka-topics",
			id:             "topic-123",
			responseStatus: http.StatusInternalServerError,
			expectError:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodDelete, r.Method)
				assert.Contains(t, r.URL.Path, "/api/"+tt.collection+"/"+tt.id)

				w.WriteHeader(tt.responseStatus)
			}))
			defer server.Close()

			logger := slog.Default()
			client := NewPayloadClient(server.URL, "test-api-key", logger)

			err := client.Delete(context.Background(), tt.collection, tt.id)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestQueryBuilder(t *testing.T) {
	t.Run("WhereEquals", func(t *testing.T) {
		query := NewQueryBuilder().
			WhereEquals("status", "active").
			Build()

		assert.Equal(t, "active", query.Get("where[status][equals]"))
	})

	t.Run("WhereIn", func(t *testing.T) {
		query := NewQueryBuilder().
			WhereIn("id", []string{"a", "b", "c"}).
			Build()

		assert.Equal(t, "a", query.Get("where[id][in][0]"))
		assert.Equal(t, "b", query.Get("where[id][in][1]"))
		assert.Equal(t, "c", query.Get("where[id][in][2]"))
	})

	t.Run("WhereExists", func(t *testing.T) {
		query := NewQueryBuilder().
			WhereExists("deletedAt", false).
			Build()

		assert.Equal(t, "false", query.Get("where[deletedAt][exists]"))
	})

	t.Run("Limit", func(t *testing.T) {
		query := NewQueryBuilder().
			Limit(10).
			Build()

		assert.Equal(t, "10", query.Get("limit"))
	})

	t.Run("Page", func(t *testing.T) {
		query := NewQueryBuilder().
			Page(2).
			Build()

		assert.Equal(t, "2", query.Get("page"))
	})

	t.Run("Sort ascending", func(t *testing.T) {
		query := NewQueryBuilder().
			Sort("createdAt", false).
			Build()

		assert.Equal(t, "createdAt", query.Get("sort"))
	})

	t.Run("Sort descending", func(t *testing.T) {
		query := NewQueryBuilder().
			Sort("createdAt", true).
			Build()

		assert.Equal(t, "-createdAt", query.Get("sort"))
	})

	t.Run("Depth", func(t *testing.T) {
		query := NewQueryBuilder().
			Depth(2).
			Build()

		assert.Equal(t, "2", query.Get("depth"))
	})

	t.Run("chained methods", func(t *testing.T) {
		query := NewQueryBuilder().
			WhereEquals("status", "active").
			WhereEquals("environment", "prod").
			Limit(10).
			Page(1).
			Sort("createdAt", true).
			Depth(1).
			Build()

		assert.Equal(t, "active", query.Get("where[status][equals]"))
		assert.Equal(t, "prod", query.Get("where[environment][equals]"))
		assert.Equal(t, "10", query.Get("limit"))
		assert.Equal(t, "1", query.Get("page"))
		assert.Equal(t, "-createdAt", query.Get("sort"))
		assert.Equal(t, "1", query.Get("depth"))
	})
}

func TestPayloadClient_NoAPIKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// When no API key, Authorization header should not be set
		assert.Empty(t, r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"id": "test"})
	}))
	defer server.Close()

	logger := slog.Default()
	client := NewPayloadClient(server.URL, "", logger) // Empty API key

	result, err := client.Get(context.Background(), "test", "123")
	require.NoError(t, err)
	assert.NotNil(t, result)
}
