-- EGA Hermes Mobile Sidecar — Database Schema
-- Schema: mobile_sidecar
-- This schema is ISOLATED from the main application's `public` schema.
-- No Hermes SQLite access. No client-side service-role key.

-- 001_mobile_principals
CREATE TABLE IF NOT EXISTS mobile_sidecar.mobile_principals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT,
    cf_identity_id  TEXT,  -- Cloudflare Access identity ID
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 002_mobile_devices
CREATE TABLE IF NOT EXISTS mobile_sidecar.mobile_devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id    UUID NOT NULL REFERENCES mobile_sidecar.mobile_principals(id) ON DELETE CASCADE,
    device_name     TEXT NOT NULL,
    platform        TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
    push_token      TEXT,
    device_fingerprint TEXT,
    is_revoked      BOOLEAN NOT NULL DEFAULT false,
    revoked_at      TIMESTAMPTZ,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mobile_devices_principal ON mobile_sidecar.mobile_devices(principal_id);
CREATE INDEX idx_mobile_devices_push_token ON mobile_sidecar.mobile_devices(push_token) WHERE push_token IS NOT NULL;

-- 003_mobile_refresh_tokens
CREATE TABLE IF NOT EXISTS mobile_sidecar.mobile_refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID NOT NULL REFERENCES mobile_sidecar.mobile_devices(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,  -- SHA-256 hash of the refresh token (never store raw)
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_hash ON mobile_sidecar.mobile_refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_device ON mobile_sidecar.mobile_refresh_tokens(device_id);

-- 004_hermes_instances
CREATE TABLE IF NOT EXISTS mobile_sidecar.hermes_instances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    gateway_url     TEXT NOT NULL,
    api_key_hash    TEXT NOT NULL,  -- hash of API key; never store raw
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_health_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 005_run_watches
CREATE TABLE IF NOT EXISTS mobile_sidecar.run_watches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID NOT NULL REFERENCES mobile_sidecar.mobile_devices(id) ON DELETE CASCADE,
    hermes_run_id   TEXT NOT NULL,
    last_event_id   TEXT,
    status          TEXT NOT NULL DEFAULT 'watching' CHECK (status IN ('watching', 'completed', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_run_watches_device ON mobile_sidecar.run_watches(device_id);

-- 006_mobile_approvals
CREATE TABLE IF NOT EXISTS mobile_sidecar.mobile_approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID NOT NULL REFERENCES mobile_sidecar.mobile_devices(id) ON DELETE CASCADE,
    hermes_run_id   TEXT NOT NULL,
    operation_digest TEXT NOT NULL,  -- cryptographic digest of the operation being approved
    decision        TEXT CHECK (decision IN ('approved', 'denied', 'pending')),
    idempotency_key TEXT,
    decided_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approvals_device ON mobile_sidecar.mobile_approvals(device_id);
CREATE INDEX idx_approvals_idempotency ON mobile_sidecar.mobile_approvals(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 007_mobile_alerts
CREATE TABLE IF NOT EXISTS mobile_sidecar.mobile_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID REFERENCES mobile_sidecar.mobile_devices(id) ON DELETE CASCADE,
    principal_id    UUID REFERENCES mobile_sidecar.mobile_principals(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    severity        TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    title           TEXT NOT NULL,
    body            TEXT,
    is_read         BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_device ON mobile_sidecar.mobile_alerts(device_id);
CREATE INDEX idx_alerts_principal ON mobile_sidecar.mobile_alerts(principal_id);

-- 008_push_tokens
CREATE TABLE IF NOT EXISTS mobile_sidecar.push_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID NOT NULL REFERENCES mobile_sidecar.mobile_devices(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL CHECK (provider IN ('expo', 'fcm')),
    token           TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_tokens_device ON mobile_sidecar.push_tokens(device_id);

-- 009_notification_deliveries
CREATE TABLE IF NOT EXISTS mobile_sidecar.notification_deliveries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id        UUID NOT NULL REFERENCES mobile_sidecar.mobile_alerts(id) ON DELETE CASCADE,
    push_token_id   UUID REFERENCES mobile_sidecar.push_tokens(id),
    provider        TEXT NOT NULL,
    provider_message_id TEXT,
    status          TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'failed', 'device_not_registered')),
    error_detail    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_deliveries_alert ON mobile_sidecar.notification_deliveries(alert_id);

-- 010_notification_preferences
CREATE TABLE IF NOT EXISTS mobile_sidecar.notification_preferences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID NOT NULL REFERENCES mobile_sidecar.mobile_devices(id) ON DELETE CASCADE,
    alert_type      TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    quiet_hours_start  TIME,
    quiet_hours_end    TIME,
    UNIQUE(device_id, alert_type)
);

-- 011_idempotency_records
CREATE TABLE IF NOT EXISTS mobile_sidecar.idempotency_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    response_body   JSONB,
    response_code   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 012_audit_events (append-only)
CREATE TABLE IF NOT EXISTS mobile_sidecar.audit_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id    UUID REFERENCES mobile_sidecar.mobile_principals(id),
    device_id       UUID REFERENCES mobile_sidecar.mobile_devices(id),
    event_type      TEXT NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    details         JSONB,
    client_ip       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_principal ON mobile_sidecar.audit_events(principal_id);
CREATE INDEX idx_audit_events_type ON mobile_sidecar.audit_events(event_type);

-- 013_health_snapshots
CREATE TABLE IF NOT EXISTS mobile_sidecar.health_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hermes_instance_id UUID REFERENCES mobile_sidecar.hermes_instances(id),
    health_status   TEXT NOT NULL,
    uptime_seconds  INTEGER,
    disk_used_percent REAL,
    db_integrity    BOOLEAN,
    snapshot        JSONB,  -- full health payload
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_health_snapshots_instance ON mobile_sidecar.health_snapshots(hermes_instance_id);
