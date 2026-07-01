import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL ?? 'mysql://wip:wip_password@127.0.0.1:3306/wip_dev';

export const db = mysql.createPool(databaseUrl);

async function ensureColumn(connection: mysql.PoolConnection, table: string, column: string, definition: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column],
  );
  if (!rows[0]) {
    await connection.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function verifyDatabaseConnection(): Promise<void> {
  const connection = await db.getConnection();
  try {
    await connection.ping();
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        hashed_password VARCHAR(255) NOT NULL,
        nickname VARCHAR(80) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS channels (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        owner_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        role ENUM('owner', 'member') NOT NULL DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id),
        INDEX idx_workspace_members_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(36) PRIMARY KEY,
        channel_id VARCHAR(36) NOT NULL,
        author_id VARCHAR(36) NULL,
        author_name VARCHAR(120) NOT NULL,
        content TEXT NOT NULL,
        code_blocks JSON NULL,
        quote_ref JSON NULL,
        parent_id VARCHAR(36) NULL,
        thread_count INT NOT NULL DEFAULT 0,
        reactions JSON NULL,
        status ENUM('in-progress', 'completed') NOT NULL DEFAULT 'completed',
        message_kind ENUM('chat', 'task') NOT NULL DEFAULT 'chat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_messages_channel_parent_created (channel_id, parent_id, created_at),
        INDEX idx_messages_parent (parent_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS dm_messages (
        id VARCHAR(36) PRIMARY KEY,
        from_id VARCHAR(36) NOT NULL,
        from_name VARCHAR(120) NOT NULL,
        to_id VARCHAR(36) NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_dm_pair_created (from_id, to_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS dm_conversations (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(160) NOT NULL,
        created_by VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS dm_conversation_members (
        conversation_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (conversation_id, user_id),
        INDEX idx_dm_conversation_members_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS dm_conversation_messages (
        id VARCHAR(36) PRIMARY KEY,
        conversation_id VARCHAR(36) NOT NULL,
        from_id VARCHAR(36) NOT NULL,
        from_name VARCHAR(120) NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_dm_conversation_messages_created (conversation_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS friend_requests (
        id VARCHAR(36) PRIMARY KEY,
        from_id VARCHAR(36) NOT NULL,
        from_name VARCHAR(120) NOT NULL,
        to_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_friend_requests_users (from_id, to_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS friends (
        user_id VARCHAR(36) NOT NULL,
        friend_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, friend_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS snippets (
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
        INDEX idx_snippets_owner (owner_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token VARCHAR(128) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS reset_tokens (
        token VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id VARCHAR(36) PRIMARY KEY,
        settings JSON NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS github_connections (
        user_id VARCHAR(36) PRIMARY KEY,
        access_token TEXT NOT NULL,
        user_login VARCHAR(120) NULL,
        repo_full_name VARCHAR(255) NULL,
        repo_info JSON NULL,
        notifications JSON NULL,
        seen_ids JSON NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        user_id VARCHAR(36) NOT NULL,
        notification_id VARCHAR(128) NOT NULL,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, notification_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        type ENUM('mention', 'reply', 'status', 'friend', 'dm', 'workspace') NOT NULL,
        actor VARCHAR(120) NOT NULL,
        channel_id VARCHAR(36) NULL,
        preview VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notifications_user_created (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS channel_reads (
        user_id VARCHAR(36) NOT NULL,
        channel_id VARCHAR(36) NOT NULL,
        last_read_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, channel_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS dm_reads (
        user_id VARCHAR(36) NOT NULL,
        conversation_key VARCHAR(100) NOT NULL,
        last_read_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, conversation_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureColumn(connection, 'channels', 'workspace_id', 'VARCHAR(36) NULL');
    await ensureColumn(connection, 'channels', 'owner_id', 'VARCHAR(36) NULL');
    await ensureColumn(connection, 'messages', 'message_kind', "ENUM('chat', 'task') NOT NULL DEFAULT 'chat'");
    await ensureColumn(connection, 'messages', 'code_blocks', 'JSON NULL');
    await ensureColumn(connection, 'messages', 'quote_ref', 'JSON NULL');
    await ensureColumn(connection, 'messages', 'parent_id', 'VARCHAR(36) NULL');
    await ensureColumn(connection, 'messages', 'thread_count', 'INT NOT NULL DEFAULT 0');
    await ensureColumn(connection, 'messages', 'reactions', 'JSON NULL');
    await ensureColumn(connection, 'snippets', 'from_channel', 'VARCHAR(36) NULL');
    await ensureColumn(connection, 'refresh_tokens', 'expires_at', 'BIGINT NOT NULL DEFAULT 0');
  } finally {
    connection.release();
  }
}
