import { describe, it, expect } from 'vitest'
import {
  mapGrpcEvent,
  mapPersistedEvent,
  maxSequence,
  type AgentEventDTO,
} from './agent-event-dto'

describe('mapGrpcEvent', () => {
  it('maps a conversation turn with a protobuf Timestamp', () => {
    const dto = mapGrpcEvent({
      sequence: 7n,
      emittedAt: { seconds: 1_700_000_000, nanos: 0 },
      event: {
        case: 'conversationTurn',
        value: { turnId: 't1', role: 'assistant', content: 'hello', toolName: '', toolCallId: '' },
      },
    })
    expect(dto.sequence).toBe('7')
    expect(dto.kind).toBe('conversation_turn')
    expect(dto.conversationTurn).toEqual({
      turnId: 't1',
      role: 'assistant',
      content: 'hello',
      toolName: undefined,
      toolCallId: undefined,
    })
    expect(dto.emittedAt).toBe(new Date(1_700_000_000 * 1000).toISOString())
  })

  it('preserves tool name/callId when present', () => {
    const dto = mapGrpcEvent({
      sequence: 1n,
      event: {
        case: 'conversationTurn',
        value: { turnId: 't', role: 'tool', content: '{}', toolName: 'shell_exec', toolCallId: 'c9' },
      },
    })
    expect(dto.conversationTurn?.toolName).toBe('shell_exec')
    expect(dto.conversationTurn?.toolCallId).toBe('c9')
  })

  it('flattens an approval_request protobuf Struct payload', () => {
    const dto = mapGrpcEvent({
      sequence: 3n,
      event: {
        case: 'approvalRequest',
        value: {
          approvalId: 'a1',
          kind: 'tool_registration',
          title: 'Register tool',
          bodyMarkdown: 'body',
          payload: {
            fields: {
              name: { stringValue: 'deploy' },
              template_kind: { stringValue: 'shell' },
              agent_tool_id: { stringValue: 'tool-42' },
            },
          },
        },
      },
    })
    expect(dto.kind).toBe('approval_request')
    expect(dto.approvalRequest?.name).toBe('deploy')
    expect(dto.approvalRequest?.templateKind).toBe('shell')
    expect(dto.approvalRequest?.agentToolId).toBe('tool-42')
    expect(dto.approvalRequest?.description).toBeUndefined()
  })

  it('maps status_update and approval_resolution', () => {
    expect(
      mapGrpcEvent({ sequence: 1n, event: { case: 'statusUpdate', value: { status: 'running', message: 'x' } } })
        .statusUpdate,
    ).toEqual({ status: 'running', message: 'x' })
    expect(
      mapGrpcEvent({
        sequence: 1n,
        event: {
          case: 'approvalResolution',
          value: { approvalId: 'a1', approved: true, resolvedBy: 'u1', notes: 'ok' },
        },
      }).approvalResolution,
    ).toEqual({ approvalId: 'a1', approved: true, resolvedBy: 'u1', notes: 'ok' })
  })

  it('returns unknown for empty/unrecognized events', () => {
    expect(mapGrpcEvent({ sequence: 0n }).kind).toBe('unknown')
    expect(mapGrpcEvent({ sequence: 0n, event: { case: 'somethingNew', value: {} } }).kind).toBe('unknown')
  })
})

describe('mapPersistedEvent', () => {
  it('maps a persisted conversation_turn identically to the gRPC mapper', () => {
    const grpc = mapGrpcEvent({
      sequence: 7n,
      emittedAt: { seconds: 1_700_000_000 },
      event: {
        case: 'conversationTurn',
        value: { turnId: 't1', role: 'assistant', content: 'hello' },
      },
    })
    const persisted = mapPersistedEvent({
      sequence: 7,
      emittedAt: new Date(1_700_000_000 * 1000).toISOString(),
      kind: 'conversation_turn',
      payload: { turnId: 't1', role: 'assistant', content: 'hello' },
    })
    expect(persisted).toEqual<AgentEventDTO>(grpc)
  })

  it('maps a persisted approval_request to the flat shape', () => {
    const dto = mapPersistedEvent({
      sequence: 3,
      emittedAt: '2024-01-01T00:00:00.000Z',
      kind: 'approval_request',
      payload: {
        approvalId: 'a1',
        kind: 'tool_registration',
        title: 'Register tool',
        bodyMarkdown: 'body',
        name: 'deploy',
        templateKind: 'shell',
        agentToolId: 'tool-42',
      },
    })
    expect(dto.approvalRequest?.name).toBe('deploy')
    expect(dto.approvalRequest?.templateKind).toBe('shell')
    expect(dto.approvalRequest?.agentToolId).toBe('tool-42')
  })

  it('surfaces persisted tool_call_output as a tool_call_output_chunk (text → chunk)', () => {
    const dto = mapPersistedEvent({
      sequence: 5,
      emittedAt: '2024-01-01T00:00:00.000Z',
      kind: 'tool_call_output',
      payload: { callId: 'c1', stream: 'stdout', text: 'line1\nline2' },
    })
    expect(dto.kind).toBe('tool_call_output_chunk')
    expect(dto.toolCallOutputChunk).toEqual({ callId: 'c1', stream: 'stdout', chunk: 'line1\nline2' })
  })

  it('tolerates a null/missing payload', () => {
    const dto = mapPersistedEvent({
      sequence: 1,
      emittedAt: '2024-01-01T00:00:00.000Z',
      kind: 'status_update',
      payload: null,
    })
    expect(dto.statusUpdate).toEqual({ status: '', message: '' })
  })

  it('returns unknown for an unrecognized kind', () => {
    expect(
      mapPersistedEvent({ sequence: 1, emittedAt: '2024-01-01T00:00:00.000Z', kind: 'token_delta', payload: {} }).kind,
    ).toBe('unknown')
  })
})

describe('maxSequence', () => {
  it('returns the numeric max as a string', () => {
    expect(maxSequence([{ sequence: '3' }, { sequence: '10' }, { sequence: '2' }])).toBe('10')
  })
  it('returns 0 for an empty list', () => {
    expect(maxSequence([])).toBe('0')
  })
  it('ignores non-numeric sequences', () => {
    expect(maxSequence([{ sequence: 'abc' }, { sequence: '4' }])).toBe('4')
  })
})
