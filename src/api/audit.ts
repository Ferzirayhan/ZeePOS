import { supabase } from '../lib/supabase'
import type { UserRole } from '../types/database'
import { getISOEndOfDay, getISOStartOfDay } from '../utils/date'

export interface AuditLogItem {
  id: number
  userId: string | null
  entityType: string
  entityId: string | null
  action: string
  description: string
  metadata: Record<string, unknown>
  createdAt: string | null
  actorNama: string | null
  actorRole: UserRole | null
}

export interface AuditLogFilters {
  dateFrom?: string
  dateTo?: string
  action?: string
  limit?: number
}

export async function getAuditLogs(
  filters: AuditLogFilters = {},
): Promise<AuditLogItem[]> {
  let query = supabase
    .from('audit_logs_with_user')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.dateFrom) {
    query = query.gte('created_at', getISOStartOfDay(filters.dateFrom))
  }

  if (filters.dateTo) {
    query = query.lte('created_at', getISOEndOfDay(filters.dateTo))
  }

  if (filters.action && filters.action !== 'all') {
    query = query.eq('action', filters.action)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((item) => ({
    id: item.id ?? 0,
    userId: item.user_id ?? null,
    entityType: item.entity_type ?? 'system',
    entityId: item.entity_id ?? null,
    action: item.action ?? 'unknown',
    description: item.description ?? '-',
    metadata:
      item.metadata && typeof item.metadata === 'object'
        ? (item.metadata as Record<string, unknown>)
        : {},
    createdAt: item.created_at ?? null,
    actorNama: item.actor_nama ?? null,
    actorRole: item.actor_role ?? null,
  }))
}
