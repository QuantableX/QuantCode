import { ref, computed } from 'vue'
import type { SpecFile, SpecStatus } from '../shared/types'
import { parseSpecFile, updateSpecField, findSpecFiles } from '../lib/specs/engine'
import { invoke } from '@tauri-apps/api/core'

export function useSpecs() {
  const specs = ref<SpecFile[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ---- Computed ----

  const specsByStatus = computed<Record<SpecStatus, SpecFile[]>>(() => {
    const grouped: Record<SpecStatus, SpecFile[]> = {
      'planned': [],
      'in-progress': [],
      'done': [],
      'blocked': [],
    }

    for (const spec of specs.value) {
      const status = spec.frontmatter.status
      if (status in grouped) {
        grouped[status].push(spec)
      }
    }

    return grouped
  })

  const totalSpecs = computed(() => specs.value.length)

  const progressSummary = computed(() => {
    const byStatus = specsByStatus.value
    return {
      planned: byStatus.planned.length,
      inProgress: byStatus['in-progress'].length,
      done: byStatus.done.length,
      blocked: byStatus.blocked.length,
      total: totalSpecs.value,
      completionPercent: totalSpecs.value > 0
        ? Math.round((byStatus.done.length / totalSpecs.value) * 100)
        : 0,
    }
  })

  // ---- Actions ----

  async function loadSpecs(workspacePath: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      specs.value = await findSpecFiles(workspacePath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      error.value = `Failed to load specs: ${message}`
      specs.value = []
    } finally {
      loading.value = false
    }
  }

  function getSpec(path: string): SpecFile | undefined {
    return specs.value.find(s => s.path === path)
  }

  async function updateSpecStatus(
    specPath: string,
    status: SpecStatus,
    workspacePath?: string,
  ): Promise<void> {
    const spec = specs.value.find(s => s.path === specPath)
    if (!spec) {
      throw new Error(`Spec not found: ${specPath}`)
    }

    // Update the raw content
    let updatedContent = updateSpecField(spec.rawContent, 'status', status)
    updatedContent = updateSpecField(updatedContent, 'updatedAt', new Date().toISOString())

    // Update local state
    spec.frontmatter.status = status
    spec.frontmatter.updatedAt = new Date().toISOString()
    spec.rawContent = updatedContent

    // Persist to disk if workspace path is available
    if (workspacePath) {
      try {
        await invoke('write_file', {
          path: workspacePath + '/' + specPath,
          content: updatedContent,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to save spec: ${message}`)
      }
    }
  }

  async function reloadSpec(specPath: string, workspacePath: string): Promise<SpecFile | null> {
    try {
      const rawContent = await invoke<string>('read_file', {
        path: workspacePath + '/' + specPath,
      })

      const updated = parseSpecFile(specPath, rawContent)

      // Update in the local list
      const index = specs.value.findIndex(s => s.path === specPath)
      if (index !== -1) {
        specs.value[index] = updated
      }

      return updated
    } catch (err) {
      console.error(`Failed to reload spec ${specPath}:`, err)
      return null
    }
  }

  return {
    // State
    specs,
    loading,
    error,
    // Computed
    specsByStatus,
    totalSpecs,
    progressSummary,
    // Actions
    loadSpecs,
    getSpec,
    updateSpecStatus,
    reloadSpec,
  }
}
