// Package actions holds the concrete scaffolder step implementations. Each
// action owns a sibling pair of `.schema.json` files embedded via go:embed, so
// the schemas stay diffable and reusable by a future TypeScript sync
// (plan §5.4).
package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed debug_log.input.schema.json
var debugLogInputSchema []byte

//go:embed debug_log.output.schema.json
var debugLogOutputSchema []byte

// DebugLog writes a line to the run log. It is the reference minimal action and
// the only one with no side effects outside the log.
type DebugLog struct{}

// NewDebugLog constructs the debug:log action.
func NewDebugLog() *DebugLog { return &DebugLog{} }

type debugLogInput struct {
	Message string         `json:"message"`
	Level   string         `json:"level"`
	Data    map[string]any `json:"data"`
}

var debugLogLevels = map[string]slog.Level{
	"debug": slog.LevelDebug,
	"info":  slog.LevelInfo,
	"warn":  slog.LevelWarn,
	"error": slog.LevelError,
}

// Name implements scaffolder.Action.
func (a *DebugLog) Name() string { return "debug:log" }

// InputSchema implements scaffolder.Action.
func (a *DebugLog) InputSchema() json.RawMessage { return debugLogInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *DebugLog) OutputSchema() json.RawMessage { return debugLogOutputSchema }

// Execute logs the message and echoes it back as the step output.
func (a *DebugLog) Execute(_ context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseDebugLogInput(input)
	if err != nil {
		return nil, err
	}
	// Author-supplied field names go under a `data` group so a template cannot
	// forge a top-level runId, level or msg attribute and spoof a run log.
	data := make([]any, 0, len(in.Data))
	for _, k := range sortedKeys(in.Data) {
		data = append(data, slog.Any(k, in.Data[k]))
	}
	rc.Logger.Log(context.Background(), debugLogLevels[in.Level], in.Message,
		slog.String("runId", rc.RunID),
		slog.String("action", a.Name()),
		slog.Group("data", data...),
	)
	return json.Marshal(map[string]string{"message": in.Message, "level": in.Level})
}

// Plan describes the log line without writing it.
func (a *DebugLog) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseDebugLogInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "log",
		Name:        a.Name(),
		Description: fmt.Sprintf("log [%s] %s", in.Level, in.Message),
	}}, nil
}

func parseDebugLogInput(raw json.RawMessage) (debugLogInput, error) {
	var in debugLogInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("debug:log: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.Message) == "" {
		return in, fmt.Errorf("debug:log: `message` is required")
	}
	if in.Level == "" {
		in.Level = "info"
	}
	if _, ok := debugLogLevels[in.Level]; !ok {
		return in, fmt.Errorf("debug:log: unknown `level` %q, expected debug|info|warn|error", in.Level)
	}
	return in, nil
}
