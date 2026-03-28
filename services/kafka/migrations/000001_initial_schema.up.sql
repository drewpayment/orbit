-- Kafka Service PostgreSQL Schema
-- Clean-slate migration: no data migration needed.
-- In-memory stubs were volatile (all state lost on restart).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Kafka clusters
CREATE TABLE kafka_clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    provider_id TEXT NOT NULL,
    connection_config JSONB NOT NULL DEFAULT '{}',
    validation_status TEXT NOT NULL DEFAULT 'pending',
    last_validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Environment-to-cluster mappings
CREATE TABLE kafka_environment_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    environment TEXT NOT NULL,
    cluster_id UUID NOT NULL REFERENCES kafka_clusters(id) ON DELETE CASCADE,
    routing_rule JSONB NOT NULL DEFAULT '{}',
    priority INT NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_env_mappings_env_default ON kafka_environment_mappings (environment, is_default);

-- Kafka topics
CREATE TABLE kafka_topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    environment TEXT NOT NULL,
    cluster_id UUID REFERENCES kafka_clusters(id),
    partitions INT NOT NULL DEFAULT 3,
    replication_factor INT NOT NULL DEFAULT 3,
    retention_ms BIGINT NOT NULL DEFAULT 604800000,
    cleanup_policy TEXT NOT NULL DEFAULT 'delete',
    compression TEXT NOT NULL DEFAULT 'none',
    config JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending-approval',
    workflow_id TEXT NOT NULL DEFAULT '',
    approval_required BOOLEAN NOT NULL DEFAULT true,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_topics_workspace_env_name ON kafka_topics (workspace_id, environment, name);
CREATE INDEX idx_topics_workspace_env ON kafka_topics (workspace_id, environment);

-- Topic policies
CREATE TABLE kafka_topic_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scope TEXT NOT NULL DEFAULT 'platform',
    workspace_id UUID,
    environment TEXT NOT NULL,
    naming_pattern TEXT NOT NULL DEFAULT '',
    auto_approve_patterns JSONB NOT NULL DEFAULT '[]',
    partition_limits JSONB,
    retention_limits JSONB,
    require_schema BOOLEAN NOT NULL DEFAULT false,
    require_approval_for JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_topic_policies_workspace_env ON kafka_topic_policies (workspace_id, environment);

-- Schemas
CREATE TABLE kafka_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL,
    topic_id UUID NOT NULL REFERENCES kafka_topics(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    format TEXT NOT NULL,
    content TEXT NOT NULL,
    version INT NOT NULL DEFAULT 0,
    schema_id INT NOT NULL DEFAULT 0,
    compatibility TEXT NOT NULL DEFAULT 'backward',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_schemas_topic_type ON kafka_schemas (topic_id, type);

-- Schema registries
CREATE TABLE kafka_schema_registries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_id UUID NOT NULL REFERENCES kafka_clusters(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    subject_naming_template TEXT NOT NULL DEFAULT '',
    default_compatibility TEXT NOT NULL DEFAULT 'backward',
    environment_overrides JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_schema_registries_cluster ON kafka_schema_registries (cluster_id);

-- Topic shares
CREATE TABLE kafka_topic_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic_id UUID NOT NULL REFERENCES kafka_topics(id) ON DELETE CASCADE,
    shared_with_type TEXT NOT NULL DEFAULT 'workspace',
    shared_with_workspace_id UUID,
    shared_with_user_id UUID,
    permission TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending-request',
    requested_by UUID NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    justification TEXT NOT NULL DEFAULT '',
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_topic_shares_topic_workspace ON kafka_topic_shares (topic_id, shared_with_workspace_id);

-- Topic share policies
CREATE TABLE kafka_topic_share_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL,
    scope TEXT NOT NULL,
    topic_pattern TEXT NOT NULL DEFAULT '',
    topic_id UUID,
    environment TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private',
    auto_approve JSONB,
    default_permission TEXT NOT NULL DEFAULT 'read',
    require_justification BOOLEAN NOT NULL DEFAULT false,
    access_ttl_days INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_share_policies_workspace_topic ON kafka_topic_share_policies (workspace_id, topic_id);

-- Service accounts
CREATE TABLE kafka_service_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_accounts_workspace ON kafka_service_accounts (workspace_id);
