import { describe, expect, it } from 'vitest'
import {
  approvalPolicyLabel,
  backendTypeLabel,
  runStatusPresentation,
  triggerLabel,
} from './action-ui'

describe('backendTypeLabel', () => {
  it('maps known backend types to friendly labels', () => {
    expect(backendTypeLabel('temporal-template')).toBe('Template')
    expect(backendTypeLabel('kafka-provision')).toBe('Kafka topic')
    expect(backendTypeLabel('agent')).toBe('Agent')
  })

  it('falls back to the raw value for unknown types', () => {
    expect(backendTypeLabel('something-new')).toBe('something-new')
  })
})

describe('approvalPolicyLabel', () => {
  it('returns null when no approval is required', () => {
    expect(approvalPolicyLabel('none')).toBeNull()
    expect(approvalPolicyLabel(null)).toBeNull()
    expect(approvalPolicyLabel(undefined)).toBeNull()
  })

  it('labels gated policies', () => {
    expect(approvalPolicyLabel('workspace-admin')).toBe('Workspace approval')
    expect(approvalPolicyLabel('platform-admin')).toBe('Platform approval')
  })
})

describe('runStatusPresentation', () => {
  it('returns a label + class for each lifecycle status', () => {
    expect(runStatusPresentation('awaiting-approval').label).toBe('Awaiting approval')
    expect(runStatusPresentation('succeeded').className).toContain('green')
    expect(runStatusPresentation('failed').className).toContain('red')
    expect(runStatusPresentation('running').className).toContain('animate-pulse')
  })

  it('degrades gracefully for an unknown status', () => {
    const pres = runStatusPresentation('weird')
    expect(pres.label).toBe('weird')
    expect(pres.className).toContain('muted')
  })
})

describe('triggerLabel', () => {
  it('distinguishes automation from manual', () => {
    expect(triggerLabel('automation')).toBe('Automation')
    expect(triggerLabel('manual')).toBe('Manual')
    expect(triggerLabel(null)).toBe('Manual')
  })
})
