import type { SpecFile, AgentRole, SpecStatus } from '../../shared/types'

export interface TaskBreakdown {
  id: string
  specPath: string
  specTitle: string
  description: string
  role: AgentRole
  priority: number
  dependencies: string[]
  estimatedComplexity: 'low' | 'medium' | 'high'
}

export interface TaskAssignment {
  task: TaskBreakdown
  assignedRole: AgentRole
  sessionId?: string
  status: 'pending' | 'assigned' | 'in-progress' | 'completed' | 'failed'
}

export interface WorkflowPlan {
  phases: WorkflowPhase[]
  totalTasks: number
  estimatedPhases: number
}

export interface WorkflowPhase {
  phaseNumber: number
  name: string
  tasks: TaskAssignment[]
  description: string
}

const PRIORITY_MAP: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

const STATUS_WEIGHT: Record<SpecStatus, number> = {
  open: 2,
  verify: 1,
  done: 0,
}

export function breakdownSpecs(specs: SpecFile[]): TaskBreakdown[] {
  const tasks: TaskBreakdown[] = []
  let taskCounter = 0

  const activeSpecs = specs.filter(s => s.frontmatter.status !== 'done' && s.frontmatter.status !== 'verify')

  for (const spec of activeSpecs) {
    const priority = PRIORITY_MAP[spec.frontmatter.priority || 'medium'] || 2
    const statusWeight = STATUS_WEIGHT[spec.frontmatter.status]

    // Determine complexity from content length and linked files
    const contentLength = spec.content.length
    const linkedFileCount = spec.frontmatter.linkedFiles?.length || 0
    let complexity: 'low' | 'medium' | 'high' = 'medium'
    if (contentLength < 500 && linkedFileCount <= 2) complexity = 'low'
    if (contentLength > 2000 || linkedFileCount > 5) complexity = 'high'

    // Determine dependencies from linked files and tags
    const dependencies = findDependencies(spec, activeSpecs)

    // Create implementation task
    if (spec.frontmatter.status === 'open') {
      tasks.push({
        id: `task_${taskCounter++}`,
        specPath: spec.path,
        specTitle: spec.frontmatter.title,
        description: `Implement: ${spec.frontmatter.title}`,
        role: 'coder',
        priority: priority + statusWeight,
        dependencies,
        estimatedComplexity: complexity,
      })

      // Create review task (depends on implementation)
      tasks.push({
        id: `task_${taskCounter++}`,
        specPath: spec.path,
        specTitle: spec.frontmatter.title,
        description: `Review: ${spec.frontmatter.title}`,
        role: 'reviewer',
        priority: priority,
        dependencies: [`task_${taskCounter - 2}`],
        estimatedComplexity: 'low',
      })

      // Create testing task (depends on implementation)
      tasks.push({
        id: `task_${taskCounter++}`,
        specPath: spec.path,
        specTitle: spec.frontmatter.title,
        description: `Test: ${spec.frontmatter.title}`,
        role: 'tester',
        priority: priority,
        dependencies: [`task_${taskCounter - 3}`],
        estimatedComplexity: complexity === 'high' ? 'medium' : 'low',
      })

      // Create verification task (depends on review and testing)
      tasks.push({
        id: `task_${taskCounter++}`,
        specPath: spec.path,
        specTitle: spec.frontmatter.title,
        description: `Verify: ${spec.frontmatter.title}`,
        role: 'verifier',
        priority: priority,
        dependencies: [`task_${taskCounter - 3}`, `task_${taskCounter - 2}`],
        estimatedComplexity: 'low',
      })
    }
  }

  // Sort by priority (higher first), then by dependencies (fewer deps first)
  return tasks.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.dependencies.length - b.dependencies.length
  })
}

function findDependencies(spec: SpecFile, allSpecs: SpecFile[]): string[] {
  const deps: string[] = []

  // Check if any other spec's linkedFiles overlap with this spec's linkedFiles
  if (spec.frontmatter.linkedFiles) {
    for (const otherSpec of allSpecs) {
      if (otherSpec.path === spec.path) continue
      if (!otherSpec.frontmatter.linkedFiles) continue

      const overlap = spec.frontmatter.linkedFiles.some(
        f => otherSpec.frontmatter.linkedFiles!.includes(f),
      )

      if (overlap && otherSpec.frontmatter.status === 'open') {
        deps.push(otherSpec.path)
      }
    }
  }

  return deps
}

export function assignTasks(
  tasks: TaskBreakdown[],
  availableRoles: AgentRole[],
): TaskAssignment[] {
  return tasks.map(task => {
    // Check if the task's preferred role is available
    const preferredRole = task.role
    const assignedRole = availableRoles.includes(preferredRole)
      ? preferredRole
      : findFallbackRole(preferredRole, availableRoles)

    return {
      task,
      assignedRole,
      status: 'pending' as const,
    }
  })
}

function findFallbackRole(preferred: AgentRole, available: AgentRole[]): AgentRole {
  // Fallback hierarchy
  const fallbacks: Record<AgentRole, AgentRole[]> = {
    coder: ['general'],
    reviewer: ['general', 'verifier'],
    tester: ['general', 'coder'],
    coordinator: ['general'],
    verifier: ['reviewer', 'general'],
    general: [],
  }

  const candidates = fallbacks[preferred] || []
  for (const candidate of candidates) {
    if (available.includes(candidate)) return candidate
  }

  // Last resort: use any available role
  return available[0] || 'general'
}

export function coordinateWorkflow(specs: SpecFile[]): WorkflowPlan {
  const tasks = breakdownSpecs(specs)
  const allRoles: AgentRole[] = ['coder', 'reviewer', 'tester', 'verifier', 'coordinator', 'general']
  const assignments = assignTasks(tasks, allRoles)

  // Organize into phases based on dependencies
  const phases: WorkflowPhase[] = []
  const completed = new Set<string>()
  let remaining = [...assignments]
  let phaseNumber = 1

  while (remaining.length > 0) {
    // Find tasks whose dependencies are all completed
    const readyTasks: TaskAssignment[] = []
    const notReady: TaskAssignment[] = []

    for (const assignment of remaining) {
      const depsResolved = assignment.task.dependencies.every(dep => completed.has(dep))
      if (depsResolved) {
        readyTasks.push(assignment)
      } else {
        notReady.push(assignment)
      }
    }

    // If nothing is ready but there are remaining tasks, force-unblock one
    if (readyTasks.length === 0 && notReady.length > 0) {
      readyTasks.push(notReady.shift()!)
    }

    // Group ready tasks by spec for phase naming
    const specTitles = [...new Set(readyTasks.map(t => t.task.specTitle))]
    const phaseName = phaseNumber === 1
      ? 'Implementation'
      : readyTasks[0]?.task.role === 'reviewer'
        ? 'Review & Testing'
        : readyTasks[0]?.task.role === 'verifier'
          ? 'Verification'
          : `Phase ${phaseNumber}`

    phases.push({
      phaseNumber,
      name: phaseName,
      tasks: readyTasks,
      description: `${phaseName}: ${specTitles.join(', ')}`,
    })

    // Mark tasks as completed for dependency resolution
    for (const task of readyTasks) {
      completed.add(task.task.id)
    }

    remaining = notReady
    phaseNumber++
  }

  return {
    phases,
    totalTasks: assignments.length,
    estimatedPhases: phases.length,
  }
}
