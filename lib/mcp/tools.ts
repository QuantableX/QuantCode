import type { MCPTool } from '../../shared/types'

export const BUILT_IN_TOOLS: MCPTool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path. Returns the full file content as a string.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the workspace root',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file at the given path. Creates the file if it does not exist, overwrites if it does.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path relative to the workspace root',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List all files and directories in the specified directory path. Returns names with a trailing / for directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path relative to the workspace root. Use "." for the root.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a text pattern across files in the workspace. Returns matching file paths and line content.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The search pattern (supports regex)',
        },
        path: {
          type: 'string',
          description: 'The directory path to search in, relative to workspace root. Defaults to "."',
        },
        file_pattern: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.ts", "**/*.vue")',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command in the workspace directory. Returns stdout and stderr.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory relative to workspace root. Defaults to workspace root.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'git_status',
    description: 'Get the current git status of the workspace repository. Returns branch, modified files, and staging state.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'git_diff',
    description: 'Get the git diff for the workspace. Shows unstaged changes by default, or staged changes if specified.',
    inputSchema: {
      type: 'object',
      properties: {
        staged: {
          type: 'boolean',
          description: 'If true, show staged changes (--cached). Defaults to false.',
        },
        file_path: {
          type: 'string',
          description: 'Optional specific file path to diff',
        },
      },
      required: [],
    },
  },
  {
    name: 'git_commit',
    description: 'Create a git commit with the specified message. Only commits already-staged files.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The commit message',
        },
        stage_all: {
          type: 'boolean',
          description: 'If true, stage all modified files before committing (git add -A). Defaults to false.',
        },
      },
      required: ['message'],
    },
  },
]

export function getToolByName(name: string): MCPTool | undefined {
  return BUILT_IN_TOOLS.find(tool => tool.name === name)
}

export function getToolNames(): string[] {
  return BUILT_IN_TOOLS.map(tool => tool.name)
}
