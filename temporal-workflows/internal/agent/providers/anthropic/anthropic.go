// Package anthropic implements the Anthropic Messages API as a providers.Provider.
// It speaks the streaming SSE flavor of /v1/messages and translates the wire
// events into provider.Delta callbacks.
package anthropic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

const (
	defaultBaseURL = "https://api.anthropic.com"
	apiVersion     = "2023-06-01"
)

func init() {
	providers.Register("anthropic", func(cfg providers.Config) (providers.Provider, error) {
		return New(cfg)
	})
}

// Provider talks to the Anthropic Messages API.
type Provider struct {
	cfg    providers.Config
	client *http.Client
}

// New constructs a Provider. APIKey is required; BaseURL and Model fall back to
// sensible defaults when empty.
func New(cfg providers.Config) (*Provider, error) {
	if cfg.APIKey == "" {
		return nil, errors.New("anthropic: APIKey is required")
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultBaseURL
	}
	if cfg.Model == "" {
		cfg.Model = "claude-opus-4-7"
	}
	return &Provider{
		cfg:    cfg,
		client: &http.Client{Timeout: 0}, // streaming: no overall timeout
	}, nil
}

// Name returns the registry name.
func (p *Provider) Name() string { return "anthropic" }

// --- wire types ---

type wireMessage struct {
	Role    string         `json:"role"`
	Content []wireContent  `json:"content,omitempty"`
}

type wireContent struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   string          `json:"content,omitempty"`
}

type wireTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

type wireRequest struct {
	Model       string        `json:"model"`
	System      string        `json:"system,omitempty"`
	Messages    []wireMessage `json:"messages"`
	Tools       []wireTool    `json:"tools,omitempty"`
	MaxTokens   int           `json:"max_tokens"`
	Temperature *float64      `json:"temperature,omitempty"`
	Stream      bool          `json:"stream"`
}

// StreamComplete implements providers.Provider.
func (p *Provider) StreamComplete(ctx context.Context, req providers.CompletionRequest, onDelta func(providers.Delta) error) (providers.Response, error) {
	body, err := buildRequest(p.cfg.Model, req)
	if err != nil {
		return providers.Response{}, err
	}

	url := strings.TrimRight(p.cfg.BaseURL, "/") + "/v1/messages"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return providers.Response{}, fmt.Errorf("anthropic: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("x-api-key", p.cfg.APIKey)
	httpReq.Header.Set("anthropic-version", apiVersion)

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return providers.Response{}, fmt.Errorf("anthropic: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return providers.Response{}, &APIError{StatusCode: resp.StatusCode, Body: string(errBody)}
	}

	return parseStream(resp.Body, onDelta)
}

// APIError is returned when Anthropic responds with a non-2xx status.
type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("anthropic: HTTP %d: %s", e.StatusCode, e.Body)
}

// Retryable indicates whether the activity should retry. 4xx (except 429) are
// non-retryable; 5xx and 429 are retryable.
func (e *APIError) Retryable() bool {
	if e.StatusCode == http.StatusTooManyRequests {
		return true
	}
	return e.StatusCode >= 500
}

func buildRequest(model string, req providers.CompletionRequest) ([]byte, error) {
	out := wireRequest{
		Model:     model,
		System:    req.System,
		Messages:  toWireMessages(req.Messages),
		Tools:     toWireTools(req.Tools),
		MaxTokens: req.MaxTokens,
		Stream:    true,
	}
	if out.MaxTokens == 0 {
		out.MaxTokens = 4096
	}
	if req.Temperature > 0 {
		t := req.Temperature
		out.Temperature = &t
	}
	return json.Marshal(out)
}

func toWireMessages(msgs []providers.Message) []wireMessage {
	out := make([]wireMessage, 0, len(msgs))
	for _, m := range msgs {
		switch m.Role {
		case providers.RoleSystem:
			// System lifted to top-level wireRequest.System; skip here.
			continue
		case providers.RoleUser:
			out = append(out, wireMessage{
				Role:    "user",
				Content: []wireContent{{Type: "text", Text: m.Content}},
			})
		case providers.RoleAssistant:
			content := []wireContent{}
			if m.Content != "" {
				content = append(content, wireContent{Type: "text", Text: m.Content})
			}
			for _, tc := range m.ToolCalls {
				input, _ := json.Marshal(tc.Arguments)
				content = append(content, wireContent{
					Type:  "tool_use",
					ID:    tc.ID,
					Name:  tc.Name,
					Input: input,
				})
			}
			out = append(out, wireMessage{Role: "assistant", Content: content})
		case providers.RoleTool:
			out = append(out, wireMessage{
				Role: "user",
				Content: []wireContent{{
					Type:      "tool_result",
					ToolUseID: m.ToolCallID,
					Content:   m.Content,
				}},
			})
		}
	}
	return out
}

func toWireTools(tools []providers.ToolSchema) []wireTool {
	out := make([]wireTool, 0, len(tools))
	for _, t := range tools {
		out = append(out, wireTool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}
	return out
}

// --- SSE parsing ---

type sseEvent struct {
	Event string
	Data  []byte
}

// parseStream reads the SSE response, fires onDelta for each meaningful update,
// and assembles a final providers.Response.
func parseStream(r io.Reader, onDelta func(providers.Delta) error) (providers.Response, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)

	var (
		resp        providers.Response
		eventName   string
		dataBuf     bytes.Buffer
		blocks      = map[int]*assembledBlock{}
		assistantTx strings.Builder
	)

	flush := func() error {
		if dataBuf.Len() == 0 && eventName == "" {
			return nil
		}
		ev := sseEvent{Event: eventName, Data: append([]byte(nil), dataBuf.Bytes()...)}
		dataBuf.Reset()
		eventName = ""
		return handleEvent(ev, blocks, &resp, &assistantTx, onDelta)
	}

	deadline := time.Now().Add(15 * time.Minute)
	for scanner.Scan() {
		if time.Now().After(deadline) {
			return resp, errors.New("anthropic: stream exceeded 15 minute deadline")
		}
		line := scanner.Bytes()
		switch {
		case len(line) == 0:
			if err := flush(); err != nil {
				return resp, err
			}
		case bytes.HasPrefix(line, []byte("event:")):
			eventName = strings.TrimSpace(string(line[len("event:"):]))
		case bytes.HasPrefix(line, []byte("data:")):
			if dataBuf.Len() > 0 {
				dataBuf.WriteByte('\n')
			}
			dataBuf.Write(bytes.TrimSpace(line[len("data:"):]))
		}
	}
	if err := scanner.Err(); err != nil {
		return resp, fmt.Errorf("anthropic: stream scan: %w", err)
	}
	// Final flush in case the stream ended without a trailing blank line.
	if err := flush(); err != nil {
		return resp, err
	}

	resp.Text = assistantTx.String()
	return resp, nil
}

type assembledBlock struct {
	Type    string
	Text    strings.Builder
	ToolID  string
	ToolNm  string
	JSONBuf strings.Builder
}

func handleEvent(ev sseEvent, blocks map[int]*assembledBlock, resp *providers.Response, assistantTx *strings.Builder, onDelta func(providers.Delta) error) error {
	if len(ev.Data) == 0 {
		return nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(ev.Data, &raw); err != nil {
		return nil // ignore malformed events; provider sometimes sends pings
	}

	switch ev.Event {
	case "content_block_start":
		var b struct {
			Index        int             `json:"index"`
			ContentBlock json.RawMessage `json:"content_block"`
		}
		if err := json.Unmarshal(ev.Data, &b); err != nil {
			return nil
		}
		var cb struct {
			Type string `json:"type"`
			ID   string `json:"id,omitempty"`
			Name string `json:"name,omitempty"`
		}
		_ = json.Unmarshal(b.ContentBlock, &cb)
		blocks[b.Index] = &assembledBlock{Type: cb.Type, ToolID: cb.ID, ToolNm: cb.Name}
		if cb.Type == "tool_use" {
			return onDelta(providers.Delta{
				Kind:     providers.DeltaToolCallStart,
				ToolID:   cb.ID,
				ToolName: cb.Name,
			})
		}

	case "content_block_delta":
		var b struct {
			Index int `json:"index"`
			Delta struct {
				Type        string `json:"type"`
				Text        string `json:"text,omitempty"`
				PartialJSON string `json:"partial_json,omitempty"`
			} `json:"delta"`
		}
		if err := json.Unmarshal(ev.Data, &b); err != nil {
			return nil
		}
		blk := blocks[b.Index]
		if blk == nil {
			return nil
		}
		switch b.Delta.Type {
		case "text_delta":
			blk.Text.WriteString(b.Delta.Text)
			assistantTx.WriteString(b.Delta.Text)
			return onDelta(providers.Delta{Kind: providers.DeltaText, Text: b.Delta.Text})
		case "input_json_delta":
			blk.JSONBuf.WriteString(b.Delta.PartialJSON)
			return onDelta(providers.Delta{
				Kind:        providers.DeltaToolCallArgs,
				ToolID:      blk.ToolID,
				PartialJSON: b.Delta.PartialJSON,
			})
		}

	case "content_block_stop":
		var b struct {
			Index int `json:"index"`
		}
		if err := json.Unmarshal(ev.Data, &b); err != nil {
			return nil
		}
		blk := blocks[b.Index]
		if blk == nil {
			return nil
		}
		if blk.Type == "tool_use" {
			args := map[string]any{}
			if blk.JSONBuf.Len() > 0 {
				_ = json.Unmarshal([]byte(blk.JSONBuf.String()), &args)
			}
			resp.ToolCalls = append(resp.ToolCalls, providers.ToolCall{
				ID:        blk.ToolID,
				Name:      blk.ToolNm,
				Arguments: args,
			})
			if err := onDelta(providers.Delta{
				Kind:     providers.DeltaToolCallEnd,
				ToolID:   blk.ToolID,
				ToolName: blk.ToolNm,
			}); err != nil {
				return err
			}
		}

	case "message_delta":
		var b struct {
			Delta struct {
				StopReason string `json:"stop_reason,omitempty"`
			} `json:"delta"`
			Usage struct {
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal(ev.Data, &b); err == nil {
			if b.Delta.StopReason != "" {
				resp.StopReason = b.Delta.StopReason
			}
			if b.Usage.OutputTokens > 0 {
				resp.Usage.OutputTokens = b.Usage.OutputTokens
			}
		}

	case "message_start":
		var b struct {
			Message struct {
				Usage struct {
					InputTokens int `json:"input_tokens"`
				} `json:"usage"`
			} `json:"message"`
		}
		if err := json.Unmarshal(ev.Data, &b); err == nil {
			resp.Usage.InputTokens = b.Message.Usage.InputTokens
		}

	case "message_stop":
		return onDelta(providers.Delta{Kind: providers.DeltaStop, StopReason: resp.StopReason})

	case "error":
		var b struct {
			Error struct {
				Type    string `json:"type"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(ev.Data, &b)
		return fmt.Errorf("anthropic: stream error: %s: %s", b.Error.Type, b.Error.Message)
	}

	return nil
}
