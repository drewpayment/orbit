-- Reverse dependency order
DROP TABLE IF EXISTS kafka_service_accounts;
DROP TABLE IF EXISTS kafka_topic_share_policies;
DROP TABLE IF EXISTS kafka_topic_shares;
DROP TABLE IF EXISTS kafka_schema_registries;
DROP TABLE IF EXISTS kafka_schemas;
DROP TABLE IF EXISTS kafka_topic_policies;
DROP TABLE IF EXISTS kafka_topics;
DROP TABLE IF EXISTS kafka_environment_mappings;
DROP TABLE IF EXISTS kafka_clusters;
DROP EXTENSION IF EXISTS "uuid-ossp";
