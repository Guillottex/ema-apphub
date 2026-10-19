-- EMA AppHub · esquema inicial de la base de la plataforma
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── Seguridad ─────────────
CREATE TABLE roles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(40) UNIQUE NOT NULL,
  name        VARCHAR(80) NOT NULL,
  description TEXT
);

CREATE TABLE permissions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(60) UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(60) UNIQUE NOT NULL,
  email         VARCHAR(160) UNIQUE NOT NULL,
  full_name     VARCHAR(160) NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       INT NOT NULL REFERENCES roles(id),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Registries ─────────────
CREATE TABLE docker_registries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(80) UNIQUE NOT NULL,
  kind         VARCHAR(20) NOT NULL DEFAULT 'private', -- local | dockerhub | ghcr | private
  url          VARCHAR(255) NOT NULL,                  -- ej: registry.empresa.local
  namespace    VARCHAR(120),                           -- ej: crm
  username     VARCHAR(120),
  password_enc TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Aplicaciones ─────────────
CREATE TABLE applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               VARCHAR(50) UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  name               VARCHAR(120) NOT NULL,
  description        TEXT,
  technology         VARCHAR(40) NOT NULL DEFAULT 'unknown',
  detected_technology VARCHAR(40),
  framework_label    VARCHAR(80),
  internal_port      INT NOT NULL DEFAULT 80 CHECK (internal_port BETWEEN 1 AND 65535),
  healthcheck_path   VARCHAR(200) DEFAULT '/',
  build_config       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- buildCommand, startCommand, testCommand, outputDir…
  registry_id        UUID REFERENCES docker_registries(id) ON DELETE SET NULL,
  current_version_id UUID,
  storage_path       TEXT NOT NULL,
  author_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  cloned_from_id     UUID REFERENCES applications(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE repositories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID UNIQUE NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  provider        VARCHAR(20) NOT NULL DEFAULT 'git',  -- github | gitlab | bitbucket | git
  url             TEXT NOT NULL,
  auth_type       VARCHAR(10) NOT NULL DEFAULT 'none', -- none | token | basic | ssh
  username        VARCHAR(120),
  credential_enc  TEXT,                                 -- token / password / ssh private key
  branch          VARCHAR(200),
  tag             VARCHAR(200),
  commit_sha      VARCHAR(64),
  subdirectory    VARCHAR(255),
  webhook_secret  VARCHAR(80) NOT NULL DEFAULT encode(gen_random_bytes(20), 'hex'),
  auto_deploy_environment VARCHAR(20),
  last_commit     VARCHAR(64),
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE application_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version         VARCHAR(40) NOT NULL,
  source_type     VARCHAR(10) NOT NULL,  -- zip | git | upload | clone | edit
  source_path     TEXT NOT NULL,
  dockerfile      TEXT NOT NULL,
  compose_file    TEXT,
  technology      VARCHAR(40),
  build_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  env_snapshot_enc TEXT,
  commit_sha      VARCHAR(64),
  comment         TEXT,
  size_bytes      BIGINT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, version)
);

ALTER TABLE applications
  ADD CONSTRAINT fk_current_version FOREIGN KEY (current_version_id)
  REFERENCES application_versions(id) ON DELETE SET NULL;

CREATE TABLE application_environments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name                VARCHAR(20) NOT NULL CHECK (name IN ('development','test','staging','production')),
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  internal_port       INT CHECK (internal_port BETWEEN 1 AND 65535),
  external_port       INT CHECK (external_port BETWEEN 1 AND 65535),
  domain              VARCHAR(255),
  https_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  volumes             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{source,target,type:'volume'|'bind',readOnly}]
  extra_ports         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{internal,external,protocol}]
  replicas            INT NOT NULL DEFAULT 1,
  memory_limit_mb     INT,
  cpu_limit           NUMERIC(4,2),
  deployed_version_id UUID REFERENCES application_versions(id) ON DELETE SET NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'not_deployed', -- not_deployed|deploying|running|stopped|error
  health_status       VARCHAR(20) NOT NULL DEFAULT 'unknown',      -- unknown|healthy|unhealthy
  health_checked_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, name)
);
CREATE UNIQUE INDEX ux_env_external_port ON application_environments(external_port) WHERE external_port IS NOT NULL;
CREATE UNIQUE INDEX ux_env_domain ON application_environments(lower(domain)) WHERE domain IS NOT NULL AND domain <> '';

CREATE TABLE environment_variables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES application_environments(id) ON DELETE CASCADE,
  key            VARCHAR(120) NOT NULL CHECK (key ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
  value          TEXT,          -- sólo variables NO secretas
  value_enc      TEXT,          -- sólo variables secretas (AES-256-GCM)
  is_secret      BOOLEAN NOT NULL DEFAULT FALSE,
  is_system      BOOLEAN NOT NULL DEFAULT FALSE, -- generadas por la plataforma (DATABASE_URL…)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (environment_id, key)
);

-- ───────────── Docker ─────────────
CREATE TABLE docker_images (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version_id     UUID NOT NULL REFERENCES application_versions(id) ON DELETE CASCADE,
  tag            VARCHAR(255) NOT NULL,
  image_id       VARCHAR(128),
  size_bytes     BIGINT,
  registry_id    UUID REFERENCES docker_registries(id) ON DELETE SET NULL,
  pushed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, tag)
);

CREATE TABLE deployments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  environment_id UUID NOT NULL REFERENCES application_environments(id) ON DELETE CASCADE,
  version_id     UUID REFERENCES application_versions(id) ON DELETE SET NULL,
  previous_version_id UUID REFERENCES application_versions(id) ON DELETE SET NULL,
  trigger        VARCHAR(20) NOT NULL DEFAULT 'manual', -- manual|git|webhook|rollback|auto_rollback|clone
  status         VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued|running|success|failed|rolled_back
  current_step   VARCHAR(30),
  log            TEXT NOT NULL DEFAULT '',
  error          TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_deployments_env ON deployments(environment_id, created_at DESC);

CREATE TABLE containers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES application_environments(id) ON DELETE CASCADE,
  service        VARCHAR(40) NOT NULL,   -- app | db
  container_id   VARCHAR(80),
  name           VARCHAR(120) NOT NULL,
  image          VARCHAR(255),
  state          VARCHAR(30),
  status_text    VARCHAR(120),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (environment_id, service)
);

-- ───────────── Bases de datos ─────────────
CREATE TABLE databases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  environment_id UUID UNIQUE NOT NULL REFERENCES application_environments(id) ON DELETE CASCADE,
  engine         VARCHAR(20) NOT NULL DEFAULT 'postgres' CHECK (engine IN ('postgres','mysql','mariadb','mongodb','redis')),
  engine_version VARCHAR(20) NOT NULL DEFAULT '16',
  container_name VARCHAR(120) NOT NULL,
  host           VARCHAR(120) NOT NULL,
  port           INT NOT NULL DEFAULT 5432,
  database_name  VARCHAR(63) NOT NULL,
  volume_name    VARCHAR(120) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'creating',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE database_credentials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  database_id  UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  username     VARCHAR(63) NOT NULL,
  password_enc TEXT NOT NULL,
  is_owner     BOOLEAN NOT NULL DEFAULT FALSE,
  privileges   VARCHAR(20) NOT NULL DEFAULT 'readwrite', -- owner|readwrite|readonly
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at   TIMESTAMPTZ,
  UNIQUE (database_id, username)
);

-- ───────────── Backups ─────────────
CREATE TABLE backups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  environment_id UUID REFERENCES application_environments(id) ON DELETE SET NULL,
  database_id    UUID REFERENCES databases(id) ON DELETE SET NULL,
  app_slug       VARCHAR(50),
  type           VARCHAR(10) NOT NULL CHECK (type IN ('app','database')),
  status         VARCHAR(20) NOT NULL DEFAULT 'running', -- running|success|failed
  file_path      TEXT,
  size_bytes     BIGINT,
  scheduled      BOOLEAN NOT NULL DEFAULT FALSE,
  notes          TEXT,
  error          TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE TABLE backup_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id UUID NOT NULL REFERENCES application_environments(id) ON DELETE CASCADE,
  type           VARCHAR(10) NOT NULL CHECK (type IN ('app','database')),
  cron           VARCHAR(60) NOT NULL,
  retention      INT NOT NULL DEFAULT 7,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Observabilidad ─────────────
CREATE TABLE health_checks (
  id             BIGSERIAL PRIMARY KEY,
  environment_id UUID NOT NULL REFERENCES application_environments(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL, -- healthy|unhealthy
  http_status    INT,
  response_ms    INT,
  error          TEXT,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_health_env ON health_checks(environment_id, checked_at DESC);

CREATE TABLE audit_logs (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  username         VARCHAR(60),
  ip               VARCHAR(64),
  action           VARCHAR(60) NOT NULL,
  entity_type      VARCHAR(40),
  entity_id        VARCHAR(80),
  application_id   UUID REFERENCES applications(id) ON DELETE SET NULL,
  application_name VARCHAR(120),
  details          JSONB,
  result           VARCHAR(10) NOT NULL DEFAULT 'success', -- success|failure
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_created ON audit_logs(created_at DESC);

CREATE TABLE settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
