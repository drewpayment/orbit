package grpc

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// isJSONErrorBody is what separates "no such record" from "no such route" on a
// 404, so it is table-tested directly rather than only through the two clients.
// Getting it wrong in the permissive direction reports an undeployed route as a
// missing record and sends whoever debugs it hunting for the wrong thing.
func TestIsJSONErrorBody(t *testing.T) {
	tests := []struct {
		name string
		body string
		want bool
	}{
		// The shape both internal routes actually emit.
		{name: "the route's error envelope", body: `{"error":"action run not found"}`, want: true},
		{name: "an error envelope with siblings", body: `{"error":"nope","code":404}`, want: true},
		{name: "an empty error string still counts", body: `{"error":""}`, want: true},

		// Everything else means the response did not come from the route.
		{name: "valid JSON with no error key", body: `{"message":"nope"}`, want: false},
		{name: "an empty body", body: "", want: false},
		{name: "an HTML 404 page", body: "<!DOCTYPE html><html><body>404</body></html>", want: false},
		{name: "a JSON array", body: `["error"]`, want: false},
		{name: "a bare JSON string", body: `"error"`, want: false},
		{name: "JSON null", body: "null", want: false},
		{name: "a null error value", body: `{"error":null}`, want: false},
		{name: "truncated JSON", body: `{"error":`, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, isJSONErrorBody([]byte(tt.body)))
		})
	}
}
