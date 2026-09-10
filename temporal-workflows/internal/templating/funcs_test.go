package templating

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFuncMap(t *testing.T) {
	fm := FuncMap()

	call := func(t *testing.T, name string, args ...interface{}) interface{} {
		t.Helper()
		fn, ok := fm[name]
		if !ok {
			t.Fatalf("FuncMap missing %q", name)
		}
		switch f := fn.(type) {
		case func(string) string:
			return f(args[0].(string))
		case func(string, string) string:
			return f(args[0].(string), args[1].(string))
		case func(string, string, string) string:
			return f(args[0].(string), args[1].(string), args[2].(string))
		case func(string, string) bool:
			return f(args[0].(string), args[1].(string))
		case func(int, string) string:
			return f(args[0].(int), args[1].(string))
		case func([]string, string) string:
			return f(args[0].([]string), args[1].(string))
		case func(string, string) []string:
			return f(args[0].(string), args[1].(string))
		case func(interface{}) (string, error):
			s, err := f(args[0])
			if err != nil {
				t.Fatal(err)
			}
			return s
		default:
			t.Fatalf("unsupported func signature for %q: %T", name, fn)
			return nil
		}
	}

	assert.Equal(t, "orders", call(t, "lower", "ORDERS"))
	assert.Equal(t, "ORDERS", call(t, "upper", "orders"))
	assert.Equal(t, "Orders Service", call(t, "title", "orders service"))
	assert.Equal(t, "orders", call(t, "trim", "  orders  "))
	assert.Equal(t, "orders", call(t, "trimPrefix", "my-orders", "my-"))
	assert.Equal(t, "orders", call(t, "trimSuffix", "orders-svc", "-svc"))
	assert.Equal(t, "orders-new", call(t, "replace", "orders-old", "old", "new"))
	assert.Equal(t, "fallback", call(t, "default", "", "fallback"))
	assert.Equal(t, "value", call(t, "default", "value", "fallback"))
	assert.Equal(t, `"orders"`, call(t, "quote", "orders"))
	assert.Equal(t, "my-service", call(t, "kebabCase", "MyService"))
	assert.Equal(t, "my_service", call(t, "snakeCase", "MyService"))
	assert.Equal(t, "MyService", call(t, "pascalCase", "my-service"))
	assert.Equal(t, "myService", call(t, "camelCase", "my-service"))
	assert.Equal(t, true, call(t, "contains", "orders-service", "service"))
	assert.Equal(t, true, call(t, "hasPrefix", "orders-service", "orders"))
	assert.Equal(t, true, call(t, "hasSuffix", "orders-service", "service"))
	assert.Equal(t, "a,b,c", call(t, "join", []string{"a", "b", "c"}, ","))
	assert.Equal(t, []string{"a", "b", "c"}, call(t, "split", "a,b,c", ","))
	assert.Equal(t, "  orders", call(t, "indent", 2, "orders"))
	assert.Equal(t, "\n  orders", call(t, "nindent", 2, "orders"))

	jsonOut := call(t, "toJson", map[string]string{"key": "value"})
	assert.JSONEq(t, `{"key":"value"}`, jsonOut.(string))
}
