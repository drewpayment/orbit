package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

// PayloadClient provides HTTP access to the Payload CMS REST API.
type PayloadClient struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	logger     *slog.Logger
}

// PayloadResponse represents a paginated response from Payload CMS.
type PayloadResponse struct {
	Docs          []map[string]any `json:"docs"`
	TotalDocs     int              `json:"totalDocs"`
	Limit         int              `json:"limit"`
	TotalPages    int              `json:"totalPages"`
	Page          int              `json:"page"`
	PagingCounter int              `json:"pagingCounter"`
	HasPrevPage   bool             `json:"hasPrevPage"`
	HasNextPage   bool             `json:"hasNextPage"`
	PrevPage      *int             `json:"prevPage"`
	NextPage      *int             `json:"nextPage"`
}

// NewPayloadClient creates a new Payload CMS HTTP client.
func NewPayloadClient(baseURL, apiKey string, logger *slog.Logger) *PayloadClient {
	return &PayloadClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger: logger,
	}
}

// Get retrieves a single document by ID from a collection.
func (c *PayloadClient) Get(ctx context.Context, collection string, id string) (map[string]any, error) {
	url := fmt.Sprintf("%s/api/%s/%s", c.baseURL, collection, id)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	c.addHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("document not found: %s/%s", collection, id)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return result, nil
}

// Find queries a collection with the given parameters.
// Use BuildQuery to construct the query parameters.
func (c *PayloadClient) Find(ctx context.Context, collection string, query url.Values) ([]map[string]any, error) {
	reqURL := fmt.Sprintf("%s/api/%s", c.baseURL, collection)
	if len(query) > 0 {
		reqURL = fmt.Sprintf("%s?%s", reqURL, query.Encode())
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	c.addHeaders(req)

	c.logger.Debug("payload find request",
		slog.String("collection", collection),
		slog.String("url", reqURL),
	)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var result PayloadResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	c.logger.Debug("payload find response",
		slog.String("collection", collection),
		slog.Int("totalDocs", result.TotalDocs),
		slog.Int("returned", len(result.Docs)),
	)

	return result.Docs, nil
}

// FindOne queries a collection and returns the first matching document.
func (c *PayloadClient) FindOne(ctx context.Context, collection string, query url.Values) (map[string]any, error) {
	query.Set("limit", "1")
	docs, err := c.Find(ctx, collection, query)
	if err != nil {
		return nil, err
	}
	if len(docs) == 0 {
		return nil, nil
	}
	return docs[0], nil
}

// Create creates a new document in a collection.
func (c *PayloadClient) Create(ctx context.Context, collection string, data map[string]any) (map[string]any, error) {
	url := fmt.Sprintf("%s/api/%s", c.baseURL, collection)

	body, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshaling data: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	c.addHeaders(req)
	req.Header.Set("Content-Type", "application/json")

	c.logger.Debug("payload create request",
		slog.String("collection", collection),
		slog.String("data", string(body)),
	)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	// Payload wraps created docs in a "doc" field
	if doc, ok := result["doc"].(map[string]any); ok {
		return doc, nil
	}

	return result, nil
}

// Update updates an existing document in a collection.
// For kafka-topics, uses the internal API route that bypasses access control.
func (c *PayloadClient) Update(ctx context.Context, collection string, id string, data map[string]any) error {
	// Use internal API route for collections that need elevated access
	var reqURL string
	switch collection {
	case "kafka-topics", "kafka-virtual-clusters", "kafka-schemas", "kafka-topic-shares", "kafka-lineage-edges":
		reqURL = fmt.Sprintf("%s/api/internal/%s/%s", c.baseURL, collection, id)
	default:
		reqURL = fmt.Sprintf("%s/api/%s/%s", c.baseURL, collection, id)
	}

	body, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshaling data: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, reqURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}

	c.addHeaders(req)
	req.Header.Set("Content-Type", "application/json")

	c.logger.Debug("payload update request",
		slog.String("collection", collection),
		slog.String("id", id),
		slog.String("url", reqURL),
		slog.String("data", string(body)),
	)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// Delete removes a document from a collection.
// For kafka collections, uses the internal API route that bypasses access control.
func (c *PayloadClient) Delete(ctx context.Context, collection string, id string) error {
	// Use internal API route for collections that need elevated access
	var reqURL string
	switch collection {
	case "kafka-topics", "kafka-virtual-clusters", "kafka-schemas", "kafka-topic-shares", "kafka-lineage-edges":
		reqURL = fmt.Sprintf("%s/api/internal/%s/%s", c.baseURL, collection, id)
	default:
		reqURL = fmt.Sprintf("%s/api/%s/%s", c.baseURL, collection, id)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, reqURL, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}

	c.addHeaders(req)

	c.logger.Debug("payload delete request",
		slog.String("collection", collection),
		slog.String("id", id),
		slog.String("url", reqURL),
	)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// addHeaders adds common headers to a request.
func (c *PayloadClient) addHeaders(req *http.Request) {
	if c.apiKey != "" {
		// Use X-API-Key header for internal API authentication
		req.Header.Set("X-API-Key", c.apiKey)
	}
	req.Header.Set("Accept", "application/json")
}

// QueryBuilder helps construct Payload query parameters.
type QueryBuilder struct {
	values url.Values
}

// NewQueryBuilder creates a new query builder.
func NewQueryBuilder() *QueryBuilder {
	return &QueryBuilder{
		values: make(url.Values),
	}
}

// WhereEquals adds an equals condition.
func (q *QueryBuilder) WhereEquals(field string, value string) *QueryBuilder {
	q.values.Set(fmt.Sprintf("where[%s][equals]", field), value)
	return q
}

// WhereIn adds an "in" condition for multiple values.
func (q *QueryBuilder) WhereIn(field string, values []string) *QueryBuilder {
	for i, v := range values {
		q.values.Add(fmt.Sprintf("where[%s][in][%d]", field, i), v)
	}
	return q
}

// WhereExists adds an exists condition.
func (q *QueryBuilder) WhereExists(field string, exists bool) *QueryBuilder {
	q.values.Set(fmt.Sprintf("where[%s][exists]", field), fmt.Sprintf("%t", exists))
	return q
}

// Limit sets the maximum number of results.
func (q *QueryBuilder) Limit(limit int) *QueryBuilder {
	q.values.Set("limit", fmt.Sprintf("%d", limit))
	return q
}

// Page sets the page number for pagination.
func (q *QueryBuilder) Page(page int) *QueryBuilder {
	q.values.Set("page", fmt.Sprintf("%d", page))
	return q
}

// Sort sets the sort field and direction.
func (q *QueryBuilder) Sort(field string, descending bool) *QueryBuilder {
	if descending {
		q.values.Set("sort", "-"+field)
	} else {
		q.values.Set("sort", field)
	}
	return q
}

// Depth sets the depth for relationship population.
func (q *QueryBuilder) Depth(depth int) *QueryBuilder {
	q.values.Set("depth", fmt.Sprintf("%d", depth))
	return q
}

// Build returns the constructed query parameters.
func (q *QueryBuilder) Build() url.Values {
	return q.values
}
