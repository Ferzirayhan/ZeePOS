import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

export function formatDateIndonesia(value: string | Date, pattern = 'dd MMMM yyyy') {
  return format(new Date(value), pattern, { locale: localeId })
}

export function formatDateTimeIndonesia(value: string | Date) {
  return formatDateIndonesia(value, 'dd MMM yyyy, HH:mm')
}

export function getISOStartOfDay(dateStr: string): string {
  if (!dateStr) return ''
  if (dateStr.includes('T')) return dateStr
  return `${dateStr}T00:00:00+07:00`
}

export function getISOEndOfDay(dateStr: string): string {
  if (!dateStr) return ''
  if (dateStr.includes('T')) return dateStr
  return `${dateStr}T23:59:59+07:00`
}

export function formatLocalDateKey(isoString: string | null | undefined): string {
  if (!isoString) return ''
  return format(new Date(isoString), 'yyyy-MM-dd')
}

