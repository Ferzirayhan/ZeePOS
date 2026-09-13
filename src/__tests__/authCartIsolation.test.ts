import { describe, expect, it } from 'vitest'
import authStore from '../stores/authStore.ts?raw'
import { hasAuthIdentityChanged } from '../stores/authIdentity'

describe('active cart account isolation', () => {
  it('does not treat the initial sign-in as an account switch', () => {
    expect(hasAuthIdentityChanged(null, null, 'user-a', 'tenant-a')).toBe(false)
  })

  it('preserves the cart when a same-user SIGNED_IN event repeats', () => {
    expect(hasAuthIdentityChanged('user-a', 'tenant-a', 'user-a', 'tenant-a')).toBe(false)
  })

  it('detects a user switch even when both users share a tenant', () => {
    expect(hasAuthIdentityChanged('user-a', 'tenant-a', 'user-b', 'tenant-a')).toBe(true)
  })

  it('detects a tenant switch for the same authenticated user', () => {
    expect(hasAuthIdentityChanged('user-a', 'tenant-a', 'user-a', 'tenant-b')).toBe(true)
  })

  it('clears the active cart on auth identity changes and explicit logout', () => {
    expect(authStore).toMatch(/hasAuthIdentityChanged\([\s\S]*useCartStore\.getState\(\)\.clearCart\(\)/)
    const explicitLogout = authStore.match(/logout:\s*async[\s\S]*?\n\s*getProfile:/)?.[0] ?? ''
    expect(explicitLogout).toMatch(/useCartStore\.getState\(\)\.clearCart\(\)/)
  })
})
