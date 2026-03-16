import { invoke } from '@tauri-apps/api/core'
import { Command } from '@tauri-apps/plugin-shell'
import type { MCPToolCallResponse } from '../../shared/types'

function resolvePath(workspacePath: string, relativePath: string): string {
  if (relativePath.startsWith('/') || relativePath.match(/^[A-Za-z]:\\/)) {
    return relativePath
  }
  return `${workspacePath}/${relativePath}`
}

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

function flattenEntryNames(entries: FileEntry[], prefix: string = ''): string[] {
  const names: string[] = []
  for (const entry of entries) {
    const display = prefix ? `${prefix}/${entry.name}` : entry.name
    names.push(entry.isDirectory ? `${display}/` : display)
    if (entry.children) {
      names.push(...flattenEntryNames(entry.children, display))
    }
  }
  return names
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  try {
    switch (name) {
      case 'read_file':
        return await executeReadFile(args, workspacePath)

      case 'write_file':
        return await executeWriteFile(args, workspacePath)

      case 'list_directory':
        return await executeListDirectory(args, workspacePath)

      case 'search_files':
        return await executeSearchFiles(args, workspacePath)

      case 'execute_command':
        return await executeCommand(args, workspacePath)

      case 'git_status':
        return await executeGitStatus(workspacePath)

      case 'git_diff':
        return await executeGitDiff(args, workspacePath)

      case 'git_commit':
        return await executeGitCommit(args, workspacePath)

      default:
        return {
          content: `Unknown tool: ${name}`,
          isError: true,
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: `Tool execution failed: ${message}`,
      isError: true,
    }
  }
}

async function executeReadFile(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const path = args.path as string
  if (!path) {
    return { content: 'Missing required parameter: path', isError: true }
  }

  const content = await invoke<string>('read_file', {
    path: resolvePath(workspacePath, path),
  })

  return { content, isError: false }
}

async function executeWriteFile(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const path = args.path as string
  const content = args.content as string

  if (!path) {
    return { content: 'Missing required parameter: path', isError: true }
  }
  if (content === undefined || content === null) {
    return { content: 'Missing required parameter: content', isError: true }
  }

  await invoke('write_file', {
    path: resolvePath(workspacePath, path),
    content,
  })

  return { content: `Successfully wrote to ${path}`, isError: false }
}

async function executeListDirectory(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const path = (args.path as string) || '.'

  const entries = await invoke<FileEntry[]>('read_dir_tree', {
    path: resolvePath(workspacePath, path),
    gitignore: false,
  })

  const names = flattenEntryNames(entries)
  return { content: names.join('\n') || '(empty directory)', isError: false }
}

async function executeSearchFiles(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const pattern = args.pattern as string
  if (!pattern) {
    return { content: 'Missing required parameter: pattern', isError: true }
  }

  const searchPath = (args.path as string) || '.'
  const resolved = resolvePath(workspacePath, searchPath)

  const cmd = Command.create('grep', ['-r', '-n', '-I', '--include=*', pattern, resolved])
  const output = await cmd.execute()

  if (output.code !== 0 && !output.stdout) {
    return { content: 'No matches found.', isError: false }
  }

  return { content: output.stdout || 'No matches found.', isError: false }
}

async function executeCommand(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const command = args.command as string
  if (!command) {
    return { content: 'Missing required parameter: command', isError: true }
  }

  const cwd = (args.cwd as string) || workspacePath

  const isWindows = navigator.userAgent.includes('Windows') || navigator.platform === 'Win32'
  const shell = isWindows ? 'cmd' : 'sh'
  const shellArgs = isWindows ? ['/C', command] : ['-c', command]

  const cmd = Command.create(shell, shellArgs, { cwd })
  const output = await cmd.execute()

  let result = ''
  if (output.stdout) {
    result += output.stdout
  }
  if (output.stderr) {
    result += (result ? '\n' : '') + `[stderr] ${output.stderr}`
  }
  if (!result) {
    result = `Command completed with exit code ${output.code}`
  }

  return {
    content: result,
    isError: output.code !== 0,
  }
}

async function executeGitStatus(
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const result = await invoke('git_status', {
    repoPath: workspacePath,
  })

  return { content: JSON.stringify(result, null, 2), isError: false }
}

async function executeGitDiff(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const staged = (args.staged as boolean) || false

  const result = await invoke<string>('git_diff', {
    repoPath: workspacePath,
    staged,
  })

  return { content: result || 'No changes.', isError: false }
}

async function executeGitCommit(
  args: Record<string, unknown>,
  workspacePath: string,
): Promise<MCPToolCallResponse> {
  const message = args.message as string
  if (!message) {
    return { content: 'Missing required parameter: message', isError: true }
  }

  const result = await invoke<string>('git_commit', {
    repoPath: workspacePath,
    message,
  })

  return { content: result, isError: false }
}
