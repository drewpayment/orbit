-- Initialize Backstage database
-- This script runs automatically when the PostgreSQL container starts

-- Create backstage database if it doesn't exist
SELECT 'CREATE DATABASE backstage'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'backstage')\gexec

-- Grant all privileges to orbit user
GRANT ALL PRIVILEGES ON DATABASE backstage TO orbit;

\c backstage

-- Create schema for backstage
CREATE SCHEMA IF NOT EXISTS public;
GRANT ALL ON SCHEMA public TO orbit;
GRANT ALL ON SCHEMA public TO public;

-- Backstage will create its own tables via migrations
