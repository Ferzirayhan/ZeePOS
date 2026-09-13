import { supabase } from '../lib/supabase'
import type { StoreSetting } from '../types/database'

export type SettingsMap = Record<string, string>

export async function getSettings(): Promise<SettingsMap> {
  const { data, error } = await supabase
    .from('store_settings')
    .select('*')
    .order('key', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).reduce<SettingsMap>((accumulator, item) => {
    accumulator[item.key] = item.value ?? ''
    return accumulator
  }, {})
}

export async function updateSettings(data: SettingsMap): Promise<StoreSetting[]> {
  const payload = Object.entries(data).map(([key, value]) => ({
    key,
    value,
  }))

  const { data: response, error } = await supabase
    .from('store_settings')
    .upsert(payload, { onConflict: 'tenant_id,key' })
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return response ?? []
}
