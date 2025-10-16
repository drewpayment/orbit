'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { Button } from '@/components/ui/button'
import { BookOpen, Plus, FileText, ExternalLink, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface KnowledgeSpace {
  id: string
  name: string
  slug: string
  description?: string
  icon?: string
  visibility: 'private' | 'internal' | 'public'
  createdAt: string
}

interface PageStats {
  total: number
  published: number
  draft: number
}

export const WorkspaceKnowledgeField: React.FC = () => {
  const { id: workspaceId } = useDocumentInfo()
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([])
  const [pageStats, setPageStats] = useState<Record<string, PageStats>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    async function fetchKnowledgeSpaces() {
      try {
        setLoading(true)
        setError(null)

        const spacesResponse = await fetch(
          `/api/knowledge-spaces?where[workspace][equals]=${workspaceId}&limit=100&sort=name`
        )

        if (!spacesResponse.ok) {
          throw new Error('Failed to fetch knowledge spaces')
        }

        const spacesData = await spacesResponse.json()
        setSpaces(spacesData.docs || [])

        const statsPromises = spacesData.docs.map(async (space: KnowledgeSpace) => {
          const pagesResponse = await fetch(
            `/api/knowledge-pages?where[knowledgeSpace][equals]=${space.id}&limit=1000`
          )
          const pagesData = await pagesResponse.json()
          const pages = (pagesData.docs || []) as Array<{ status: string }>

          return {
            spaceId: space.id,
            stats: {
              total: pages.length,
              published: pages.filter((p) => p.status === 'published').length,
              draft: pages.filter((p) => p.status === 'draft').length,
            },
          }
        })

        const statsResults = await Promise.all(statsPromises)
        const statsMap = statsResults.reduce(
          (acc, { spaceId, stats }) => {
            acc[spaceId] = stats
            return acc
          },
          {} as Record<string, PageStats>
        )

        setPageStats(statsMap)
      } catch (err) {
        console.error('Error fetching knowledge spaces:', err)
        setError(err instanceof Error ? err.message : 'Failed to load knowledge spaces')
      } finally {
        setLoading(false)
      }
    }

    fetchKnowledgeSpaces()
  }, [workspaceId])

  if (!workspaceId) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0' }}>
            Save the workspace first to manage knowledge spaces.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0' }}>
            Loading knowledge spaces...
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <p style={{ fontSize: '13px', color: '#DC2626', margin: '0' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (spaces.length === 0) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <div
            style={{
              padding: '24px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              textAlign: 'center',
            }}
          >
            <BookOpen
              style={{ width: '48px', height: '48px', margin: '0 auto 16px', color: '#9A9A9A' }}
            />
            <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px', color: '#E0E0E0' }}>
              No Knowledge Spaces
            </h3>
            <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0 0 20px' }}>
              Create your first space to start organizing documentation.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Link href={`/admin/collections/knowledge-spaces/create?workspace=${workspaceId}`}>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Knowledge Space
                </Button>
              </Link>
              <Link href={`/admin/collections/workspaces/${workspaceId}/knowledge`}>
                <Button variant="outline">
                  <BookOpen className="h-4 w-4 mr-2" />
                  Knowledge Management
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="field-type ui">
      <div className="render-fields">
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookOpen style={{ width: '20px', height: '20px', color: '#E0E0E0' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: '#E0E0E0' }}>Knowledge Spaces</h3>
            <span style={{ fontSize: '13px', color: '#9A9A9A' }}>
              ({spaces.length} {spaces.length === 1 ? 'space' : 'spaces'})
            </span>
          </div>
          <Link href={`/admin/collections/knowledge-spaces/create?workspace=${workspaceId}`}>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Space
            </Button>
          </Link>
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          {spaces.map((space) => {
            const stats = pageStats[space.id] || { total: 0, published: 0, draft: 0 }

            return (
              <div
                key={space.id}
                style={{
                  padding: '16px',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#0066FF'
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,102,255,0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#333'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: '#E0E0E0' }}>{space.name}</h4>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          background: space.visibility === 'public' ? '#DEF7EC' : space.visibility === 'internal' ? '#E5E7EB' : '#FEE2E2',
                          color: space.visibility === 'public' ? '#03543F' : space.visibility === 'internal' ? '#1F2937' : '#991B1B',
                          borderRadius: '12px',
                          fontWeight: 500,
                          textTransform: 'capitalize',
                        }}
                      >
                        {space.visibility}
                      </span>
                    </div>
                    {space.description && (
                      <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0', lineHeight: '1.5' }}>
                        {space.description}
                      </p>
                    )}
                  </div>
                  <Link href={`/admin/collections/knowledge-spaces/${space.id}`}>
                    <button
                      style={{
                        padding: '6px',
                        background: 'transparent',
                        border: '1px solid #333',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#0f0f0f'
                        e.currentTarget.style.borderColor = '#555'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.borderColor = '#333'
                      }}
                    >
                      <Pencil style={{ width: '14px', height: '14px', color: '#9A9A9A' }} />
                    </button>
                  </Link>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', paddingTop: '12px', borderTop: '1px solid #333' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FileText style={{ width: '14px', height: '14px', color: '#9A9A9A' }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#E0E0E0' }}>{stats.total}</span>
                    <span style={{ fontSize: '13px', color: '#9A9A9A' }}>pages</span>
                  </div>
                  {stats.published > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#10B981' }}>
                        {stats.published}
                      </span>
                      <span style={{ fontSize: '13px', color: '#9A9A9A' }}>published</span>
                    </div>
                  )}
                  {stats.draft > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#F59E0B' }}>
                        {stats.draft}
                      </span>
                      <span style={{ fontSize: '13px', color: '#9A9A9A' }}>drafts</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <Link
                    href={`/admin/collections/knowledge-pages/create?knowledgeSpace=${space.id}`}
                    style={{ flex: 1 }}
                  >
                    <Button size="sm" variant="outline" className="w-full" style={{ width: '100%' }}>
                      <Plus className="h-3 w-3 mr-2" />
                      New Page
                    </Button>
                  </Link>
                  <Link
                    href={`/admin/collections/workspaces/${workspaceId}/knowledge?space=${space.id}`}
                    style={{ flex: 1 }}
                  >
                    <Button size="sm" variant="outline" className="w-full" style={{ width: '100%' }}>
                      View Pages
                      <ExternalLink className="h-3 w-3 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #333' }}>
          <Link href={`/admin/collections/workspaces/${workspaceId}/knowledge`}>
            <Button variant="outline" style={{ width: '100%' }}>
              <BookOpen className="h-4 w-4 mr-2" />
              Open Knowledge Management
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
