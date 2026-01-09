'use client'

import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface MonthPickerProps {
  value: Date
  onChange: (start: Date, end: Date) => void
  monthsBack?: number
}

export function MonthPicker({ value, onChange, monthsBack = 12 }: MonthPickerProps) {
  const months = Array.from({ length: monthsBack }, (_, i) => {
    const date = subMonths(new Date(), i)
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy'),
      start: startOfMonth(date),
      end: endOfMonth(date),
    }
  })

  const handleChange = (monthValue: string) => {
    const month = months.find(m => m.value === monthValue)
    if (month) {
      onChange(month.start, month.end)
    }
  }

  return (
    <Select value={format(value, 'yyyy-MM')} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select month" />
      </SelectTrigger>
      <SelectContent>
        {months.map(month => (
          <SelectItem key={month.value} value={month.value}>
            {month.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
