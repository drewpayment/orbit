'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import { Button } from '@/components/ui/button'
import { Plug, Settings, ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface Plugin {
  id: string
  pluginId: string
  name: string
  description: string
  category: string
  enabled: boolean
  metadata: {
    version: string
    backstagePackage: string
    icon?: {
      url?: string
    }
  }
  configuration?: {
    requiredConfigKeys?: Array<{
      key: string
      label: string
      description: string
      type: string
      isSecret?: boolean
    }>
    optionalConfigKeys?: Array<{
      key: string
      label: string
      description: string
      type: string
    }>
  }
  status?: {
    stability: string
  }
}

interface Workspace {
  id: string
  name: string
  slug: string
}

interface PluginConfig {
  id: string
  workspace: string | Workspace
  plugin: string | Plugin
  enabled: boolean
  configuration?: Record<string, unknown>
  secrets?: Array<{
    key: string
    value: string
    description?: string
  }>
  status?: {
    health: string
  }
}

const getCategoryColor = (category: string) => {
  const colors: Record<string, { bg: string; text: string }> = {
    'api-catalog': { bg: '#DBEAFE', text: '#1E40AF' },
    'ci-cd': { bg: '#FEF3C7', text: '#92400E' },
    infrastructure: { bg: '#DCFCE7', text: '#166534' },
    monitoring: { bg: '#FCE7F3', text: '#9F1239' },
    security: { bg: '#FEE2E2', text: '#991B1B' },
  }
  return colors[category] || { bg: '#E5E7EB', text: '#1F2937' }
}

const getStabilityColor = (stability: string) => {
  const colors: Record<string, string> = {
    stable: '#10B981',
    beta: '#F59E0B',
    experimental: '#9A9A9A',
    deprecated: '#EF4444',
  }
  return colors[stability] || '#9A9A9A'
}

const getHealthColor = (health: string) => {
  const colors: Record<string, string> = {
    healthy: '#10B981',
    degraded: '#F59E0B',
    unhealthy: '#EF4444',
    unknown: '#9A9A9A',
  }
  return colors[health] || '#9A9A9A'
}

export const WorkspacePluginsField: React.FC = () => {
  const { id: workspaceId } = useDocumentInfo()
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [pluginConfigs, setPluginConfigs] = useState<Record<string, PluginConfig>>({})
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    async function fetchData() {
      try {
        setLoading(true)
        setError(null)

        // Fetch all available plugins
        const pluginsResponse = await fetch('/api/plugin-registry?limit=100&sort=name')
        if (!pluginsResponse.ok) throw new Error('Failed to fetch plugins')
        const pluginsData = await pluginsResponse.json()
        setPlugins(pluginsData.docs || [])

        // Fetch ALL plugin configs (access control will filter to user's workspaces)
        // Then filter client-side for this specific workspace
        const configsResponse = await fetch(`/api/plugin-config?limit=1000&depth=1`)
        if (!configsResponse.ok) throw new Error('Failed to fetch plugin configs')
        const configsData = await configsResponse.json()

        // Filter to only this workspace's configs
        const workspaceConfigs = configsData.docs.filter((config: PluginConfig) => {
          const wsId =
            typeof config.workspace === 'string' ? config.workspace : config.workspace?.id
          return wsId === workspaceId
        })

        const configsMap: Record<string, PluginConfig> = {}
        workspaceConfigs.forEach((config: PluginConfig) => {
          const pluginId = typeof config.plugin === 'string' ? config.plugin : config.plugin.id
          configsMap[pluginId] = config
        })
        setPluginConfigs(configsMap)
      } catch (err) {
        console.error('Error fetching plugins:', err)
        setError(err instanceof Error ? err.message : 'Failed to load plugins')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [workspaceId])

  const handleTogglePlugin = async (plugin: Plugin, event: React.MouseEvent) => {
    event.preventDefault() // Prevent form submission
    event.stopPropagation() // Stop event bubbling

    try {
      setSaving(plugin.id)
      const existingConfig = pluginConfigs[plugin.id]

      if (existingConfig) {
        // Update existing config
        const response = await fetch(`/api/plugin-config/${existingConfig.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: !existingConfig.enabled,
          }),
        })

        if (!response.ok) throw new Error('Failed to update plugin')
        const updated = await response.json()

        setPluginConfigs((prev) => ({
          ...prev,
          [plugin.id]: { ...updated.doc },
        }))
      } else {
        // Create new config
        const response = await fetch('/api/plugin-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace: workspaceId,
            plugin: plugin.id,
            enabled: true,
            configuration: {},
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.message || 'Failed to enable plugin')
        }
        const created = await response.json()

        setPluginConfigs((prev) => ({
          ...prev,
          [plugin.id]: { ...created.doc },
        }))
      }
    } catch (err) {
      console.error('Error toggling plugin:', err)
      alert(err instanceof Error ? err.message : 'Failed to toggle plugin')
    } finally {
      setSaving(null)
    }
  }

  if (!workspaceId) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0' }}>
            Save the workspace first to manage plugins.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="field-type ui">
        <div className="render-fields">
          <p style={{ fontSize: '13px', color: '#9A9A9A', margin: '0' }}>Loading plugins...</p>
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

  const enabledCount = Object.values(pluginConfigs).filter((c) => c.enabled).length

  return (
    <div className="field-type ui">
      <div className="render-fields">
        <div
          style={{
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plug style={{ width: '20px', height: '20px', color: '#E0E0E0' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: '#E0E0E0' }}>
              Backstage Plugins
            </h3>
            <span style={{ fontSize: '13px', color: '#9A9A9A' }}>
              ({enabledCount} enabled / {plugins.length} available)
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          {plugins.map((plugin) => {
            const config = pluginConfigs[plugin.id]
            const isEnabled = config?.enabled || false
            const isExpanded = expandedPlugin === plugin.id
            const categoryColor = getCategoryColor(plugin.category)
            const stabilityColor = getStabilityColor(plugin.status?.stability || 'stable')

            return (
              <div
                key={plugin.id}
                style={{
                  padding: '16px',
                  background: '#1a1a1a',
                  border: `1px solid ${isEnabled ? '#0066FF' : '#333'}`,
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'start',
                    marginBottom: isExpanded ? '16px' : '0',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                      }}
                    >
                      <h4 style={{ fontSize: '14px', fontWeight: 600, margin: 0, color: '#E0E0E0' }}>
                        {plugin.name}
                      </h4>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          background: categoryColor.bg,
                          color: categoryColor.text,
                          borderRadius: '12px',
                          fontWeight: 500,
                          textTransform: 'capitalize',
                        }}
                      >
                        {plugin.category.replace('-', ' ')}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          background: 'rgba(255,255,255,0.1)',
                          color: '#9A9A9A',
                          borderRadius: '12px',
                          fontWeight: 500,
                        }}
                      >
                        v{plugin.metadata.version}
                      </span>
                      {plugin.status?.stability && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: stabilityColor,
                            fontWeight: 500,
                          }}
                        >
                          {plugin.status.stability}
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        fontSize: '13px',
                        color: '#9A9A9A',
                        margin: '0 0 8px',
                        lineHeight: '1.5',
                      }}
                    >
                      {plugin.description}
                    </p>
                    {config?.status?.health && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: getHealthColor(config.status.health),
                          }}
                        />
                        <span
                          style={{
                            fontSize: '12px',
                            color: getHealthColor(config.status.health),
                            textTransform: 'capitalize',
                          }}
                        >
                          {config.status.health}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {isEnabled && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setExpandedPlugin(isExpanded ? null : plugin.id)
                        }}
                        style={{
                          padding: '6px 12px',
                          background: 'transparent',
                          border: '1px solid #333',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: '#9A9A9A',
                          fontSize: '13px',
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
                        <Settings style={{ width: '14px', height: '14px' }} />
                        Configure
                        {isExpanded ? (
                          <ChevronUp style={{ width: '14px', height: '14px' }} />
                        ) : (
                          <ChevronDown style={{ width: '14px', height: '14px' }} />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleTogglePlugin(plugin, e)}
                      disabled={saving === plugin.id}
                      style={{
                        padding: '6px 12px',
                        background: isEnabled ? '#0066FF' : 'transparent',
                        border: `1px solid ${isEnabled ? '#0066FF' : '#333'}`,
                        borderRadius: '4px',
                        cursor: saving === plugin.id ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: isEnabled ? '#fff' : '#9A9A9A',
                        fontSize: '13px',
                        fontWeight: 500,
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isEnabled) {
                          e.currentTarget.style.background = '#0f0f0f'
                          e.currentTarget.style.borderColor = '#555'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isEnabled) {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.borderColor = '#333'
                        }
                      }}
                    >
                      {isEnabled ? (
                        <>
                          <Check style={{ width: '14px', height: '14px' }} />
                          Enabled
                        </>
                      ) : (
                        <>
                          <X style={{ width: '14px', height: '14px' }} />
                          Disabled
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {isExpanded && isEnabled && (
                  <div
                    style={{
                      paddingTop: '16px',
                      borderTop: '1px solid #333',
                    }}
                  >
                    <div style={{ marginBottom: '12px' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#E0E0E0', margin: '0 0 8px' }}>
                        Configuration
                      </p>
                      <p style={{ fontSize: '12px', color: '#9A9A9A', margin: '0' }}>
                        To configure this plugin, click the button below to edit the full configuration.
                      </p>
                    </div>
                    {plugin.configuration?.requiredConfigKeys &&
                      plugin.configuration.requiredConfigKeys.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                          <p style={{ fontSize: '12px', fontWeight: 600, color: '#F59E0B', margin: '0 0 4px' }}>
                            Required Configuration:
                          </p>
                          <ul style={{ fontSize: '12px', color: '#9A9A9A', margin: '0', paddingLeft: '20px' }}>
                            {plugin.configuration.requiredConfigKeys.map((key) => (
                              <li key={key.key}>
                                <strong>{key.label}</strong> ({key.type}
                                {key.isSecret ? ', secret' : ''})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    <a
                      href={`/admin/collections/plugin-config/${config.id}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <Button size="sm" style={{ width: '100%' }}>
                        <Settings className="h-3 w-3 mr-2" />
                        Edit Full Configuration
                      </Button>
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
