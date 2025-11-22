'use client'

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import type { CommandItem } from './slash-command'

interface CommandsListProps {
  items: CommandItem[]
  command: (item: CommandItem) => void
}

export const CommandsList = forwardRef((props: CommandsListProps, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      props.command(item)
    }
  }

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
  }

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }

      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }

      if (event.key === 'Enter') {
        enterHandler()
        return true
      }

      return false
    },
  }))

  return (
    <div className="z-50 w-72 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
      {props.items.length > 0 ? (
        <div className="py-1">
          {props.items.map((item, index) => (
            <button
              key={index}
              className={`w-full flex items-start gap-3 px-4 py-2 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-blue-50 text-blue-900'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => selectItem(index)}
            >
              <span className="flex-shrink-0 text-xl w-8 text-center">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{item.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-2 text-sm text-gray-500">No results</div>
      )}
    </div>
  )
})

CommandsList.displayName = 'CommandsList'
