-- MySQL schema for WIP
-- Minimal relational model for users, channels, channel members, messages,
-- snippets, code blocks, and runner jobs.

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  hashed_password VARCHAR(255) NOT NULL,
  nickname VARCHAR(80) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channels (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NULL,
  name VARCHAR(120) NULL,
  description VARCHAR(255) NULL,
  type ENUM('public', 'private', 'dm') NOT NULL DEFAULT 'public',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workspaces (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE workspace_members (
  workspace_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role ENUM('owner', 'member') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  INDEX idx_workspace_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE channel_members (
  channel_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, user_id),
  CONSTRAINT fk_channel_members_channel
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_channel_members_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE messages (
  id VARCHAR(36) PRIMARY KEY,
  channel_id VARCHAR(36) NOT NULL,
  author_id VARCHAR(36) NULL,
  author_name VARCHAR(120) NOT NULL,
  content TEXT,
  code_blocks JSON NULL,
  quote_ref JSON NULL,
  parent_id VARCHAR(36) NULL,
  thread_count INT NOT NULL DEFAULT 0,
  reactions JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  status ENUM('in-progress', 'completed') NOT NULL DEFAULT 'completed',
  CONSTRAINT fk_messages_channel
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_author
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_messages_channel_created ON messages(channel_id, created_at);
CREATE INDEX idx_messages_parent ON messages(parent_id);

CREATE TABLE snippets (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  language VARCHAR(40) NOT NULL,
  file_name VARCHAR(255) NULL,
  code LONGTEXT NOT NULL,
  tags JSON NULL,
  from_channel VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_snippets_owner
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_snippets_owner ON snippets(owner_id);

CREATE TABLE code_blocks (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(36) NULL,
  snippet_id VARCHAR(36) NULL,
  language VARCHAR(40) NOT NULL,
  file_name VARCHAR(255) NULL,
  code LONGTEXT NOT NULL,
  original_code LONGTEXT NULL,
  modified_code LONGTEXT NULL,
  runner_output JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_code_blocks_message
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_code_blocks_snippet
    FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_code_blocks_message ON code_blocks(message_id);
CREATE INDEX idx_code_blocks_snippet ON code_blocks(snippet_id);
CREATE INDEX idx_code_blocks_language ON code_blocks(language);

CREATE TABLE runner_jobs (
  id VARCHAR(36) PRIMARY KEY,
  author_id VARCHAR(36) NULL,
  language VARCHAR(40) NOT NULL,
  code LONGTEXT NOT NULL,
  status ENUM('queued', 'running', 'completed', 'failed', 'timeout') NOT NULL DEFAULT 'queued',
  stdout LONGTEXT NULL,
  stderr LONGTEXT NULL,
  exit_code INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  CONSTRAINT fk_runner_jobs_author
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_runner_jobs_author_created ON runner_jobs(author_id, created_at);

CREATE TABLE dm_messages (
  id VARCHAR(36) PRIMARY KEY,
  from_id VARCHAR(36) NOT NULL,
  from_name VARCHAR(120) NOT NULL,
  to_id VARCHAR(36) NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dm_pair_created (from_id, to_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE friend_requests (
  id VARCHAR(36) PRIMARY KEY,
  from_id VARCHAR(36) NOT NULL,
  from_name VARCHAR(120) NOT NULL,
  to_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_friend_requests_users (from_id, to_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE friends (
  user_id VARCHAR(36) NOT NULL,
  friend_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE refresh_tokens (
  token VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reset_tokens (
  token VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_settings (
  user_id VARCHAR(36) PRIMARY KEY,
  settings JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE github_connections (
  user_id VARCHAR(36) PRIMARY KEY,
  access_token TEXT NOT NULL,
  user_login VARCHAR(120) NULL,
  repo_full_name VARCHAR(255) NULL,
  repo_info JSON NULL,
  notifications JSON NULL,
  seen_ids JSON NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_reads (
  user_id VARCHAR(36) NOT NULL,
  notification_id VARCHAR(128) NOT NULL,
  read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type ENUM('mention', 'reply', 'status', 'friend', 'dm', 'workspace') NOT NULL,
  actor VARCHAR(120) NOT NULL,
  channel_id VARCHAR(36) NULL,
  preview VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
