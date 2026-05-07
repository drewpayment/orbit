// Package openai_compat implements the OpenAI Chat Completions API as a
// providers.Provider. It speaks the streaming SSE flavor of
// /v1/chat/completions and works against any OpenAI-compatible backend
// (OpenAI itself, LM Studio, Ollama, vLLM, etc.) by varying BaseURL.
package openai_compat

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

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

const defaultBaseURL = "https://api.openai.com"

func init() {
	providers.Register("openai_compat", func(cfg providers.Config) (providers.Provider, error) {
		return New(cfg)
	})
}

// Provider talks to any OpenAI-compatible chat completions endpoint.
type Provider struct {
	cfg    providers.Config
	client *http.Client
}

// New constructs a Provider. When BaseURL is empty it defaults to OpenAI's
// hosted API. Some self-hosted backends (Ollama, LM Studio) accept a blank
// APIKey; we forward whatever the caller passes.
func New(cfg providers.Config) (*Provider, error) {
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultBaseURL
	}
	if cfg.Model == "" {
		return nil, errors.New("openai_compat: Model is required")
	}
	return &Provider{
		cfg:    cfg,
		client: &http.Client{Timeout: 0},
	}, nil
}

// Name returns the registry name.
func (p *Provider) Name() string { return "openai_compat" }

// --- wire types ---

type wireToolFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type wireTool struct {
	Type     string           `json:"type"` // always "function"
	Function wireToolFunction `json:"function"`
}

type wireToolCallFn struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type wireToolCall struct {
	Index    int            `json:"index,omitempty"`
	ID       string         `json:"id,omitempty"`
	Type     string         `json:"type,omitempty"`
	Function wireToolCallFn `json:"function,omitempty"`
}

type wireMessage struct {
	Role       string         `json:"role"`
	Content    string         `json:"content,omitempty"`
	ToolCalls  []wireToolCall `json:"tool_calls,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
	Name       string         `json:"name,omitempty"`
}

type wireRequest struct {
	Model         string        `json:"model"`
	Messages      []wireMessage `json:"messages"`
	Tools         []wireTool    `json:"tools,omitempty"`
	ToolChoice    string        `json:"tool_choice,omitempty"`
	MaxTokens     int           `json:"max_tokens,omitempty"`
	Temperature   *float64      `json:"temperature,omitempty"`
	Stream        bool          `json:"stream"`
	StreamOptions *struct {
		IncludeUsage bool `json:"include_usage"`
	} `json:"stream_options,omitempty"`
}

// StreamComplete implements providers.Provider.
func (p *Provider) StreamComplete(ctx context.Context, req providers.CompletionRequest, onDelta func(providers.Delta) error) (providers.Response, error) {
	body, err := buildRequest(p.cfg.Model, req)
	if err != nil {
		return providers.Response{}, err
	}

	url := strings.TrimRight(p.cfg.BaseURL, "/") + "/v1/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return providers.Response{}, fmt.Errorf("openai_compat: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if p.cfg.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+p.cfg.APIKey)
	}

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return providers.Response{}, fmt.Errorf("openai_compat: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return providers.Response{}, &APIError{StatusCode: resp.StatusCode, Body: string(errBody)}
	}

	return parseStream(resp.Body, onDelta)
}

// APIError wraps non-2xx responses.
type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("openai_compat: HTTP %d: %s", e.StatusCode, e.Body)
}

// Retryable indicates whether the activity should retry.
func (e *APIError) Retryable() bool {
	if e.StatusCode == http.StatusTooManyRequests {
		return true
	}
	return e.StatusCode >= 500
}

func buildRequest(model string, req providers.CompletionRequest) ([]byte, error) {
	out := wireRequest{
		Model:    model,
		Messages: toWireMessages(req.System, req.Messages),
		Tools:    toWireTools(req.Tools),
		Stream:   true,
	}
	if len(out.Tools) > 0 {
		out.ToolChoice = "auto"
	}
	if req.MaxTokens > 0 {
		out.MaxTokens = req.MaxTokens
	}
	if req.Temperature > 0 {
		t := req.Temperature
		out.Temperature = &t
	}
	out.StreamOptions = &struct {
		IncludeUsage bool `json:"include_usage"`
	}{IncludeUsage: true}
	return json.Marshal(out)
}

func toWireMessages(system string, msgs []providers.Message) []wireMessage {
	out := make([]wireMessage, 0, len(msgs)+1)
	if system != "" {
		out = append(out, wireMessage{Role: "system", Content: system})
	}
	for _, m := range msgs {
		switch m.Role {
		case providers.RoleSystem:
			out = append(out, wireMessage{Role: "system", Content: m.Content})
		case providers.RoleUser:
			out = append(out, wireMessage{Role: "user", Content: m.Content})
		case providers.RoleAssistant:
			wm := wireMessage{Role: "assistant", Content: m.Content}
			for _, tc := range m.ToolCalls {
				args, _ := json.Marshal(tc.Arguments)
				wm.ToolCalls = append(wm.ToolCalls, wireToolCall{
					ID:   tc.ID,
					Type: "function",
					Function: wireToolCallFn{
						Name:      tc.Name,
						Arguments: string(args),
					},
				})
			}
			out = append(out, wm)
		case providers.RoleTool:
			out = append(out, wireMessage{
				Role:       "tool",
				ToolCallID: m.ToolCallID,
				Name:       m.Name,
				Content:    m.Content,
			})
		}
	}
	return out
}

func toWireTools(tools []providers.ToolSchema) []wireTool {
	out := make([]wireTool, 0, len(tools))
	for _, t := range tools {
		params := t.InputSchema
		if params == nil {
			params = map[string]any{"type": "object"}
		}
		out = append(out, wireTool{
			Type: "function",
			Function: wireToolFunction{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  params,
			},
		})
	}
	return out
}

// --- SSE parsing ---

type wireStreamChoice struct {
	Index int `json:"index"`
	Delta struct {
		Role      string         `json:"role,omitempty"`
		Content   string         `json:"content,omitempty"`
		ToolCalls []wireToolCall `json:"tool_calls,omitempty"`
	} `json:"delta"`
	FinishReason string `json:"finish_reason,omitempty"`
}

type wireStreamChunk struct {
	Choices []wireStreamChoice `json:"choices"`
	Usage   *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage,omitempty"`
}

func parseStream(r io.Reader, onDelta func(providers.Delta) error) (providers.Response, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)

	var (
		resp      providers.Response
		assembled = map[int]*providers.ToolCall{}
		text      strings.Builder
	)

	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		payload := bytes.TrimSpace(line[len("data:"):])
		if bytes.Equal(payload, []byte("[DONE]")) {
			break
		}
		var chunk wireStreamChunk
		if err := json.Unmarshal(payload, &chunk); err != nil {
			continue
		}
		if chunk.Usage != nil {
			resp.Usage.InputTokens = chunk.Usage.PromptTokens
			resp.Usage.OutputTokens = chunk.Usage.CompletionTokens
		}
		for _, ch := range chunk.Choices {
			if ch.Delta.Content != "" {
				text.WriteString(ch.Delta.Content)
				if err := onDelta(providers.Delta{Kind: providers.DeltaText, Text: ch.Delta.Content}); err != nil {
					return resp, err
				}
			}
			for _, tc := range ch.Delta.ToolCalls {
				agg, ok := assembled[tc.Index]
				if !ok {
					agg = &providers.ToolCall{}
					assembled[tc.Index] = agg
					if err := onDelta(providers.Delta{
						Kind:     providers.DeltaToolCallStart,
						ToolID:   tc.ID,
						ToolName: tc.Function.Name,
					}); err != nil {
						return resp, err
					}
				}
				if tc.ID != "" {
					agg.ID = tc.ID
				}
				if tc.Function.Name != "" {
					agg.Name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					if agg.Arguments == nil {
						agg.Arguments = map[string]any{}
					}
					// We accumulate the JSON args fragment-by-fragment in a
					// buffer string keyed under "__buf" so we can decode at end.
					buf, _ := agg.Arguments["__buf"].(string)
					agg.Arguments["__buf"] = buf + tc.Function.Arguments
					if err := onDelta(providers.Delta{
						Kind:        providers.DeltaToolCallArgs,
						ToolID:      agg.ID,
						PartialJSON: tc.Function.Arguments,
					}); err != nil {
						return resp, err
					}
				}
			}
			if ch.FinishReason != "" {
				resp.StopReason = ch.FinishReason
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return resp, fmt.Errorf("openai_compat: stream scan: %w", err)
	}

	// Finalize tool calls: decode buffered argument JSON into structured maps.
	for _, idx := range sortedIndexes(assembled) {
		tc := assembled[idx]
		buf, _ := tc.Arguments["__buf"].(string)
		delete(tc.Arguments, "__buf")
		if buf != "" {
			args := map[string]any{}
			_ = json.Unmarshal([]byte(buf), &args)
			tc.Arguments = args
		}
		resp.ToolCalls = append(resp.ToolCalls, *tc)
		_ = onDelta(providers.Delta{
			Kind:     providers.DeltaToolCallEnd,
			ToolID:   tc.ID,
			ToolName: tc.Name,
		})
	}

	resp.Text = text.String()
	_ = onDelta(providers.Delta{Kind: providers.DeltaStop, StopReason: resp.StopReason})
	return resp, nil
}

func sortedIndexes(m map[int]*providers.ToolCall) []int {
	out := make([]int, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	// Insertion sort (n is tiny, almost always 0..3).
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}
