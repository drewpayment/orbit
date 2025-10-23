'use client'

import React, { useState } from 'react'
import type { TextFieldClientProps } from 'payload'
import { TextInput, useField } from '@payloadcms/ui'

export const EncryptedField: React.FC<TextFieldClientProps> = (props) => {
  const { path, label, required } = props
  const [showValue, setShowValue] = useState(false)

  const { value, setValue } = useField<string>({
    path,
  })

  return (
    <div className="field-type text">
      <label className="field-label">
        {label || 'Secret Value'}
        {required && <span className="required">*</span>}
      </label>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <TextInput
            path={path}
            name={path}
            value={value || ''}
            onChange={setValue}
            type={showValue ? 'text' : 'password'}
            placeholder={showValue ? 'Enter secret value' : '••••••••••••'}
            autoComplete="off"
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
