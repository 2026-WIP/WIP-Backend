export type MessageStatus = 'in-progress' | 'completed';
export type MessageKind = 'chat' | 'task';
export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'java' | 'bash' | 'plain';

export interface User {
  id: string;
  email: string;
  nickname: string;
  createdAt: number;
}

export interface StoredUser extends User {
  passwordHash: string;
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  memberIds: string[];
  ownerId?: string;
}

export interface CodeBlockData {
  id: string;
  code: string;
  language: SupportedLanguage;
  fileName?: string;
  runnerOutput?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  };
  originalCode?: string;
  modifiedCode?: string;
}

export interface QuoteReference {
  messageId: string;
  lineNumber: number;
  lineContent: string;
}

export type ReactionMap = Record<string, string[]>;

export interface Snippet {
  id: string;
  ownerId: string;
  title: string;
  language: SupportedLanguage;
  code: string;
  fileName?: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  fromChannel?: string;
}

export interface RunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  compiler?: string;
}

export type FriendStatus = 'pending' | 'accepted' | 'declined';

export interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  status: FriendStatus;
  createdAt: number;
}

export interface DmMessage {
  id: string;
  fromId: string;
  fromName: string;
  toId?: string;
  conversationId?: string;
  text: string;
  createdAt: number;
}

export interface DmConversation {
  id: string;
  name: string;
  memberIds: string[];
  memberNames: string[];
  createdAt: number;
}

export type NotificationType = 'mention' | 'reply' | 'status' | 'friend' | 'dm' | 'workspace';

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: string;
  channelId?: string;
  preview: string;
  ts: number;
  read: boolean;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  font: 'geist' | 'inter' | 'mono';
  density: 'compact' | 'default' | 'spacious';
  notifications: {
    mention: boolean;
    reply: boolean;
    reaction: boolean;
    statusChange: boolean;
    dmNew: boolean;
    sound: boolean;
    desktop: boolean;
    email: boolean;
  };
}

export interface GitHubConnection {
  token: string;
  userLogin: string | null;
  repoFullName: string;
  repoInfo: GitHubRepoInfo | null;
  notifications: GitHubNotification[];
  seenIds: string[];
  updatedAt?: number;
}

export type GitHubEventType = 'commit' | 'pr' | 'issue';

export interface GitHubChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  sha: string;
}

export interface GitHubNotification {
  id: string;
  type: GitHubEventType;
  title: string;
  body: string;
  htmlUrl: string;
  author: string;
  authorAvatar?: string;
  repo: string;
  ts: number;
  read: boolean;
  sha?: string;
  files?: GitHubChangedFile[];
  number?: number;
  state?: 'open' | 'closed' | 'merged';
  labels?: string[];
}

export interface GitHubRepoInfo {
  fullName: string;
  description: string | null;
  starCount: number;
  defaultBranch: string;
  htmlUrl: string;
  language: string | null;
}

export interface SearchResult {
  type: 'message' | 'code';
  messageId: string;
  channelId: string;
  channelName: string;
  authorName: string;
  snippet: string;
  codeLanguage?: string;
  fileName?: string;
  ts: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string;
  codeBlocks: CodeBlockData[];
  quoteRef?: QuoteReference;
  parentId?: string;
  threadCount?: number;
  reactions?: ReactionMap;
  createdAt: number;
  updatedAt?: number;
  status: MessageStatus;
  kind: MessageKind;
}
