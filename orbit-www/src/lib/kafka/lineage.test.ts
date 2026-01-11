import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'
import {
  upsertLineageEdge,
  batchUpsertLineageEdges,
  markInactiveEdges,
  reset24hMetrics,
  resolveServiceAccountContext,
  resolveTopicContext,
  getTopicLineageGraph,
  getApplicationLineageGraph,
  getTopicLineageSummary,
  getApplicationLineageSummary,
  getCrossWorkspaceLineage,
  type LineageEdgeInput,
} from './lineage'

// Mock Payload instance
const createMockPayload = () => ({
  find: vi.fn(),
  findByID: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
})

describe('Lineage Edge Management', () => {
  let mockPayload: ReturnType<typeof createMockPayload>

  beforeEach(() => {
    vi.clearAllMocks()
    mockPayload = createMockPayload()
  })

  describe('upsertLineageEdge', () => {
    const baseInput: LineageEdgeInput = {
      sourceServiceAccountId: 'sa-123',
      topicId: 'topic-456',
      targetWorkspaceId: 'ws-789',
      direction: 'produce',
      bytes: 1024,
      messageCount: 10,
      timestamp: new Date('2024-01-15T12:00:00Z'),
    }

    it('should create a new edge when none exists', async () => {
      mockPayload.find.mockResolvedValue({ docs: [] })
      mockPayload.create.mockResolvedValue({
        id: 'edge-new',
        ...baseInput,
        bytesLast24h: 1024,
        messagesLast24h: 10,
        bytesAllTime: 1024,
        messagesAllTime: 10,
        isActive: true,
        isCrossWorkspace: false,
      })

      const result = await upsertLineageEdge(mockPayload as unknown as Payload, baseInput)

      expect(result.isNew).toBe(true)
      expect(mockPayload.find).toHaveBeenCalledWith({
        collection: 'kafka-lineage-edges',
        where: {
          and: [
            { sourceServiceAccount: { equals: 'sa-123' } },
            { topic: { equals: 'topic-456' } },
            { direction: { equals: 'produce' } },
          ],
        },
        limit: 1,
        overrideAccess: true,
      })
      expect(mockPayload.create).toHaveBeenCalled()
    })

    it('should update existing edge and accumulate metrics', async () => {
      const existingEdge = {
        id: 'edge-existing',
        bytesLast24h: 500,
        messagesLast24h: 5,
        bytesAllTime: 10000,
        messagesAllTime: 100,
        isActive: true,
      }
      mockPayload.find.mockResolvedValue({ docs: [existingEdge] })
      mockPayload.update.mockResolvedValue({
        ...existingEdge,
        bytesLast24h: 1524,
        messagesLast24h: 15,
        bytesAllTime: 11024,
        messagesAllTime: 110,
      })

      const result = await upsertLineageEdge(mockPayload as unknown as Payload, baseInput)

      expect(result.isNew).toBe(false)
      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'kafka-lineage-edges',
        id: 'edge-existing',
        data: expect.objectContaining({
          bytesLast24h: 1524,
          messagesLast24h: 15,
          bytesAllTime: 11024,
          messagesAllTime: 110,
          isActive: true,
        }),
        overrideAccess: true,
      })
    })

    it('should mark cross-workspace when source and target workspaces differ', async () => {
      mockPayload.find.mockResolvedValue({ docs: [] })
      mockPayload.create.mockResolvedValue({
        id: 'edge-new',
        isCrossWorkspace: true,
      })

      const input: LineageEdgeInput = {
        ...baseInput,
        sourceWorkspaceId: 'ws-different',
        targetWorkspaceId: 'ws-789',
      }

      await upsertLineageEdge(mockPayload as unknown as Payload, input)

      expect(mockPayload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isCrossWorkspace: true,
          }),
        })
      )
    })
  })

  describe('batchUpsertLineageEdges', () => {
    it('should process multiple edges sequentially', async () => {
      mockPayload.find.mockResolvedValue({ docs: [] })
      mockPayload.create.mockResolvedValue({ id: 'new-edge' })

      const inputs: LineageEdgeInput[] = [
        {
          sourceServiceAccountId: 'sa-1',
          topicId: 'topic-1',
          targetWorkspaceId: 'ws-1',
          direction: 'produce',
          bytes: 100,
          messageCount: 1,
          timestamp: new Date(),
        },
        {
          sourceServiceAccountId: 'sa-2',
          topicId: 'topic-2',
          targetWorkspaceId: 'ws-2',
          direction: 'consume',
          bytes: 200,
          messageCount: 2,
          timestamp: new Date(),
        },
      ]

      const results = await batchUpsertLineageEdges(mockPayload as unknown as Payload, inputs)

      expect(results).toHaveLength(2)
      expect(mockPayload.create).toHaveBeenCalledTimes(2)
    })

    it('should continue processing after individual failures', async () => {
      mockPayload.find.mockResolvedValue({ docs: [] })
      mockPayload.create
        .mockRejectedValueOnce(new Error('First failed'))
        .mockResolvedValueOnce({ id: 'edge-2' })

      const inputs: LineageEdgeInput[] = [
        {
          sourceServiceAccountId: 'sa-1',
          topicId: 'topic-1',
          targetWorkspaceId: 'ws-1',
          direction: 'produce',
          bytes: 100,
          messageCount: 1,
          timestamp: new Date(),
        },
        {
          sourceServiceAccountId: 'sa-2',
          topicId: 'topic-2',
          targetWorkspaceId: 'ws-2',
          direction: 'consume',
          bytes: 200,
          messageCount: 2,
          timestamp: new Date(),
        },
      ]

      const results = await batchUpsertLineageEdges(mockPayload as unknown as Payload, inputs)

      // Should only have 1 result since first failed
      expect(results).toHaveLength(1)
    })
  })

  describe('markInactiveEdges', () => {
    it('should mark edges as inactive when older than threshold', async () => {
      const staleEdges = [
        { id: 'edge-1' },
        { id: 'edge-2' },
      ]
      mockPayload.find.mockResolvedValue({ docs: staleEdges })
      mockPayload.update.mockResolvedValue({})

      const count = await markInactiveEdges(mockPayload as unknown as Payload, 24)

      expect(count).toBe(2)
      expect(mockPayload.update).toHaveBeenCalledTimes(2)
      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'kafka-lineage-edges',
        id: 'edge-1',
        data: { isActive: false },
        overrideAccess: true,
      })
    })

    it('should use default 24 hour threshold', async () => {
      mockPayload.find.mockResolvedValue({ docs: [] })

      await markInactiveEdges(mockPayload as unknown as Payload)

      expect(mockPayload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            and: expect.arrayContaining([
              { isActive: { equals: true } },
            ]),
          }),
        })
      )
    })
  })

  describe('reset24hMetrics', () => {
    it('should reset metrics for all edges with non-zero values', async () => {
      const edgesWithMetrics = [
        { id: 'edge-1', bytesLast24h: 100, messagesLast24h: 10 },
        { id: 'edge-2', bytesLast24h: 200, messagesLast24h: 0 },
      ]
      mockPayload.find.mockResolvedValue({ docs: edgesWithMetrics })
      mockPayload.update.mockResolvedValue({})

      const count = await reset24hMetrics(mockPayload as unknown as Payload)

      expect(count).toBe(2)
      expect(mockPayload.update).toHaveBeenCalledWith({
        collection: 'kafka-lineage-edges',
        id: 'edge-1',
        data: { bytesLast24h: 0, messagesLast24h: 0 },
        overrideAccess: true,
      })
    })
  })

  describe('resolveServiceAccountContext', () => {
    it('should return application and workspace IDs', async () => {
      mockPayload.findByID.mockResolvedValue({
        application: {
          id: 'app-123',
          workspace: { id: 'ws-456' },
        },
      })

      const result = await resolveServiceAccountContext(
        mockPayload as unknown as Payload,
        'sa-789'
      )

      expect(result).toEqual({
        applicationId: 'app-123',
        workspaceId: 'ws-456',
      })
    })

    it('should return null when service account not found', async () => {
      mockPayload.findByID.mockResolvedValue(null)

      const result = await resolveServiceAccountContext(
        mockPayload as unknown as Payload,
        'sa-nonexistent'
      )

      expect(result).toBeNull()
    })

    it('should return null when application missing', async () => {
      mockPayload.findByID.mockResolvedValue({
        application: null,
      })

      const result = await resolveServiceAccountContext(
        mockPayload as unknown as Payload,
        'sa-789'
      )

      expect(result).toBeNull()
    })
  })

  describe('resolveTopicContext', () => {
    it('should return application and workspace IDs', async () => {
      mockPayload.findByID.mockResolvedValue({
        application: { id: 'app-123' },
        workspace: { id: 'ws-456' },
      })

      const result = await resolveTopicContext(mockPayload as unknown as Payload, 'topic-789')

      expect(result).toEqual({
        applicationId: 'app-123',
        workspaceId: 'ws-456',
      })
    })

    it('should return null when topic not found', async () => {
      mockPayload.findByID.mockResolvedValue(null)

      const result = await resolveTopicContext(
        mockPayload as unknown as Payload,
        'topic-nonexistent'
      )

      expect(result).toBeNull()
    })
  })
})

describe('Lineage Query Functions', () => {
  let mockPayload: ReturnType<typeof createMockPayload>

  beforeEach(() => {
    vi.clearAllMocks()
    mockPayload = createMockPayload()
  })

  describe('getTopicLineageGraph', () => {
    it('should return graph with nodes and edges', async () => {
      mockPayload.findByID.mockResolvedValue({
        id: 'topic-123',
        name: 'test-topic',
        workspace: { id: 'ws-1', name: 'Test Workspace' },
        environment: 'prod',
      })
      mockPayload.find.mockResolvedValue({
        docs: [
          {
            id: 'edge-1',
            sourceApplication: { id: 'app-1', name: 'Producer App' },
            sourceServiceAccount: { id: 'sa-1', name: 'producer-sa' },
            sourceWorkspace: { id: 'ws-2', name: 'Other Workspace' },
            direction: 'produce',
            bytesLast24h: 1000,
            messagesLast24h: 10,
            bytesAllTime: 5000,
            messagesAllTime: 50,
            isActive: true,
            isCrossWorkspace: true,
            lastSeen: '2024-01-15T12:00:00Z',
          },
        ],
      })

      const graph = await getTopicLineageGraph(mockPayload as unknown as Payload, 'topic-123')

      expect(graph.centerNode).toBe('topic-123')
      expect(graph.nodes).toHaveLength(2) // topic + producer
      expect(graph.edges).toHaveLength(1)
      expect(graph.nodes.find(n => n.id === 'topic-123')?.type).toBe('topic')
      expect(graph.edges[0].direction).toBe('produce')
    })

    it('should throw when topic not found', async () => {
      mockPayload.findByID.mockResolvedValue(null)

      await expect(
        getTopicLineageGraph(mockPayload as unknown as Payload, 'nonexistent')
      ).rejects.toThrow('Topic not found')
    })

    it('should filter inactive edges by default', async () => {
      mockPayload.findByID.mockResolvedValue({
        id: 'topic-123',
        name: 'test-topic',
        workspace: 'ws-1',
      })
      mockPayload.find.mockResolvedValue({ docs: [] })

      await getTopicLineageGraph(mockPayload as unknown as Payload, 'topic-123')

      expect(mockPayload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            and: expect.arrayContaining([
              { isActive: { equals: true } },
            ]),
          }),
        })
      )
    })
  })

  describe('getApplicationLineageGraph', () => {
    it('should return graph centered on application', async () => {
      mockPayload.findByID.mockResolvedValue({
        id: 'app-123',
        name: 'Test App',
        workspace: { id: 'ws-1', name: 'Test Workspace' },
      })
      mockPayload.find.mockResolvedValue({
        docs: [
          {
            id: 'edge-1',
            topic: { id: 'topic-1', name: 'orders', environment: 'prod' },
            targetWorkspace: { id: 'ws-1', name: 'Test Workspace' },
            direction: 'produce',
            bytesLast24h: 2000,
            messagesLast24h: 20,
            bytesAllTime: 10000,
            messagesAllTime: 100,
            isActive: true,
            isCrossWorkspace: false,
            lastSeen: '2024-01-15T12:00:00Z',
          },
        ],
      })

      const graph = await getApplicationLineageGraph(
        mockPayload as unknown as Payload,
        'app-123'
      )

      expect(graph.centerNode).toBe('app-123')
      expect(graph.nodes.find(n => n.id === 'app-123')?.type).toBe('application')
      expect(graph.nodes.find(n => n.id === 'topic-1')?.type).toBe('topic')
    })
  })

  describe('getTopicLineageSummary', () => {
    it('should return correct producer and consumer counts', async () => {
      mockPayload.findByID.mockResolvedValue({
        id: 'topic-123',
        name: 'test-topic',
      })
      mockPayload.find.mockResolvedValue({
        docs: [
          {
            sourceApplication: { id: 'app-1', name: 'Producer 1' },
            direction: 'produce',
            bytesLast24h: 1000,
            messagesLast24h: 10,
            lastSeen: '2024-01-15T12:00:00Z',
            isCrossWorkspace: false,
          },
          {
            sourceApplication: { id: 'app-2', name: 'Consumer 1' },
            direction: 'consume',
            bytesLast24h: 500,
            messagesLast24h: 5,
            lastSeen: '2024-01-15T12:00:00Z',
            isCrossWorkspace: true,
          },
          {
            sourceApplication: { id: 'app-3', name: 'Consumer 2' },
            direction: 'consume',
            bytesLast24h: 300,
            messagesLast24h: 3,
            lastSeen: '2024-01-15T12:00:00Z',
            isCrossWorkspace: false,
          },
        ],
      })

      const summary = await getTopicLineageSummary(
        mockPayload as unknown as Payload,
        'topic-123'
      )

      expect(summary.producerCount).toBe(1)
      expect(summary.consumerCount).toBe(2)
      expect(summary.crossWorkspaceConsumers).toBe(1)
      expect(summary.totalBytesLast24h).toBe(1800)
      expect(summary.totalMessagesLast24h).toBe(18)
    })
  })

  describe('getApplicationLineageSummary', () => {
    it('should return correct topic counts', async () => {
      mockPayload.findByID.mockResolvedValue({
        id: 'app-123',
        name: 'Test App',
      })
      mockPayload.find.mockResolvedValue({
        docs: [
          {
            topic: { id: 'topic-1', name: 'orders' },
            direction: 'produce',
            bytesLast24h: 1000,
            messagesLast24h: 10,
            lastSeen: '2024-01-15T12:00:00Z',
            isCrossWorkspace: false,
          },
          {
            topic: { id: 'topic-2', name: 'events' },
            direction: 'consume',
            bytesLast24h: 500,
            messagesLast24h: 5,
            lastSeen: '2024-01-15T12:00:00Z',
            isCrossWorkspace: true,
          },
        ],
      })

      const summary = await getApplicationLineageSummary(
        mockPayload as unknown as Payload,
        'app-123'
      )

      expect(summary.producesToCount).toBe(1)
      expect(summary.consumesFromCount).toBe(1)
      expect(summary.crossWorkspaceTopics).toBe(1)
    })
  })

  describe('getCrossWorkspaceLineage', () => {
    it('should return inbound cross-workspace edges', async () => {
      const inboundEdges = [{ id: 'edge-1' }, { id: 'edge-2' }]
      mockPayload.find.mockResolvedValue({ docs: inboundEdges })

      const result = await getCrossWorkspaceLineage(
        mockPayload as unknown as Payload,
        'ws-123',
        'inbound'
      )

      expect(result).toHaveLength(2)
      expect(mockPayload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            and: expect.arrayContaining([
              { targetWorkspace: { equals: 'ws-123' } },
              { isCrossWorkspace: { equals: true } },
            ]),
          }),
        })
      )
    })

    it('should return both inbound and outbound when direction is both', async () => {
      mockPayload.find
        .mockResolvedValueOnce({ docs: [{ id: 'inbound-1' }] })
        .mockResolvedValueOnce({ docs: [{ id: 'outbound-1' }] })

      const result = await getCrossWorkspaceLineage(
        mockPayload as unknown as Payload,
        'ws-123',
        'both'
      )

      expect(result).toHaveLength(2)
      expect(mockPayload.find).toHaveBeenCalledTimes(2)
    })
  })
})
