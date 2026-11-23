/** Ordered schema migrations. Never edit a released migration: append a new one. */
export const MIGRATIONS: string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  );
  CREATE TABLE provider_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT 'default',
    secret_enc TEXT NOT NULL,
    last4 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unchecked',
    info_json TEXT,
    created_at INTEGER NOT NULL,
    validated_at INTEGER,
    UNIQUE(user_id, provider)
  );
  CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    monthly_budget_usd REAL,
    daily_budget_usd REAL,
    max_cost_per_job_usd REAL,
    daily_job_limit INTEGER
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    art_direction TEXT NOT NULL DEFAULT '{}',
    cover_asset_id TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    generation_id TEXT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    file TEXT NOT NULL,
    source_file TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    frames_json TEXT,
    meta_json TEXT NOT NULL DEFAULT '{}',
    favorite INTEGER NOT NULL DEFAULT 0,
    editor_doc_file TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX idx_assets_project ON assets(project_id, deleted_at, created_at);
  CREATE INDEX idx_assets_parent ON assets(parent_id);
  CREATE TABLE asset_tags (
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (asset_id, tag)
  );
  CREATE INDEX idx_asset_tags_tag ON asset_tags(tag);
  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE collection_assets (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, asset_id)
  );
  CREATE TABLE generations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    batch_id TEXT,
    task TEXT NOT NULL,
    kind TEXT,
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    endpoint TEXT,
    prompt TEXT NOT NULL DEFAULT '',
    final_prompt TEXT,
    params_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    progress TEXT,
    provider_request_id TEXT,
    provider_status_url TEXT,
    provider_response_url TEXT,
    estimated_cost REAL,
    actual_cost REAL,
    cost_source TEXT,
    error TEXT,
    output_asset_ids TEXT NOT NULL DEFAULT '[]',
    result_json TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX idx_generations_user ON generations(user_id, created_at);
  CREATE INDEX idx_generations_status ON generations(status);
  CREATE TABLE loras (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    family TEXT NOT NULL,
    path TEXT NOT NULL,
    trigger_word TEXT,
    default_scale REAL NOT NULL DEFAULT 1,
    source TEXT NOT NULL,
    training_generation_id TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE datasets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    default_caption TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE dataset_images (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    source_note TEXT NOT NULL DEFAULT '',
    rights_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  `,
  /* 2 — job webhooks */ `
  ALTER TABLE generations ADD COLUMN webhook_url TEXT;
  ALTER TABLE user_settings ADD COLUMN webhook_secret TEXT;
  `,
  /* 3 — optional read-only billing key per provider (e.g. a fal.ai ADMIN key, used only to read the balance) */ `
  ALTER TABLE provider_keys ADD COLUMN billing_secret_enc TEXT;
  ALTER TABLE provider_keys ADD COLUMN billing_last4 TEXT;
  `,
];
