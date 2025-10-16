'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { Button } from '@/components/ui/button'
import { Plus, FileText, Pencil, Folder, Eye } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

interface KnowledgePage {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published' | 'archived'
  parentPage: string | null
  sortOrder: number
  updatedAt: string
}

export const KnowledgeSpacePagesField: React.FC = () => {
  const { id: spaceId } = useDocumentInfo()
  const [pages, setPages] = useState<KnowledgePage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!spaceId) return

    async function fetchPages() {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(
          `/api/knowledge-pages?where[knowledgeSpace][equals]=${spaceId}&limit=1000&sort=sortOrder`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch pages')
        }

        const data = await response.json()
        setPages(data.docs || [])
      } catch (err) {
        console.error('Error fetching pages:', err)
        setError(err instanceof Error ? err.message : 'Failed to load pages')
      } finally {
        setLoading(false)
      }
    }

    fetchPages()
  }, [spaceId])

  if (!spaceId) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0' }}>
            Save the knowledge space first to manage pages.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0' }}>Loading pages...</p>
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

  const rootPages = pages.filter((p) => !p.parentPage)
  const publishedCount = pages.filter((p) => p.status === 'published').length
  const draftCount = pages.filter((p) => p.status === 'draft').length

  if (pages.length === 0) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <div
            style={{
              padding: '32px',
              background: '#FAFAFA',
              border: '1px solid #E5E5E5',
              borderRadius: '4px',
              textAlign: 'center',
            }}
          >
            <FileText
              style={{ width: '48px', height: '48px', margin: '0 auto 16px', color: '#9A9A9A' }}
            />
            <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px' }}>No Pages Yet</h3>
            <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0 0 20px' }}>
              Create your first page to start building documentation.
            </p>
            <Link href={`/admin/collections/knowledge-pages/create?knowledgeSpace=${spaceId}`}>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create First Page
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="field-type ui">
      <div className="render-fields">
        {/* Header */}
        <div
          style={{
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText style={{ width: '20px', height: '20px', color: '#333' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
                Pages ({pages.length})
              </h3>
            </div>
            <div style={{ display: 'flex', gap: '12px', fontSize: '13px' }}>
              <span style={{ color: '#059669', fontWeight: 500 }}>
                {publishedCount} published
              </span>
              <span style={{ color: '#D97706', fontWeight: 500 }}>{draftCount} drafts</span>
            </div>
          </div>
          <Link href={`/admin/collections/knowledge-pages/create?knowledgeSpace=${spaceId}`}>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              New Page
            </Button>
          </Link>
        </div>

        {/* Pages List */}
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E5E5',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          {/* Header Row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 120px 100px',
              gap: '12px',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderBottom: '1px solid #E5E5E5',
              fontSize: '12px',
              fontWeight: 600,
              color: '#6B7280',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            <div>Page Title</div>
            <div>Type</div>
            <div>Status</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          {/* Pages Rows */}
          {rootPages.map((page) => {
            const childPages = pages.filter((p) => p.parentPage === page.id)
            const hasChildren = childPages.length > 0

            return (
              <div key={page.id}>
                {/* Parent Page */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 120px 100px',
                    gap: '12px',
                    padding: '12px 16px',
                    borderBottom: '1px solid #F3F4F6',
                    alignItems: 'center',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#F9FAFB'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {hasChildren && (
                      <Folder style={{ width: '16px', height: '16px', color: '#9A9A9A' }} />
                    )}
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>
                      {page.title || '(Untitled Page)'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#9A9A9A' }}>
                    {hasChildren ? 'Parent' : 'Page'}
                  </div>
                  <div>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontWeight: 500,
                        background:
                          page.status === 'published'
                            ? '#DEF7EC'
                            : page.status === 'draft'
                              ? '#FEF3C7'
                              : '#F3F4F6',
                        color:
                          page.status === 'published'
                            ? '#03543F'
                            : page.status === 'draft'
                              ? '#92400E'
                              : '#6B7280',
                      }}
                    >
                      {page.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <Link href={`/admin/collections/knowledge-pages/${page.id}`}>
                      <button
                        style={{
                          padding: '6px',
                          background: 'transparent',
                          border: '1px solid #E5E5E5',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#F3F4F6'
                          e.currentTarget.style.borderColor = '#9A9A9A'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.borderColor = '#E5E5E5'
                        }}
                        title="Edit page"
                      >
                        <Pencil style={{ width: '14px', height: '14px', color: '#666' }} />
                      </button>
                    </Link>
                    {page.status === 'published' && (
                      <button
                        style={{
                          padding: '6px',
                          background: 'transparent',
                          border: '1px solid #E5E5E5',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#F3F4F6'
                          e.currentTarget.style.borderColor = '#9A9A9A'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.borderColor = '#E5E5E5'
                        }}
                        title="View published page"
                        onClick={() => {
                          // TODO: Open frontend preview
                          alert('Frontend preview - to be implemented')
                        }}
                      >
                        <Eye style={{ width: '14px', height: '14px', color: '#666' }} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Child Pages */}
                {childPages.map((childPage) => (
                  <div
                    key={childPage.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto 120px 100px',
                      gap: '12px',
                      padding: '12px 16px 12px 48px',
                      borderBottom: '1px solid #F3F4F6',
                      alignItems: 'center',
                      background: '#FAFAFA',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#F3F4F6'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#FAFAFA'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', color: '#6B7280' }}>
                        {childPage.title || '(Untitled Page)'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#9A9A9A' }}>Child</div>
                    <div>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontWeight: 500,
                          background:
                            childPage.status === 'published'
                              ? '#DEF7EC'
                              : childPage.status === 'draft'
                                ? '#FEF3C7'
                                : '#F3F4F6',
                          color:
                            childPage.status === 'published'
                              ? '#03543F'
                              : childPage.status === 'draft'
                                ? '#92400E'
                                : '#6B7280',
                        }}
                      >
                        {childPage.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <Link href={`/admin/collections/knowledge-pages/${childPage.id}`}>
                        <button
                          style={{
                            padding: '6px',
                            background: 'transparent',
                            border: '1px solid #E5E5E5',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#F3F4F6'
                            e.currentTarget.style.borderColor = '#9A9A9A'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.borderColor = '#E5E5E5'
                          }}
                          title="Edit page"
                        >
                          <Pencil style={{ width: '14px', height: '14px', color: '#666' }} />
                        </button>
                      </Link>
                      {childPage.status === 'published' && (
                        <button
                          style={{
                            padding: '6px',
                            background: 'transparent',
                            border: '1px solid #E5E5E5',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#F3F4F6'
                            e.currentTarget.style.borderColor = '#9A9A9A'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.borderColor = '#E5E5E5'
                          }}
                          title="View published page"
                          onClick={() => {
                            alert('Frontend preview - to be implemented')
                          }}
                        >
                          <Eye style={{ width: '14px', height: '14px', color: '#666' }} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            gap: '12px',
            paddingTop: '16px',
            borderTop: '1px solid #E5E5E5',
          }}
        >
          <Link href={`/admin/collections/knowledge-pages/create?knowledgeSpace=${spaceId}`}>
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add New Page
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
