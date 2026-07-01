import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { RowDataPacket } from 'mysql2';
import { db } from './db.js';
import type {
  AppNotification,
  Channel,
  DmConversation,
  ChatMessage,
  DmMessage,
  FriendRequest,
  GitHubConnection,
  SearchResult,
  Snippet,
  StoredUser,
  User,
  UserSettings,
} from './types.js';

const defaultSettings: UserSettings = {
  theme: 'light',
  font: 'geist',
  density: 'default',
  notifications: {
    mention: true,
    reply: true,
    reaction: false,
    statusChange: true,
    dmNew: true,
    sound: false,
    desktop: false,
    email: false,
  },
};

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function verifyPassword(password: string, storedHash: string) {
  if (!storedHash.startsWith('scrypt$')) {
    return createHash('sha256').update(password).digest('hex') === storedHash;
  }
  const [, salt, expectedHex] = storedHash.split('$');
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toMs(value: Date | string | null | undefined) {
  return value ? new Date(value).getTime() : Date.now();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  nickname: string;
  hashed_password: string;
  created_at: Date | string;
}

interface ChannelRow extends RowDataPacket {
  id: string;
  workspace_id: string | null;
  name: string;
  description: string | null;
  created_at: Date | string;
  member_ids: string | null;
  owner_id: string | null;
}

interface MessageRow extends RowDataPacket {
  id: string;
  channel_id: string;
  author_id: string;
  author_name: string;
  content: string;
  code_blocks: unknown;
  quote_ref: unknown;
  parent_id: string | null;
  thread_count: number;
  reactions: unknown;
  status: ChatMessage['status'];
  message_kind: ChatMessage['kind'];
  created_at: Date | string;
  updated_at: Date | string | null;
}

interface DmMessageRow extends RowDataPacket {
  id: string;
  from_id: string;
  from_name: string;
  to_id?: string;
  conversation_id?: string;
  text: string;
  created_at: Date | string;
}

interface DmConversationRow extends RowDataPacket {
  id: string;
  name: string;
  member_ids: string | null;
  member_names: string | null;
  created_at: Date | string;
}

interface FriendRequestRow extends RowDataPacket {
  id: string;
  from_id: string;
  from_name: string;
  to_id: string;
  status: FriendRequest['status'];
  created_at: Date | string;
}

interface SnippetRow extends RowDataPacket {
  id: string;
  owner_id: string;
  title: string;
  language: Snippet['language'];
  file_name: string | null;
  code: string;
  tags: unknown;
  from_channel: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
}

function publicUser(user: StoredUser): User {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    createdAt: user.createdAt,
  };
}

function rowToStoredUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    passwordHash: row.hashed_password,
    createdAt: toMs(row.created_at),
  };
}

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    createdAt: toMs(row.created_at),
    memberIds: row.member_ids ? row.member_ids.split(',').filter(Boolean) : [],
    ownerId: row.owner_id ?? undefined,
  };
}

function rowToMessage(row: MessageRow): ChatMessage {
  const message: ChatMessage = {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    authorName: row.author_name,
    content: row.content,
    codeBlocks: parseJson(row.code_blocks, []),
    quoteRef: parseJson(row.quote_ref, undefined),
    parentId: row.parent_id ?? undefined,
    threadCount: row.thread_count,
    reactions: parseJson(row.reactions, undefined),
    createdAt: toMs(row.created_at),
    status: row.status,
    kind: row.message_kind ?? 'chat',
  };
  if (row.updated_at) message.updatedAt = toMs(row.updated_at);
  return message;
}

function rowToDmMessage(row: DmMessageRow): DmMessage {
  return {
    id: row.id,
    fromId: row.from_id,
    fromName: row.from_name,
    toId: row.to_id,
    conversationId: row.conversation_id,
    text: row.text,
    createdAt: toMs(row.created_at),
  };
}

function rowToDmConversation(row: DmConversationRow): DmConversation {
  return {
    id: row.id,
    name: row.name,
    memberIds: row.member_ids ? row.member_ids.split(',').filter(Boolean) : [],
    memberNames: row.member_names ? row.member_names.split(',').filter(Boolean) : [],
    createdAt: toMs(row.created_at),
  };
}

function rowToFriendRequest(row: FriendRequestRow): FriendRequest {
  return {
    id: row.id,
    fromId: row.from_id,
    fromName: row.from_name,
    toId: row.to_id,
    status: row.status,
    createdAt: toMs(row.created_at),
  };
}

function rowToSnippet(row: SnippetRow): Snippet {
  const snippet: Snippet = {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    language: row.language,
    code: row.code,
    fileName: row.file_name ?? undefined,
    tags: parseJson(row.tags, []),
    fromChannel: row.from_channel ?? undefined,
    createdAt: toMs(row.created_at),
  };
  if (row.updated_at) snippet.updatedAt = toMs(row.updated_at);
  return snippet;
}

async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const [rows] = await db.execute<UserRow[]>(
    'SELECT id, email, nickname, hashed_password, created_at FROM users WHERE email = ? LIMIT 1',
    [normalizeEmail(email)],
  );
  return rows[0] ? rowToStoredUser(rows[0]) : null;
}

async function findUserById(id: string): Promise<StoredUser | null> {
  const [rows] = await db.execute<UserRow[]>(
    'SELECT id, email, nickname, hashed_password, created_at FROM users WHERE id = ? LIMIT 1',
    [id],
  );
  return rows[0] ? rowToStoredUser(rows[0]) : null;
}

export const store = {
  async createUser(email: string, password: string, nickname: string): Promise<User> {
    const key = normalizeEmail(email);
    if (await findUserByEmail(key)) throw new Error('An account with this email already exists.');
    const user: StoredUser = {
      id: uuidv4(),
      email: key,
      nickname,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
    };
    const workspaceId = uuidv4();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'INSERT INTO users (id, email, hashed_password, nickname) VALUES (?, ?, ?, ?)',
        [user.id, user.email, user.passwordHash, user.nickname],
      );
      await connection.execute(
        'INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)',
        [workspaceId, `${user.nickname}'s workspace`, user.id],
      );
      await connection.execute(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')",
        [workspaceId, user.id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return publicUser(user);
  },

  async verifyUser(email: string, password: string): Promise<User> {
    const user = await findUserByEmail(email);
    if (!user) throw new Error('No account found with that email.');
    if (!verifyPassword(password, user.passwordHash)) throw new Error('Incorrect password.');
    return publicUser(user);
  },

  async getUserByEmail(email: string): Promise<User | null> {
    const user = await findUserByEmail(email);
    return user ? publicUser(user) : null;
  },

  async updateNickname(email: string, nickname: string): Promise<User> {
    const user = await findUserByEmail(email);
    if (!user) throw new Error('User not found.');
    await db.execute('UPDATE users SET nickname = ? WHERE email = ?', [nickname, user.email]);
    return { ...publicUser(user), nickname };
  },

  async deleteUser(email: string, password: string): Promise<void> {
    const user = await findUserByEmail(email);
    if (!user) throw new Error('User not found.');
    if (!verifyPassword(password, user.passwordHash)) throw new Error('Incorrect password.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM notification_reads WHERE user_id = ?', [user.id]);
      await connection.execute('DELETE FROM notifications WHERE user_id = ?', [user.id]);
      await connection.execute('DELETE FROM user_settings WHERE user_id = ?', [user.id]);
      await connection.execute('DELETE FROM github_connections WHERE user_id = ?', [user.id]);
      await connection.execute('DELETE FROM refresh_tokens WHERE user_id = ?', [user.id]);
      await connection.execute('DELETE FROM reset_tokens WHERE email = ?', [user.email]);
      await connection.execute('DELETE FROM friends WHERE user_id = ? OR friend_id = ?', [user.id, user.id]);
      await connection.execute('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?', [user.id, user.id]);
      await connection.execute('DELETE FROM dm_messages WHERE from_id = ? OR to_id = ?', [user.id, user.id]);
      await connection.execute('DELETE FROM channel_members WHERE user_id = ?', [user.id]);
      await connection.execute('DELETE FROM workspace_members WHERE user_id = ?', [user.id]);
      await connection.execute('DELETE FROM workspaces WHERE owner_id = ?', [user.id]);
      await connection.execute('DELETE FROM snippets WHERE owner_id = ?', [user.id]);
      await connection.execute(
        "UPDATE messages SET author_id = NULL, author_name = 'Deleted user' WHERE author_id = ?",
        [user.id],
      );
      await connection.execute('DELETE FROM users WHERE email = ?', [user.email]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async listUsers(excludeEmail?: string): Promise<User[]> {
    const params = excludeEmail ? [normalizeEmail(excludeEmail)] : [];
    const [rows] = await db.execute<UserRow[]>(
      `SELECT id, email, nickname, hashed_password, created_at
       FROM users ${excludeEmail ? 'WHERE email <> ?' : ''}
       ORDER BY created_at DESC`,
      params,
    );
    return rows.map(rowToStoredUser).map(publicUser);
  },

  async listFriendDirectory(userId: string): Promise<User[]> {
    const workspaceId = await this.getWorkspaceId(userId);
    const [rows] = await db.execute<UserRow[]>(
      `SELECT DISTINCT u.id, u.email, u.nickname, u.hashed_password, u.created_at
       FROM users u
       WHERE u.id <> ? AND (
         EXISTS (
           SELECT 1 FROM workspace_members wm
           WHERE wm.user_id = u.id AND wm.workspace_id = ?
         )
         OR EXISTS (
           SELECT 1 FROM friends f
           WHERE f.user_id = ? AND f.friend_id = u.id
         )
         OR EXISTS (
           SELECT 1 FROM friend_requests fr
           WHERE fr.status = 'pending'
             AND ((fr.from_id = ? AND fr.to_id = u.id) OR (fr.to_id = ? AND fr.from_id = u.id))
         )
       )
       ORDER BY u.nickname ASC`,
      [userId, workspaceId ?? '', userId, userId, userId],
    );
    return rows.map(rowToStoredUser).map(publicUser);
  },

  async getUserById(id: string): Promise<User | null> {
    const user = await findUserById(id);
    return user ? publicUser(user) : null;
  },

  async getWorkspaceId(userId: string): Promise<string | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT workspace_id FROM workspace_members
       WHERE user_id = ?
       ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END ASC, joined_at ASC
       LIMIT 1`,
      [userId],
    );
    if (rows[0]?.workspace_id) return String(rows[0].workspace_id);
    const user = await findUserById(userId);
    if (!user) return null;
    const workspaceId = uuidv4();
    await db.execute('INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)', [workspaceId, `${user.nickname}'s workspace`, user.id]);
    await db.execute("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')", [workspaceId, user.id]);
    return workspaceId;
  },

  async listWorkspaceMembers(userId: string): Promise<User[]> {
    const workspaceId = await this.getWorkspaceId(userId);
    if (!workspaceId) return [];
    const [rows] = await db.execute<UserRow[]>(
      `SELECT u.id, u.email, u.nickname, u.hashed_password, u.created_at
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ? AND u.id <> ?
       ORDER BY wm.joined_at ASC`,
      [workspaceId, userId],
    );
    return rows.map(rowToStoredUser).map(publicUser);
  },

  async listDmContacts(userId: string): Promise<User[]> {
    const workspaceId = await this.getWorkspaceId(userId);
    const [rows] = await db.execute<UserRow[]>(
      `SELECT DISTINCT u.id, u.email, u.nickname, u.hashed_password, u.created_at
       FROM users u
       WHERE u.id <> ? AND (
         EXISTS (
           SELECT 1 FROM workspace_members wm
           WHERE wm.user_id = u.id AND wm.workspace_id = ?
         )
         OR EXISTS (
           SELECT 1 FROM friends f
           WHERE f.user_id = ? AND f.friend_id = u.id
         )
       )
       ORDER BY u.nickname ASC`,
      [userId, workspaceId ?? '', userId],
    );
    return rows.map(rowToStoredUser).map(publicUser);
  },

  async shareWorkspace(userId1: string, userId2: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1
       FROM workspace_members wm1
       JOIN workspace_members wm2 ON wm2.workspace_id = wm1.workspace_id
       WHERE wm1.user_id = ? AND wm2.user_id = ?
       LIMIT 1`,
      [userId1, userId2],
    );
    return Boolean(rows[0]);
  },

  async addWorkspaceMember(actor: User, email: string): Promise<User> {
    const workspaceId = await this.getWorkspaceId(actor.id);
    if (!workspaceId) throw new Error('Workspace not found.');
    const target = await findUserByEmail(email);
    if (!target) throw new Error('No account found with that email.');
    if (target.id === actor.id) throw new Error('You are already in this workspace.');
    const [existing] = await db.execute<RowDataPacket[]>(
      'SELECT workspace_id FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1',
      [workspaceId, target.id],
    );
    if (existing[0]) throw new Error('User is already a workspace member.');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')",
        [workspaceId, target.id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await this.createNotification(target.id, 'workspace', actor.nickname, undefined, `${actor.nickname}님이 워크스페이스에 추가했습니다.`);
    return publicUser(target);
  },

  async createNotification(
    userId: string,
    type: AppNotification['type'],
    actor: string,
    channelId: string | undefined,
    preview: string,
  ): Promise<void> {
    await db.execute(
      'INSERT INTO notifications (id, user_id, type, actor, channel_id, preview) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), userId, type, actor, channelId ?? null, preview.slice(0, 255)],
    );
  },

  async search(userId: string, query: string, scope: 'all' | 'messages' | 'code' = 'all'): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results: SearchResult[] = [];
    const [messageRows] = await db.execute<(MessageRow & { channel_name: string })[]>(
      `SELECT m.id, m.channel_id, m.author_id, m.author_name, m.content, m.code_blocks, m.quote_ref,
        m.parent_id, m.thread_count, m.reactions, m.status, m.message_kind, m.created_at, m.updated_at, c.name AS channel_name
       FROM messages m
       JOIN channels c ON c.id = m.channel_id
       JOIN channel_members mine ON mine.channel_id = c.id AND mine.user_id = ?
       ORDER BY m.created_at DESC
       LIMIT 500`,
      [userId],
    );
    for (const row of messageRows) {
      const message = rowToMessage(row);
      if ((scope === 'all' || scope === 'messages') && message.content.toLowerCase().includes(q)) {
        results.push({
          type: 'message',
          messageId: message.id,
          channelId: message.channelId,
          channelName: row.channel_name,
          authorName: message.authorName,
          snippet: message.content,
          ts: message.createdAt,
        });
      }
      if (scope === 'all' || scope === 'code') {
        for (const block of message.codeBlocks) {
          if (`${block.fileName ?? ''}\n${block.code}`.toLowerCase().includes(q)) {
            results.push({
              type: 'code',
              messageId: message.id,
              channelId: message.channelId,
              channelName: row.channel_name,
              authorName: message.authorName,
              snippet: block.code,
              codeLanguage: block.language,
              fileName: block.fileName,
              ts: message.createdAt,
            });
          }
        }
      }
    }
    if (scope === 'all' || scope === 'code') {
      const snippets = await this.listSnippets(userId);
      for (const snippet of snippets) {
        if (`${snippet.title}\n${snippet.fileName ?? ''}\n${snippet.code}`.toLowerCase().includes(q)) {
          results.push({
            type: 'code',
            messageId: snippet.id,
            channelId: 'snippets',
            channelName: 'snippets',
            authorName: snippet.title,
            snippet: snippet.code,
            codeLanguage: snippet.language,
            fileName: snippet.fileName,
            ts: snippet.createdAt,
          });
        }
      }
    }
    return results.sort((a, b) => b.ts - a.ts).slice(0, 100);
  },

  async getDmMessages(userId1: string, userId2: string): Promise<DmMessage[]> {
    if (!(await this.shareWorkspace(userId1, userId2)) && !(await this.isFriend(userId1, userId2))) {
      throw new Error('DM recipient must be a workspace member or friend.');
    }
    const [rows] = await db.execute<DmMessageRow[]>(
      `SELECT id, from_id, from_name, to_id, text, created_at
       FROM dm_messages
       WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
       ORDER BY created_at ASC`,
      [userId1, userId2, userId2, userId1],
    );
    return rows.map(rowToDmMessage);
  },

  async createDmMessage(fromId: string, fromName: string, toId: string, text: string): Promise<DmMessage> {
    if (!(await findUserById(toId))) throw new Error('DM recipient not found.');
    if (!(await this.shareWorkspace(fromId, toId)) && !(await this.isFriend(fromId, toId))) {
      throw new Error('DM recipient must be a workspace member or friend.');
    }
    const msg: DmMessage = { id: uuidv4(), fromId, fromName, toId, text, createdAt: Date.now() };
    await db.execute(
      'INSERT INTO dm_messages (id, from_id, from_name, to_id, text) VALUES (?, ?, ?, ?, ?)',
      [msg.id, msg.fromId, msg.fromName, toId, msg.text],
    );
    await this.createNotification(toId, 'dm', fromName, undefined, text);
    return msg;
  },

  async listDmConversations(userId: string): Promise<DmConversation[]> {
    const [rows] = await db.execute<DmConversationRow[]>(
      `SELECT dc.id, dc.name, dc.created_at,
        GROUP_CONCAT(dcm.user_id ORDER BY dcm.joined_at) AS member_ids,
        GROUP_CONCAT(u.nickname ORDER BY dcm.joined_at) AS member_names
       FROM dm_conversations dc
       JOIN dm_conversation_members mine ON mine.conversation_id = dc.id AND mine.user_id = ?
       JOIN dm_conversation_members dcm ON dcm.conversation_id = dc.id
       JOIN users u ON u.id = dcm.user_id
       GROUP BY dc.id, dc.name, dc.created_at
       ORDER BY dc.created_at DESC`,
      [userId],
    );
    return rows.map(rowToDmConversation);
  },

  async createDmConversation(actor: User, name: string | undefined, memberIds: string[]): Promise<DmConversation> {
    const ids = [...new Set(memberIds.filter((id) => id && id !== actor.id))];
    if (ids.length < 1) throw new Error('Select at least one DM member.');
    const allowed = await this.listDmContacts(actor.id);
    const allowedIds = new Set(allowed.map((user) => user.id));
    if (ids.some((id) => !allowedIds.has(id))) {
      throw new Error('Group DM members must be workspace members or friends.');
    }

    const conversationId = uuidv4();
    const allMemberIds = [actor.id, ...ids];
    const title = name?.trim() || allowed.filter((user) => ids.includes(user.id)).map((user) => user.nickname).join(', ');
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'INSERT INTO dm_conversations (id, name, created_by) VALUES (?, ?, ?)',
        [conversationId, title.slice(0, 160), actor.id],
      );
      for (const memberId of allMemberIds) {
        await connection.execute(
          'INSERT INTO dm_conversation_members (conversation_id, user_id) VALUES (?, ?)',
          [conversationId, memberId],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    for (const memberId of ids) {
      await this.createNotification(memberId, 'dm', actor.nickname, undefined, `${actor.nickname}님이 단체 DM에 초대했습니다.`);
    }
    return (await this.getDmConversation(conversationId, actor.id))!;
  },

  async getDmConversation(conversationId: string, userId: string): Promise<DmConversation | null> {
    const [rows] = await db.execute<DmConversationRow[]>(
      `SELECT dc.id, dc.name, dc.created_at,
        GROUP_CONCAT(dcm.user_id ORDER BY dcm.joined_at) AS member_ids,
        GROUP_CONCAT(u.nickname ORDER BY dcm.joined_at) AS member_names
       FROM dm_conversations dc
       JOIN dm_conversation_members mine ON mine.conversation_id = dc.id AND mine.user_id = ?
       JOIN dm_conversation_members dcm ON dcm.conversation_id = dc.id
       JOIN users u ON u.id = dcm.user_id
       WHERE dc.id = ?
       GROUP BY dc.id, dc.name, dc.created_at
       LIMIT 1`,
      [userId, conversationId],
    );
    return rows[0] ? rowToDmConversation(rows[0]) : null;
  },

  async getDmConversationMessages(conversationId: string, userId: string): Promise<DmMessage[]> {
    if (!(await this.getDmConversation(conversationId, userId))) throw new Error('DM conversation not found.');
    const [rows] = await db.execute<DmMessageRow[]>(
      `SELECT id, conversation_id, from_id, from_name, NULL AS to_id, text, created_at
       FROM dm_conversation_messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
      [conversationId],
    );
    return rows.map(rowToDmMessage);
  },

  async createDmConversationMessage(conversationId: string, fromId: string, fromName: string, text: string): Promise<DmMessage> {
    const conversation = await this.getDmConversation(conversationId, fromId);
    if (!conversation) throw new Error('DM conversation not found.');
    const msg: DmMessage = { id: uuidv4(), conversationId, fromId, fromName, text, createdAt: Date.now() };
    await db.execute(
      'INSERT INTO dm_conversation_messages (id, conversation_id, from_id, from_name, text) VALUES (?, ?, ?, ?, ?)',
      [msg.id, conversationId, fromId, fromName, text],
    );
    for (const memberId of conversation.memberIds) {
      if (memberId === fromId) continue;
      await this.createNotification(memberId, 'dm', fromName, undefined, text);
    }
    return msg;
  },

  async listChannels(userId: string): Promise<Channel[]> {
    const [rows] = await db.execute<ChannelRow[]>(`
      SELECT c.id, c.name, c.description, c.created_at, c.owner_id,
        GROUP_CONCAT(cm.user_id ORDER BY cm.joined_at) AS member_ids
      FROM channels c
      JOIN channel_members mine ON mine.channel_id = c.id AND mine.user_id = ?
      LEFT JOIN channel_members cm ON cm.channel_id = c.id
      GROUP BY c.id, c.name, c.description, c.created_at, c.owner_id
      ORDER BY c.created_at ASC
    `, [userId]);
    return rows.map(rowToChannel);
  },

  async createChannel(name: string, description: string, creatorId: string, memberIds: string[] = []): Promise<Channel> {
    const workspaceId = await this.getWorkspaceId(creatorId);
    if (!workspaceId) throw new Error('Workspace not found.');
    const [existing] = await db.execute<ChannelRow[]>(
      'SELECT id, workspace_id, name, description, created_at, owner_id, NULL AS member_ids FROM channels WHERE workspace_id = ? AND name = ? LIMIT 1',
      [workspaceId, name],
    );
    if (existing[0]) return rowToChannel(existing[0]);
    const selectedMemberIds = [...new Set([creatorId, ...memberIds].filter(Boolean))];
    if (selectedMemberIds.length > 0) {
      const placeholders = selectedMemberIds.map(() => '?').join(', ');
      const [memberRows] = await db.execute<RowDataPacket[]>(
        `SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id IN (${placeholders})`,
        [workspaceId, ...selectedMemberIds],
      );
      if (memberRows.length !== selectedMemberIds.length) {
        throw new Error('Only workspace members can be added to a channel.');
      }
    }
    const channel: Channel = {
      id: `ch-${uuidv4().slice(0, 8)}`,
      name,
      description,
      createdAt: Date.now(),
      memberIds: selectedMemberIds,
      ownerId: creatorId,
    };
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('INSERT INTO channels (id, workspace_id, name, description, owner_id) VALUES (?, ?, ?, ?, ?)', [channel.id, workspaceId, name, description, creatorId]);
      for (const memberId of selectedMemberIds) {
        await connection.execute('INSERT IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)', [channel.id, memberId]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return channel;
  },

  async addChannelMember(channelId: string, userId: string): Promise<void> {
    await db.execute('INSERT IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)', [channelId, userId]);
  },

  async inviteChannelMember(channelId: string, actorId: string, userId: string): Promise<User> {
    if (!(await this.canAccessChannel(channelId, actorId))) throw new Error('Channel is not accessible.');
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT u.id
       FROM channels c
       JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
       JOIN users u ON u.id = wm.user_id
       WHERE c.id = ? AND u.id = ?
       LIMIT 1`,
      [channelId, userId],
    );
    if (!rows[0]) throw new Error('Only workspace members can be added to a channel.');
    await this.addChannelMember(channelId, userId);
    const user = await findUserById(userId);
    if (!user) throw new Error('User not found.');
    const actor = await findUserById(actorId);
    if (actorId !== userId) {
      await this.createNotification(userId, 'workspace', actor?.nickname ?? 'Workspace member', channelId, '채널에 추가되었습니다.');
    }
    return publicUser(user);
  },

  async getMessageChannelId(messageId: string): Promise<string | null> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT channel_id FROM messages WHERE id = ? LIMIT 1', [messageId]);
    return rows[0]?.channel_id ? String(rows[0].channel_id) : null;
  },

  async getChannelMembers(channelId: string): Promise<User[]> {
    const [rows] = await db.execute<UserRow[]>(
      `SELECT u.id, u.email, u.nickname, u.hashed_password, u.created_at
       FROM channel_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.channel_id = ?
       ORDER BY cm.joined_at ASC`,
      [channelId],
    );
    return rows.map(rowToStoredUser).map(publicUser);
  },

  async listMessages(channelId: string, options?: { before?: string; limit?: number }): Promise<ChatMessage[]> {
    const limit = options?.limit ?? 100;
    const params: Array<string | number | Date> = [channelId];
    let beforeClause = '';
    if (options?.before) {
      const [beforeRows] = await db.execute<MessageRow[]>('SELECT created_at FROM messages WHERE id = ? LIMIT 1', [options.before]);
      if (beforeRows[0]) {
        beforeClause = 'AND created_at < ?';
        params.push(beforeRows[0].created_at);
      }
    }
    const [rows] = await db.execute<MessageRow[]>(
      `SELECT id, channel_id, author_id, author_name, content, code_blocks, quote_ref, parent_id,
        thread_count, reactions, status, message_kind, created_at, updated_at
       FROM messages
       WHERE channel_id = ? AND parent_id IS NULL ${beforeClause}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params,
    );
    return rows.map(rowToMessage).reverse();
  },

  async createMessage(input: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
    const [channelRows] = await db.execute<RowDataPacket[]>('SELECT id, workspace_id FROM channels WHERE id = ? LIMIT 1', [input.channelId]);
    if (!channelRows[0]) throw new Error('Channel not found.');
    if (!(await this.canAccessChannel(input.channelId, input.authorId))) throw new Error('You are not a channel member.');
    const kind = input.kind === 'task' ? 'task' : 'chat';
    const status = kind === 'task' && input.status === 'completed' ? 'completed' : kind === 'task' ? 'in-progress' : 'completed';
    const message: ChatMessage = { ...input, kind, status, id: uuidv4(), createdAt: Date.now() };
    await db.execute(
      `INSERT INTO messages
       (id, channel_id, author_id, author_name, content, code_blocks, quote_ref, parent_id, thread_count, reactions, status, message_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.channelId,
        message.authorId,
        message.authorName,
        message.content,
        JSON.stringify(message.codeBlocks ?? []),
        message.quoteRef ? JSON.stringify(message.quoteRef) : null,
        message.parentId ?? null,
        message.threadCount ?? 0,
        message.reactions ? JSON.stringify(message.reactions) : null,
        message.status,
        message.kind,
      ],
    );
    await this.addChannelMember(message.channelId, message.authorId);
    const channelMembers = await this.getChannelMembers(message.channelId);
    const notifiedIds = new Set<string>();

    // 멘션 알림 (채널 멤버 한정)
    for (const member of channelMembers) {
      if (member.id === message.authorId) continue;
      if (message.content.includes(`@${member.nickname}`)) {
        await this.createNotification(member.id, 'mention', message.authorName, message.channelId, message.content);
        notifiedIds.add(member.id);
      }
    }

    // 인용 알림
    if (message.quoteRef) {
      const [quotedRows] = await db.execute<RowDataPacket[]>('SELECT author_id FROM messages WHERE id = ? LIMIT 1', [message.quoteRef.messageId]);
      const quotedAuthorId = quotedRows[0]?.author_id ? String(quotedRows[0].author_id) : null;
      if (quotedAuthorId && quotedAuthorId !== message.authorId && !notifiedIds.has(quotedAuthorId)) {
        await this.createNotification(quotedAuthorId, 'reply', message.authorName, message.channelId, message.content);
        notifiedIds.add(quotedAuthorId);
      }
    }

    // 일반 채널 알림 (이미 더 구체적인 알림을 받은 멤버는 제외)
    for (const member of channelMembers) {
      if (member.id === message.authorId || notifiedIds.has(member.id)) continue;
      await this.createNotification(
        member.id,
        message.kind === 'task' ? 'status' : 'workspace',
        message.authorName,
        message.channelId,
        message.kind === 'task'
          ? `${message.authorName}님이 새 업무를 등록했습니다: ${message.content}`
          : `${message.authorName}님이 채팅을 보냈습니다: ${message.content}`,
      );
    }
    return message;
  },

  async createThreadMessage(parentId: string, input: Omit<ChatMessage, 'id' | 'createdAt' | 'parentId'>): Promise<ChatMessage> {
    const [parentRows] = await db.execute<RowDataPacket[]>('SELECT id, channel_id FROM messages WHERE id = ? LIMIT 1', [parentId]);
    if (!parentRows[0]) throw new Error('Parent message not found.');
    if (String(parentRows[0].channel_id) !== input.channelId) throw new Error('Thread channel does not match its parent message.');
    const message = await this.createMessage({ ...input, parentId });
    await db.execute('UPDATE messages SET thread_count = thread_count + 1 WHERE id = ?', [parentId]);
    return message;
  },

  async listThreadMessages(parentId: string): Promise<ChatMessage[]> {
    const [rows] = await db.execute<MessageRow[]>(
      `SELECT id, channel_id, author_id, author_name, content, code_blocks, quote_ref, parent_id,
        thread_count, reactions, status, message_kind, created_at, updated_at
       FROM messages
       WHERE parent_id = ?
       ORDER BY created_at ASC`,
      [parentId],
    );
    return rows.map(rowToMessage);
  },

  async updateMessage(id: string, patch: Partial<ChatMessage>, actorId: string): Promise<ChatMessage> {
    const [rows] = await db.execute<MessageRow[]>(
      `SELECT id, channel_id, author_id, author_name, content, code_blocks, quote_ref, parent_id,
        thread_count, reactions, status, message_kind, created_at, updated_at
       FROM messages WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new Error('Message not found.');
    const existing = rowToMessage(rows[0]);
    if (existing.authorId !== actorId) throw new Error('You can only update your own messages.');
    const next = {
      ...existing,
      ...(typeof patch.content === 'string' ? { content: patch.content } : {}),
      ...(Array.isArray(patch.codeBlocks) ? { codeBlocks: patch.codeBlocks } : {}),
      ...(patch.quoteRef !== undefined ? { quoteRef: patch.quoteRef } : {}),
      ...(patch.reactions !== undefined ? { reactions: patch.reactions } : {}),
      ...(patch.kind === 'chat' || patch.kind === 'task' ? { kind: patch.kind } : {}),
      ...(patch.status === 'in-progress' || patch.status === 'completed' ? { status: patch.status } : {}),
      updatedAt: Date.now(),
    };
    if (next.kind === 'chat') next.status = 'completed';
    await db.execute(
      `UPDATE messages
       SET content = ?, code_blocks = ?, quote_ref = ?, thread_count = ?, reactions = ?, status = ?, message_kind = ?
       WHERE id = ?`,
      [
        next.content,
        JSON.stringify(next.codeBlocks ?? []),
        next.quoteRef ? JSON.stringify(next.quoteRef) : null,
        next.threadCount ?? 0,
        next.reactions ? JSON.stringify(next.reactions) : null,
        next.status,
        next.kind,
        id,
      ],
    );
    if (next.kind === 'task' && existing.status !== 'completed' && next.status === 'completed') {
      const members = await this.getChannelMembers(next.channelId);
      for (const member of members) {
        if (member.id === actorId) continue;
        await this.createNotification(member.id, 'status', next.authorName, next.channelId, `${next.authorName}님이 작업을 완료했습니다.`);
      }
    }
    return next;
  },

  async storeRefreshToken(token: string, userId: string): Promise<void> {
    await db.execute('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, Date.now() + 30 * 24 * 60 * 60 * 1000]);
  },

  async validateRefreshToken(token: string): Promise<string | null> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT user_id FROM refresh_tokens WHERE token = ? AND expires_at > ? LIMIT 1', [token, Date.now()]);
    return rows[0]?.user_id ? String(rows[0].user_id) : null;
  },

  async revokeRefreshToken(token: string): Promise<void> {
    await db.execute('DELETE FROM refresh_tokens WHERE token = ?', [token]);
  },

  async createResetToken(email: string): Promise<string> {
    const key = normalizeEmail(email);
    if (!(await findUserByEmail(key))) throw new Error('No account found with that email.');
    const token = uuidv4();
    await db.execute('INSERT INTO reset_tokens (token, email, expires_at) VALUES (?, ?, ?)', [token, key, Date.now() + 15 * 60 * 1000]);
    return token;
  },

  async applyResetToken(token: string, newPassword: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT email, expires_at FROM reset_tokens WHERE token = ? LIMIT 1', [token]);
    const entry = rows[0] ? { email: String(rows[0].email), expires: Number(rows[0].expires_at) } : null;
    if (!entry) throw new Error('Invalid reset token.');
    if (Date.now() > entry.expires) {
      await db.execute('DELETE FROM reset_tokens WHERE token = ?', [token]);
      throw new Error('Reset token has expired.');
    }
    await db.execute('UPDATE users SET hashed_password = ? WHERE email = ?', [hashPassword(newPassword), entry.email]);
    await db.execute('DELETE FROM reset_tokens WHERE token = ?', [token]);
  },

  async changePassword(email: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await findUserByEmail(email);
    if (!user) throw new Error('User not found.');
    if (!verifyPassword(currentPassword, user.passwordHash)) throw new Error('Current password is incorrect.');
    await db.execute('UPDATE users SET hashed_password = ? WHERE email = ?', [hashPassword(newPassword), user.email]);
  },

  async sendFriendRequest(fromId: string, fromName: string, toId: string): Promise<FriendRequest> {
    if (fromId === toId) throw new Error('Cannot send a friend request to yourself.');
    if (await this.isFriend(fromId, toId)) throw new Error('Already friends.');
    const [existing] = await db.execute<FriendRequestRow[]>(
      `SELECT id, from_id, from_name, to_id, status, created_at
       FROM friend_requests
       WHERE status = 'pending' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
       LIMIT 1`,
      [fromId, toId, toId, fromId],
    );
    if (existing[0]) throw new Error('A pending friend request already exists.');
    const request: FriendRequest = { id: uuidv4(), fromId, fromName, toId, status: 'pending', createdAt: Date.now() };
    await db.execute(
      'INSERT INTO friend_requests (id, from_id, from_name, to_id, status) VALUES (?, ?, ?, ?, ?)',
      [request.id, request.fromId, request.fromName, request.toId, request.status],
    );
    await this.createNotification(toId, 'friend', fromName, undefined, `${fromName}님이 친구 요청을 보냈습니다.`);
    return request;
  },

  async acceptFriendRequest(requestId: string, userId: string): Promise<string> {
    const [rows] = await db.execute<FriendRequestRow[]>(
      'SELECT id, from_id, from_name, to_id, status, created_at FROM friend_requests WHERE id = ? LIMIT 1',
      [requestId],
    );
    const req = rows[0] ? rowToFriendRequest(rows[0]) : null;
    if (!req || req.toId !== userId || req.status !== 'pending') throw new Error('Friend request not found.');
    await db.execute('UPDATE friend_requests SET status = ? WHERE id = ?', ['accepted', requestId]);
    await db.execute('INSERT IGNORE INTO friends (user_id, friend_id) VALUES (?, ?), (?, ?)', [req.fromId, req.toId, req.toId, req.fromId]);
    const accepter = await findUserById(userId);
    await this.createNotification(
      req.fromId,
      'friend',
      accepter?.nickname ?? 'Friend',
      undefined,
      `${accepter?.nickname ?? '상대방'}님이 친구 요청을 수락했습니다.`,
    );
    return req.fromId;
  },

  async declineFriendRequest(requestId: string, userId: string): Promise<void> {
    const [rows] = await db.execute<FriendRequestRow[]>(
      'SELECT id, from_id, from_name, to_id, status, created_at FROM friend_requests WHERE id = ? LIMIT 1',
      [requestId],
    );
    const req = rows[0] ? rowToFriendRequest(rows[0]) : null;
    if (!req || req.toId !== userId || req.status !== 'pending') throw new Error('Friend request not found.');
    await db.execute('UPDATE friend_requests SET status = ? WHERE id = ?', ['declined', requestId]);
  },

  async cancelFriendRequest(requestId: string, userId: string): Promise<void> {
    const [rows] = await db.execute<FriendRequestRow[]>(
      'SELECT id, from_id, from_name, to_id, status, created_at FROM friend_requests WHERE id = ? LIMIT 1',
      [requestId],
    );
    const req = rows[0] ? rowToFriendRequest(rows[0]) : null;
    if (!req || req.fromId !== userId || req.status !== 'pending') throw new Error('Friend request not found.');
    await db.execute('DELETE FROM friend_requests WHERE id = ?', [requestId]);
  },

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await db.execute('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [userId, friendId, friendId, userId]);
    await db.execute('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', [userId, friendId, friendId, userId]);
  },

  async getFriends(userId: string): Promise<User[]> {
    const [rows] = await db.execute<UserRow[]>(
      `SELECT u.id, u.email, u.nickname, u.hashed_password, u.created_at
       FROM friends f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`,
      [userId],
    );
    return rows.map(rowToStoredUser).map(publicUser);
  },

  async getPendingReceivedRequests(userId: string): Promise<FriendRequest[]> {
    const [rows] = await db.execute<FriendRequestRow[]>(
      'SELECT id, from_id, from_name, to_id, status, created_at FROM friend_requests WHERE to_id = ? AND status = ? ORDER BY created_at DESC',
      [userId, 'pending'],
    );
    return rows.map(rowToFriendRequest);
  },

  async getPendingSentRequests(userId: string): Promise<FriendRequest[]> {
    const [rows] = await db.execute<FriendRequestRow[]>(
      'SELECT id, from_id, from_name, to_id, status, created_at FROM friend_requests WHERE from_id = ? AND status = ? ORDER BY created_at DESC',
      [userId, 'pending'],
    );
    return rows.map(rowToFriendRequest);
  },

  async isFriend(userId: string, otherId: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT user_id FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1', [userId, otherId]);
    return !!rows[0];
  },

  async channelExists(channelId: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM channels WHERE id = ? LIMIT 1', [channelId]);
    return !!rows[0];
  },

  async canAccessChannel(channelId: string, userId: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT channel_id
       FROM channel_members
       WHERE channel_id = ? AND user_id = ?
       LIMIT 1`,
      [channelId, userId],
    );
    return !!rows[0];
  },

  async getSettings(userId: string): Promise<UserSettings> {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT settings FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
    const stored = parseJson<Partial<UserSettings>>(rows[0]?.settings, {});
    return {
      ...defaultSettings,
      ...stored,
      notifications: { ...defaultSettings.notifications, ...stored.notifications },
    };
  },

  async updateSettings(userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings(userId);
    const settings: UserSettings = {
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...patch.notifications },
    };
    await db.execute(
      `INSERT INTO user_settings (user_id, settings) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE settings = VALUES(settings)`,
      [userId, JSON.stringify(settings)],
    );
    return settings;
  },

  async getGitHubConnection(userId: string): Promise<GitHubConnection | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT access_token, user_login, repo_full_name, repo_info, notifications, seen_ids, updated_at
       FROM github_connections
       WHERE user_id = ?
       LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      token: String(row.access_token),
      userLogin: row.user_login ? String(row.user_login) : null,
      repoFullName: row.repo_full_name ? String(row.repo_full_name) : '',
      repoInfo: parseJson(row.repo_info, null),
      notifications: parseJson(row.notifications, []),
      seenIds: parseJson(row.seen_ids, []),
      updatedAt: row.updated_at ? toMs(row.updated_at as Date | string) : undefined,
    };
  },

  async upsertGitHubConnection(userId: string, input: GitHubConnection): Promise<GitHubConnection> {
    const next: GitHubConnection = {
      token: input.token,
      userLogin: input.userLogin ?? null,
      repoFullName: input.repoFullName ?? '',
      repoInfo: input.repoInfo ?? null,
      notifications: input.notifications ?? [],
      seenIds: input.seenIds ?? [],
    };
    await db.execute(
      `INSERT INTO github_connections
        (user_id, access_token, user_login, repo_full_name, repo_info, notifications, seen_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        access_token = VALUES(access_token),
        user_login = VALUES(user_login),
        repo_full_name = VALUES(repo_full_name),
        repo_info = VALUES(repo_info),
        notifications = VALUES(notifications),
        seen_ids = VALUES(seen_ids)`,
      [
        userId,
        next.token,
        next.userLogin,
        next.repoFullName || null,
        JSON.stringify(next.repoInfo),
        JSON.stringify(next.notifications),
        JSON.stringify(next.seenIds),
      ],
    );
    return (await this.getGitHubConnection(userId)) ?? next;
  },

  async deleteGitHubConnection(userId: string): Promise<void> {
    await db.execute('DELETE FROM github_connections WHERE user_id = ?', [userId]);
  },

  async getNotifications(user: User): Promise<AppNotification[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT n.id, n.type, n.actor, n.channel_id, n.preview, n.created_at,
        nr.notification_id IS NOT NULL AS is_read
       FROM notifications n
       LEFT JOIN notification_reads nr ON nr.user_id = n.user_id AND nr.notification_id = n.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 200`,
      [user.id],
    );
    return rows.map((row) => ({
      id: String(row.id),
      type: row.type as AppNotification['type'],
      actor: String(row.actor),
      channelId: row.channel_id ? String(row.channel_id) : undefined,
      preview: String(row.preview),
      ts: toMs(row.created_at as Date | string),
      read: Boolean(row.is_read),
    }));
  },

  async markNotificationsRead(userId: string, notificationIds: string[]): Promise<void> {
    const ids = [...new Set(notificationIds.filter(Boolean))];
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '(?, ?)').join(', ');
    await db.execute(
      `INSERT IGNORE INTO notification_reads (user_id, notification_id) VALUES ${placeholders}`,
      ids.flatMap((id) => [userId, id]),
    );
  },

  async createSnippet(ownerId: string, data: Omit<Snippet, 'id' | 'ownerId' | 'createdAt'>): Promise<Snippet> {
    const snippet: Snippet = { ...data, id: uuidv4(), ownerId, createdAt: Date.now() };
    await db.execute(
      `INSERT INTO snippets (id, owner_id, title, language, file_name, code, tags, from_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snippet.id,
        ownerId,
        snippet.title,
        snippet.language,
        snippet.fileName ?? null,
        snippet.code,
        JSON.stringify(snippet.tags ?? []),
        snippet.fromChannel ?? null,
      ],
    );
    return snippet;
  },

  async listSnippets(ownerId: string): Promise<Snippet[]> {
    const [rows] = await db.execute<SnippetRow[]>(
      `SELECT id, owner_id, title, language, file_name, code, tags, from_channel, created_at, updated_at
       FROM snippets
       WHERE owner_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
      [ownerId],
    );
    return rows.map(rowToSnippet);
  },

  async updateSnippet(id: string, ownerId: string, patch: Partial<Snippet>): Promise<Snippet> {
    const [rows] = await db.execute<SnippetRow[]>(
      'SELECT id, owner_id, title, language, file_name, code, tags, from_channel, created_at, updated_at FROM snippets WHERE id = ? LIMIT 1',
      [id],
    );
    const existing = rows[0] ? rowToSnippet(rows[0]) : null;
    if (!existing) throw new Error('Snippet not found.');
    if (existing.ownerId !== ownerId) throw new Error('Not authorized.');
    const updated: Snippet = { ...existing, ...patch, id, ownerId, updatedAt: Date.now() };
    await db.execute(
      `UPDATE snippets
       SET title = ?, language = ?, file_name = ?, code = ?, tags = ?, from_channel = ?
       WHERE id = ? AND owner_id = ?`,
      [
        updated.title,
        updated.language,
        updated.fileName ?? null,
        updated.code,
        JSON.stringify(updated.tags ?? []),
        updated.fromChannel ?? null,
        id,
        ownerId,
      ],
    );
    return updated;
  },

  async deleteSnippet(id: string, ownerId: string): Promise<void> {
    const [result] = await db.execute<RowDataPacket[]>('SELECT id FROM snippets WHERE id = ? AND owner_id = ? LIMIT 1', [id, ownerId]);
    if (!result[0]) throw new Error('Snippet not found.');
    await db.execute('DELETE FROM snippets WHERE id = ? AND owner_id = ?', [id, ownerId]);
  },

  async getChannelById(channelId: string): Promise<Channel | null> {
    const [rows] = await db.execute<ChannelRow[]>(
      'SELECT id, workspace_id, name, description, created_at, owner_id, NULL AS member_ids FROM channels WHERE id = ? LIMIT 1',
      [channelId],
    );
    return rows[0] ? rowToChannel(rows[0]) : null;
  },

  async updateChannel(channelId: string, actorId: string, patch: { name?: string; description?: string }): Promise<Channel> {
    const channel = await this.getChannelById(channelId);
    if (!channel) throw new Error('Channel not found.');
    if (channel.ownerId && channel.ownerId !== actorId) throw new Error('Only the channel owner can edit this channel.');
    const name = patch.name ? patch.name.trim().toLowerCase().replace(/\s+/g, '-') : channel.name;
    const description = patch.description !== undefined ? patch.description : (channel.description ?? '');
    await db.execute('UPDATE channels SET name = ?, description = ? WHERE id = ?', [name, description, channelId]);
    return { ...channel, name, description };
  },

  async deleteChannel(channelId: string, actorId: string): Promise<void> {
    const channel = await this.getChannelById(channelId);
    if (!channel) throw new Error('Channel not found.');
    if (channel.ownerId && channel.ownerId !== actorId) throw new Error('Only the channel owner can delete this channel.');
    await db.execute('DELETE FROM messages WHERE channel_id = ?', [channelId]);
    await db.execute('DELETE FROM channel_members WHERE channel_id = ?', [channelId]);
    await db.execute('DELETE FROM channels WHERE id = ?', [channelId]);
  },

  async leaveChannel(channelId: string, userId: string): Promise<void> {
    const channel = await this.getChannelById(channelId);
    if (!channel) throw new Error('Channel not found.');
    if (channel.ownerId === userId) throw new Error('Channel owner cannot leave — delete the channel instead.');
    await db.execute('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?', [channelId, userId]);
  },

  // ─── Read Receipts ────────────────────────────────────────────────────────

  async markChannelRead(userId: string, channelId: string): Promise<void> {
    await db.execute(
      `INSERT INTO channel_reads (user_id, channel_id, last_read_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_read_at = VALUES(last_read_at)`,
      [userId, channelId, Date.now()],
    );
  },

  async markDmRead(userId: string, conversationKey: string): Promise<void> {
    await db.execute(
      `INSERT INTO dm_reads (user_id, conversation_key, last_read_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_read_at = VALUES(last_read_at)`,
      [userId, conversationKey, Date.now()],
    );
  },

  async getUnreadChannelIds(userId: string): Promise<string[]> {
    // 채널에서 내가 보낸 것이 아닌 메시지 중, 내 last_read_at 이후에 온 게 하나라도 있으면 unread
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT m.channel_id
       FROM messages m
       INNER JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?
       LEFT JOIN channel_reads cr ON cr.channel_id = m.channel_id AND cr.user_id = ?
       WHERE m.parent_id IS NULL
         AND m.author_id != ?
         AND UNIX_TIMESTAMP(m.created_at) * 1000 > COALESCE(cr.last_read_at, 0)`,
      [userId, userId, userId],
    );
    return (rows as RowDataPacket[]).map((r) => r.channel_id as string);
  },

  async getUnreadDmKeys(userId: string): Promise<string[]> {
    const keys: string[] = [];

    // 1-to-1 DM
    const [dmRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT
         CASE WHEN dm.from_id = ? THEN dm.to_id ELSE dm.from_id END AS other_id
       FROM dm_messages dm
       LEFT JOIN dm_reads dr
         ON dr.user_id = ?
        AND dr.conversation_key = CASE WHEN dm.from_id = ? THEN dm.to_id ELSE dm.from_id END
       WHERE (dm.from_id = ? OR dm.to_id = ?)
         AND dm.from_id != ?
         AND UNIX_TIMESTAMP(dm.created_at) * 1000 > COALESCE(dr.last_read_at, 0)`,
      [userId, userId, userId, userId, userId, userId],
    );
    for (const row of dmRows as RowDataPacket[]) {
      keys.push(row.other_id as string);
    }

    // Group DM
    const [groupRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT dcm.conversation_id
       FROM dm_conversation_messages dcm
       INNER JOIN dm_conversation_members dcmem
         ON dcmem.conversation_id = dcm.conversation_id AND dcmem.user_id = ?
       LEFT JOIN dm_reads dr
         ON dr.user_id = ? AND dr.conversation_key = CONCAT('group:', dcm.conversation_id)
       WHERE dcm.from_id != ?
         AND UNIX_TIMESTAMP(dcm.created_at) * 1000 > COALESCE(dr.last_read_at, 0)`,
      [userId, userId, userId],
    );
    for (const row of groupRows as RowDataPacket[]) {
      keys.push(`group:${row.conversation_id as string}`);
    }

    return keys;
  },
};

export async function seedUser(email: string, password: string, nickname: string): Promise<User> {
  const existing = await findUserByEmail(email);
  if (existing) return publicUser(existing);
  return store.createUser(email, password, nickname);
}
