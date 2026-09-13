import { supabase } from '../lib/supabase'
import type { Profile, UserRole } from '../types/database'

export interface CreateStaffInput {
  email: string
  password: string
  nama: string
  username: string
  role?: UserRole
}

export async function getStaffList(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function createStaffMember(input: CreateStaffInput): Promise<void> {
  const { error } = await supabase.rpc('create_staff_member', {
    p_email: input.email,
    p_password: input.password,
    p_nama: input.nama,
    p_username: input.username,
    p_role: input.role ?? 'kasir',
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function resetStaffPassword(userId: string, newPassword: string): Promise<void> {
  const { error } = await supabase.rpc('reset_staff_password', {
    p_user_id: userId,
    p_new_password: newPassword,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function updateStaffStatus(userId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (error) {
    throw new Error(error.message)
  }
}
