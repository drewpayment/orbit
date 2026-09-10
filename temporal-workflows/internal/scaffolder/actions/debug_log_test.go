package actions

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDebugLogSchemasAreValidJSON(t *testing.T) {
	a := NewDebugLog()
	assert.Equal(t, "debug:log", a.Name())
	var probe map[string]any
	require.NoError(t, json.Unmarshal(a.InputSchema(), &probe))
	require.NoError(t, json.Unmarshal(a.OutputSchema(), &probe))
}

func TestDebugLogRegistersCleanly(t *testing.T) {
	r := scaffolder.NewRegistry(NewDebugLog())
	d, ok := r.Descriptor("debug:log")
	require.True(t, ok)
	assert.Equal(t, "debug", d.Family)
	assert.True(t, d.SupportsPlan)

	keys, err := r.OutputKeys("debug:log")
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"message", "level"}, keys)
}

func TestDebugLogExecute(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantMsg   string
		wantLevel string
		wantErr   string
	}{
		{name: "message only", input: `{"message":"hello"}`, wantMsg: "hello", wantLevel: "info"},
		{name: "explicit level", input: `{"message":"uh oh","level":"warn"}`, wantMsg: "uh oh", wantLevel: "warn"},
		{name: "with data", input: `{"message":"m","data":{"a":1}}`, wantMsg: "m", wantLevel: "info"},
		{name: "missing message", input: `{}`, wantErr: "message"},
		{name: "empty message", input: `{"message":"  "}`, wantErr: "message"},
		{name: "bad level", input: `{"message":"m","level":"shout"}`, wantErr: "level"},
		{name: "malformed json", input: `{`, wantErr: "decode"},
		{name: "nil input", input: ``, wantErr: "message"},
	}
	a := NewDebugLog()
	rc := scaffolder.NewActionRunContext(scaffolder.ActionRunContext{RunID: "run-1"})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := a.Execute(context.Background(), rc, json.RawMessage(tt.input))
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			var got struct {
				Message string `json:"message"`
				Level   string `json:"level"`
			}
			require.NoError(t, json.Unmarshal(out, &got))
			assert.Equal(t, tt.wantMsg, got.Message)
			assert.Equal(t, tt.wantLevel, got.Level)
		})
	}
}

func TestDebugLogPlan(t *testing.T) {
	a := NewDebugLog()
	rc := scaffolder.NewActionRunContext(scaffolder.ActionRunContext{RunID: "run-1", DryRun: true})

	changes, err := a.Plan(context.Background(), rc, json.RawMessage(`{"message":"hello"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "log", changes[0].Kind)
	assert.Contains(t, changes[0].Description, "hello")

	_, err = a.Plan(context.Background(), rc, json.RawMessage(`{}`))
	assert.Error(t, err, "Plan must validate its input the same way Execute does")
}
