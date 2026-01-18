'use client'

import React, { useState } from 'react'
import type { TextFieldClientProps } from 'payload'
import { TextInput, useField } from '@payloadcms/ui'

export const EncryptedField: React.FC<TextFieldClientProps> = (props) => {
  const { path, field } = props
  const fieldLabel = field?.label
  const required = field?.required
  const [showValue, setShowValue] = useState(false)

  const { value, setValue } = useField<string>({
    path,
  })

  // Get label text - handle both string and localized label formats
  const labelText = typeof fieldLabel === 'string' ? fieldLabel : 'Secret Value'

  return (
    <div className="field-type text">
      <label className="field-label">
        {labelText}
        {required && <span className="required">*</span>}
      </label>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <TextInput
            path={path}
            value={value || ''}
            onChange={setValue}
            showError={false}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowValue(!showValue)}
          style={{
            padding: '8px 16px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            background: '#f5f5f5',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          {showValue ? 'Hide' : 'Show'}
        </button>
      </div>

      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
        This value will be encrypted when saved
      </div>
    </div>
  )
}
