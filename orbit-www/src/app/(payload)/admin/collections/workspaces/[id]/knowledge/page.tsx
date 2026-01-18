import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPayloadHMR } from '@payloadcms/next/utilities'
import configPromise from '@payload-config'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Knowledge Management',
}

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function WorkspaceKnowledgePage({ params }: PageProps) {
  const { id } = await params
  const payload = await getPayloadHMR({ config: configPromise })

  // Fetch workspace
  const workspace = await payload.findByID({
    collection: 'workspaces',
    id,
  })
  
  if (!workspace) {
    notFound()
  }
  
  // Fetch knowledge spaces for this workspace
  const spaces = await payload.find({
    collection: 'knowledge-spaces',
    where: {
      workspace: { equals: workspace.id }
    },
    limit: 100,
    sort: 'name',
  })
  
  // If no spaces, show empty state
  if (spaces.docs.length === 0) {
    return (
      <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>📚</div>
        <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px', color: '#E0E0E0' }}>
          No Knowledge Spaces Yet
        </h2>
        <p style={{ fontSize: '14px', color: '#9A9A9A', marginBottom: '24px' }}>
          Create your first knowledge space to start organizing documentation for this workspace.
        </p>
        <Link 
          href={`/admin/collections/knowledge-spaces/create?workspace=${workspace.id}`}
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            background: '#0066FF',
            color: 'white',
            borderRadius: '4px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          Create Knowledge Space
        </Link>
      </div>
    )
  }
  
  // Default to first space
  const defaultSpace = spaces.docs[0]
  
  // Fetch pages for default space
  const pages = await payload.find({
    collection: 'knowledge-pages',
    where: {
      knowledgeSpace: { equals: defaultSpace.id }
    },
    limit: 1000,
    sort: 'sortOrder',
  })
  
  const publishedCount = pages.docs.filter(p => p.status === 'published').length
  const draftCount = pages.docs.filter(p => p.status === 'draft').length
  
  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <Link 
          href={`/admin/collections/workspaces/${workspace.id}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid #333',
            borderRadius: '4px',
            textDecoration: 'none',
            fontSize: '13px',
            color: '#E0E0E0',
            marginBottom: '16px',
            transition: 'background 0.2s',
          }}
        >
          ← Back to Workspace
        </Link>
        <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px', color: '#E0E0E0' }}>
          Knowledge Management
        </h1>
        <p style={{ fontSize: '14px', color: '#9A9A9A' }}>
          Manage documentation and knowledge bases for {workspace.name}
        </p>
      </div>
      
      {/* Main content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
        {/* Space overview card */}
        <div style={{ 
          background: '#1a1a1a', 
          border: '1px solid #333', 
          borderRadius: '4px',
          padding: '24px'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: '#E0E0E0' }}>
            {defaultSpace.name}
          </h2>
          <p style={{ fontSize: '13px', color: '#9A9A9A', marginBottom: '24px' }}>
            {defaultSpace.description || 'No description provided'}
          </p>
          
          {/* Stats */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(3, 1fr)', 
            gap: '16px',
            marginBottom: '24px'
          }}>
            <div style={{ textAlign: 'center', padding: '16px', background: '#0f0f0f', borderRadius: '4px', border: '1px solid #333' }}>
              <div style={{ fontSize: '13px', color: '#9A9A9A', marginBottom: '4px' }}>Total Pages</div>
              <div style={{ fontSize: '24px', fontWeight: 600, color: '#E0E0E0' }}>{pages.docs.length}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '16px', background: '#0f0f0f', borderRadius: '4px', border: '1px solid #333' }}>
              <div style={{ fontSize: '13px', color: '#9A9A9A', marginBottom: '4px' }}>Published</div>
              <div style={{ fontSize: '24px', fontWeight: 600, color: '#10B981' }}>{publishedCount}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '16px', background: '#0f0f0f', borderRadius: '4px', border: '1px solid #333' }}>
              <div style={{ fontSize: '13px', color: '#9A9A9A', marginBottom: '4px' }}>Drafts</div>
              <div style={{ fontSize: '24px', fontWeight: 600, color: '#F59E0B' }}>{draftCount}</div>
            </div>
          </div>
          
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Link
              href={`/admin/collections/knowledge-pages/create?knowledgeSpace=${defaultSpace.id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                background: '#0066FF',
                color: 'white',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'background 0.2s',
              }}
            >
              + New Page
            </Link>
            <Link
              href={`/admin/collections/knowledge-spaces/${defaultSpace.id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                background: '#1a1a1a',
                color: '#E0E0E0',
                border: '1px solid #333',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'background 0.2s',
              }}
            >
              Edit Space
            </Link>
          </div>
        </div>
        
        {/* Pages list */}
        {pages.docs.length > 0 && (
          <div style={{ 
            background: '#1a1a1a', 
            border: '1px solid #333', 
            borderRadius: '4px',
            padding: '24px'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: '#E0E0E0' }}>
              Recent Pages
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pages.docs.slice(0, 10).map(page => (
                <Link
                  key={page.id}
                  href={`/admin/collections/knowledge-pages/${page.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: '#0f0f0f',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: '14px', color: '#E0E0E0', fontWeight: 500 }}>
                    {page.title || '(Untitled)'}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontWeight: 500,
                    background: page.status === 'published' ? '#DEF7EC' : page.status === 'draft' ? '#FEF3C7' : '#F3F4F6',
                    color: page.status === 'published' ? '#03543F' : page.status === 'draft' ? '#92400E' : '#6B7280',
                  }}>
                    {page.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        
        {/* Other spaces */}
        {spaces.docs.length > 1 && (
          <div style={{ 
            background: '#1a1a1a', 
            border: '1px solid #333', 
            borderRadius: '4px',
            padding: '24px'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: '#E0E0E0' }}>
              Other Knowledge Spaces
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {spaces.docs
                .filter(s => s.id !== defaultSpace.id)
                .map(space => (
                  <Link
                    key={space.id}
                    href={`/admin/collections/knowledge-spaces/${space.id}`}
                    style={{
                      display: 'block',
                      padding: '12px 16px',
                      background: '#0f0f0f',
                      border: '1px solid #333',
                      borderRadius: '4px',
                      textDecoration: 'none',
                      fontSize: '14px',
                      color: '#E0E0E0',
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                  >
                    {space.name}
                  </Link>
                ))}
            </div>
          </div>
        )}
        
        {/* Quick actions */}
        <div style={{ 
          background: '#1a1a1a', 
          border: '1px solid #333', 
          borderRadius: '4px',
          padding: '24px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: '#E0E0E0' }}>
            Quick Actions
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Link
              href={`/admin/collections/knowledge-spaces/create?workspace=${workspace.id}`}
              style={{
                display: 'block',
                padding: '12px 16px',
                background: '#0f0f0f',
                border: '1px solid #333',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '14px',
                color: '#E0E0E0',
                fontWeight: 500,
                transition: 'all 0.2s',
              }}
            >
              + Create New Space
            </Link>
            <Link
              href={`/admin/collections/knowledge-spaces`}
              style={{
                display: 'block',
                padding: '12px 16px',
                background: '#0f0f0f',
                border: '1px solid #333',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '14px',
                color: '#E0E0E0',
                fontWeight: 500,
                transition: 'all 0.2s',
              }}
            >
              View All Spaces
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
