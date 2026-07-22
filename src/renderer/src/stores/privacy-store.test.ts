import { describe, it, expect, beforeEach } from 'vitest'
import { usePrivacyStore } from './privacy-store'

describe('privacy-store', () => {
  beforeEach(() => {
    usePrivacyStore.getState().reset()
  })

  it('starts in idle state', () => {
    const state = usePrivacyStore.getState()
    expect(state.state).toBeNull()
    expect(state.status).toBe('idle')
    expect(state.applyResult).toBeNull()
    expect(state.expandedCategories.size).toBe(0)
    expect(state.progress).toBeNull()
  })

  it('setStatus transitions status', () => {
    usePrivacyStore.getState().setStatus('scanning')
    expect(usePrivacyStore.getState().status).toBe('scanning')

    usePrivacyStore.getState().setStatus('applying')
    expect(usePrivacyStore.getState().status).toBe('applying')

    usePrivacyStore.getState().setStatus('done')
    expect(usePrivacyStore.getState().status).toBe('done')
  })

  it('setState stores privacy shield state', () => {
    const mockState = { categories: [], score: 75 } as any
    usePrivacyStore.getState().setState(mockState)
    expect(usePrivacyStore.getState().state).toEqual(mockState)
  })

  it('toggleCategory adds category to expanded set', () => {
    usePrivacyStore.getState().toggleCategory('telemetry')
    expect(usePrivacyStore.getState().expandedCategories.has('telemetry')).toBe(true)
  })

  it('toggleCategory removes category when already expanded', () => {
    usePrivacyStore.getState().toggleCategory('telemetry')
    usePrivacyStore.getState().toggleCategory('telemetry')
    expect(usePrivacyStore.getState().expandedCategories.has('telemetry')).toBe(false)
  })

  it('toggleCategory can track multiple categories', () => {
    usePrivacyStore.getState().toggleCategory('telemetry')
    usePrivacyStore.getState().toggleCategory('tracking')
    usePrivacyStore.getState().toggleCategory('advertising')

    const { expandedCategories } = usePrivacyStore.getState()
    expect(expandedCategories.size).toBe(3)
    expect(expandedCategories.has('telemetry')).toBe(true)
    expect(expandedCategories.has('tracking')).toBe(true)
    expect(expandedCategories.has('advertising')).toBe(true)
  })

  it('setApplyResult stores the apply result', () => {
    const result = { applied: 5, failed: 0, failures: [] } as any
    usePrivacyStore.getState().setApplyResult(result)
    expect(usePrivacyStore.getState().applyResult).toEqual(result)
  })

  it('setProgress tracks scan progress', () => {
    const progress = { current: 3, total: 10, currentSetting: 'Telemetry' } as any
    usePrivacyStore.getState().setProgress(progress)
    expect(usePrivacyStore.getState().progress).toEqual(progress)
  })

  it('reset clears all state back to defaults', () => {
    usePrivacyStore.getState().setStatus('done')
    usePrivacyStore.getState().setState({ categories: [] } as any)
    usePrivacyStore.getState().toggleCategory('telemetry')
    usePrivacyStore.getState().setApplyResult({ applied: 1 } as any)

    usePrivacyStore.getState().reset()

    const state = usePrivacyStore.getState()
    expect(state.status).toBe('idle')
    expect(state.state).toBeNull()
    expect(state.expandedCategories.size).toBe(0)
    expect(state.applyResult).toBeNull()
    expect(state.progress).toBeNull()
  })
})
