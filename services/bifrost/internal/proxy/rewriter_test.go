// services/bifrost/internal/proxy/rewriter_test.go
package proxy

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
)

func TestRewriter_PrefixTopic(t *testing.T) {
	ctx := &auth.ConnectionContext{
		TopicPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	// Client sends "orders", should become "myapp-dev-orders"
	assert.Equal(t, "myapp-dev-orders", r.PrefixTopic("orders"))
}

func TestRewriter_UnprefixTopic(t *testing.T) {
	ctx := &auth.ConnectionContext{
		TopicPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	// Broker returns "myapp-dev-orders", client sees "orders"
	result, ok := r.UnprefixTopic("myapp-dev-orders")
	assert.True(t, ok)
	assert.Equal(t, "orders", result)

	// Topic without our prefix (from another tenant)
	_, ok = r.UnprefixTopic("other-app-orders")
	assert.False(t, ok)
}

func TestRewriter_PrefixGroup(t *testing.T) {
	ctx := &auth.ConnectionContext{
		GroupPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	assert.Equal(t, "myapp-dev-my-consumers", r.PrefixGroup("my-consumers"))
}

func TestRewriter_UnprefixGroup(t *testing.T) {
	ctx := &auth.ConnectionContext{
		GroupPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	result, ok := r.UnprefixGroup("myapp-dev-my-consumers")
	assert.True(t, ok)
	assert.Equal(t, "my-consumers", result)
}

func TestRewriter_PrefixTransactionID(t *testing.T) {
	ctx := &auth.ConnectionContext{
		TxnIDPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	assert.Equal(t, "myapp-dev-tx-123", r.PrefixTransactionID("tx-123"))
}

func TestRewriter_UnprefixTransactionID(t *testing.T) {
	ctx := &auth.ConnectionContext{
		TxnIDPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	result, ok := r.UnprefixTransactionID("myapp-dev-tx-123")
	assert.True(t, ok)
	assert.Equal(t, "tx-123", result)

	// Transaction ID without our prefix
	_, ok = r.UnprefixTransactionID("other-app-tx-456")
	assert.False(t, ok)
}

func TestRewriter_FilterTopics(t *testing.T) {
	ctx := &auth.ConnectionContext{
		TopicPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	topics := []string{
		"myapp-dev-orders",
		"myapp-dev-users",
		"other-app-data",
		"__consumer_offsets",
	}

	filtered := r.FilterTopics(topics)
	assert.Len(t, filtered, 2)
	assert.Contains(t, filtered, "orders")
	assert.Contains(t, filtered, "users")
}

func TestRewriter_HasTopicPrefix(t *testing.T) {
	// With prefix
	ctx := &auth.ConnectionContext{
		TopicPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)
	assert.True(t, r.HasTopicPrefix())

	// Without prefix
	ctx2 := &auth.ConnectionContext{
		TopicPrefix: "",
	}
	r2 := NewRewriter(ctx2)
	assert.False(t, r2.HasTopicPrefix())
}

func TestRewriter_EmptyPrefix(t *testing.T) {
	// When no prefix is configured, operations should still work
	ctx := &auth.ConnectionContext{
		TopicPrefix: "",
		GroupPrefix: "",
		TxnIDPrefix: "",
	}
	r := NewRewriter(ctx)

	// Prefix operations just return the original
	assert.Equal(t, "orders", r.PrefixTopic("orders"))
	assert.Equal(t, "my-group", r.PrefixGroup("my-group"))
	assert.Equal(t, "tx-123", r.PrefixTransactionID("tx-123"))

	// Unprefix operations should match anything when prefix is empty
	result, ok := r.UnprefixTopic("orders")
	assert.True(t, ok)
	assert.Equal(t, "orders", result)
}

func TestRewriter_FilterTopicsEmptyList(t *testing.T) {
	ctx := &auth.ConnectionContext{
		TopicPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	filtered := r.FilterTopics([]string{})
	assert.Empty(t, filtered)
}

func TestRewriter_FilterTopicsNoMatches(t *testing.T) {
	ctx := &auth.ConnectionContext{
		TopicPrefix: "myapp-dev-",
	}
	r := NewRewriter(ctx)

	topics := []string{
		"other-app-data",
		"__consumer_offsets",
		"some-random-topic",
	}

	filtered := r.FilterTopics(topics)
	assert.Empty(t, filtered)
}
