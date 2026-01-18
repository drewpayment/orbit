// services/bifrost/internal/proxy/rewriter.go
package proxy

import (
	"strings"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
)

// Rewriter handles topic/group/transactionID prefix operations.
// It transparently rewrites Kafka protocol messages for multi-tenant isolation.
type Rewriter struct {
	ctx *auth.ConnectionContext
}

// NewRewriter creates a rewriter for a connection context.
func NewRewriter(ctx *auth.ConnectionContext) *Rewriter {
	return &Rewriter{ctx: ctx}
}

// PrefixTopic adds the tenant prefix to a topic name.
// Used when processing client requests (e.g., Produce, Fetch).
func (r *Rewriter) PrefixTopic(topic string) string {
	return r.ctx.TopicPrefix + topic
}

// UnprefixTopic removes the tenant prefix from a topic name.
// Returns false if the topic doesn't have our prefix (belongs to another tenant).
// Used when processing broker responses (e.g., Metadata).
func (r *Rewriter) UnprefixTopic(topic string) (string, bool) {
	// Empty prefix matches everything (no multi-tenancy)
	if r.ctx.TopicPrefix == "" {
		return topic, true
	}
	if !strings.HasPrefix(topic, r.ctx.TopicPrefix) {
		return "", false
	}
	return strings.TrimPrefix(topic, r.ctx.TopicPrefix), true
}

// PrefixGroup adds the tenant prefix to a consumer group ID.
// Used when processing client requests (e.g., JoinGroup, SyncGroup).
func (r *Rewriter) PrefixGroup(group string) string {
	return r.ctx.GroupPrefix + group
}

// UnprefixGroup removes the tenant prefix from a consumer group ID.
// Used when processing broker responses.
func (r *Rewriter) UnprefixGroup(group string) (string, bool) {
	// Empty prefix matches everything (no multi-tenancy)
	if r.ctx.GroupPrefix == "" {
		return group, true
	}
	if !strings.HasPrefix(group, r.ctx.GroupPrefix) {
		return "", false
	}
	return strings.TrimPrefix(group, r.ctx.GroupPrefix), true
}

// PrefixTransactionID adds the tenant prefix to a transaction ID.
// Used when processing client requests (e.g., InitProducerId).
func (r *Rewriter) PrefixTransactionID(txnID string) string {
	return r.ctx.TxnIDPrefix + txnID
}

// UnprefixTransactionID removes the tenant prefix from a transaction ID.
// Used when processing broker responses.
func (r *Rewriter) UnprefixTransactionID(txnID string) (string, bool) {
	// Empty prefix matches everything (no multi-tenancy)
	if r.ctx.TxnIDPrefix == "" {
		return txnID, true
	}
	if !strings.HasPrefix(txnID, r.ctx.TxnIDPrefix) {
		return "", false
	}
	return strings.TrimPrefix(txnID, r.ctx.TxnIDPrefix), true
}

// FilterTopics filters a list of topics to only those belonging to this tenant.
// Returns virtual (unprefixed) topic names.
// Used when processing Metadata responses to hide other tenants' topics.
func (r *Rewriter) FilterTopics(topics []string) []string {
	result := make([]string, 0, len(topics))
	for _, topic := range topics {
		if virtual, ok := r.UnprefixTopic(topic); ok {
			result = append(result, virtual)
		}
	}
	return result
}

// HasTopicPrefix checks if we have a topic prefix configured.
// Useful for determining if topic rewriting is enabled.
func (r *Rewriter) HasTopicPrefix() bool {
	return r.ctx.TopicPrefix != ""
}
