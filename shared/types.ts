// QuantCode Shared Types

// ============= Workspace Types =============

export interface WorkspaceInfo {
  id: string
  name: string
  folderPath: string
  lastOpened: string
  createdAt: string
}

export interface WorkspacesConfig {
  workspaces: WorkspaceInfo[]
  activeWorkspaceId: string | null
}

// ============= Canvas Types =============

export interface CanvasTransform {
  x: number
  y: number
  scale: number
}

export interface WindowPosition {
  x: number
  y: number
  width: number
  height: number
}

export type WindowType = 'agent' | 'terminal' | 'diff' | 'spec' | 'file' | 'browser'

export type WindowStatus = 'idle' | 'thinking' | 'live' | 'error' | 'minimized'

export type FilePreviewKind = 'image' | 'code' | 'markdown' | 'text' | 'binary'

export interface FileConfig {
  filePath: string
  previewKind: FilePreviewKind
  language?: string
  content?: string
  base64Data?: string
  mimeType?: string
}

export type SearchEngine = 'google' | 'duckduckgo' | 'bing' | 'brave'

export interface BrowserTab {
  id: string
  url: string
  title: string
  isLoading: boolean
}

export interface BrowserHistoryEntry {
  url: string
  title: string
  visitedAt: string
  favicon?: string
}

export interface BrowserBookmark {
  id: string
  url: string
  title: string
  folder?: string
  createdAt: string
}

export interface BrowserConfig {
  url: string
  tabs?: BrowserTab[]
  activeTabId?: string
  searchEngine?: SearchEngine
}

export interface CanvasWindow {
  id: string
  type: WindowType
  title: string
  position: WindowPosition
  status: WindowStatus
  minimized: boolean
  zIndex: number
  agentConfig?: AgentConfig
  terminalId?: string
  fileConfig?: FileConfig
  browserConfig?: BrowserConfig
}

export interface CanvasState {
  workspaceId: string
  transform: CanvasTransform
  windows: CanvasWindow[]
  nextZIndex: number
}

// ============= Agent Types =============

export type AgentProvider = 'anthropic' | 'openai' | 'ollama'

export type AgentRole = 'coder' | 'reviewer' | 'tester' | 'coordinator' | 'verifier' | 'general'

export interface AgentConfig {
  provider: AgentProvider
  model: string
  role: AgentRole
  apiKey?: string
  baseUrl?: string
  systemPrompt?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  streaming?: boolean
}

export interface AgentSession {
  id: string
  windowId: string
  config: AgentConfig
  messages: ChatMessage[]
  status: WindowStatus
  createdAt: string
}

// ============= Tool Use Types =============

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'error'
  result?: ToolResult
}

export interface ToolResult {
  toolCallId: string
  content: string
  isError: boolean
}

export interface ToolApprovalRequest {
  sessionId: string
  toolCall: ToolCall
}

// ============= MCP Types =============

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPToolCallRequest {
  name: string
  arguments: Record<string, unknown>
}

export interface MCPToolCallResponse {
  content: string
  isError: boolean
}

// ============= Spec Types =============

export type SpecStatus = 'planned' | 'in-progress' | 'done' | 'blocked'

export interface SpecFrontmatter {
  title: string
  status: SpecStatus
  priority?: 'low' | 'medium' | 'high' | 'critical'
  assignedTo?: string
  linkedFiles?: string[]
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export interface SpecFile {
  path: string
  frontmatter: SpecFrontmatter
  content: string
  rawContent: string
}

// ============= File Explorer Types =============

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
  expanded?: boolean
  gitStatus?: GitFileStatus
}

export type GitFileStatus = 'modified' | 'untracked' | 'staged' | 'deleted' | 'renamed' | 'clean'

// ============= Git Types =============

export interface GitStatus {
  branch: string
  files: GitStatusFile[]
  ahead: number
  behind: number
}

export interface GitStatusFile {
  path: string
  status: GitFileStatus
  staged: boolean
}

// ============= Diff Types =============

export interface DiffHunk {
  id: string
  filePath: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  oldContent: string
  newContent: string
  accepted?: boolean
}

export interface FileDiff {
  filePath: string
  hunks: DiffHunk[]
  isNew: boolean
  isDeleted: boolean
}

// ============= Provider Types =============

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ProviderContentBlock[]
}

export interface ProviderContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

export interface StreamChunk {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'done' | 'error'
  text?: string
  toolCall?: Partial<ToolCall>
  error?: string
}

export interface ProviderOptions {
  model: string
  apiKey?: string
  baseUrl?: string
  maxTokens?: number
  temperature?: number
  tools?: MCPTool[]
  onStream?: (chunk: StreamChunk) => void
}

// ============= App State Types =============

export interface AppState {
  fileExplorerVisible: boolean
  editorVisible: boolean
  activeEditorTabs: EditorTab[]
  activeTabId: string | null
}

export interface EditorTab {
  id: string
  filePath: string
  fileName: string
  content: string
  savedContent: string
  isDirty: boolean
  cursorPosition: { line: number; column: number }
  language: string
}

// ============= Terminal Types =============

export interface TerminalSession {
  id: string
  windowId: string
  pid?: number
  cwd: string
  active: boolean
}
