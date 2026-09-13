import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem } from '../types'
import type { MetodeBayar } from '../types/database'

export interface HeldCart {
  id: string
  label: string
  created_at: string
  items: CartItem[]
  diskon_persen: number
  use_ppn: boolean
  ppn_persen: number
  metode_bayar: MetodeBayar
  total: number
}

interface HeldCartStore {
  heldCarts: HeldCart[]
  holdCurrentCart: (payload: {
    label?: string
    items: CartItem[]
    diskon_persen: number
    use_ppn: boolean
    ppn_persen: number
    metode_bayar: MetodeBayar
    total: number
  }) => string
  resumeHeldCart: (id: string) => HeldCart | null
  deleteHeldCart: (id: string) => void
  clearAllHeldCarts: () => void
}

export const useHeldCartStore = create<HeldCartStore>()(
  persist(
    (set, get) => ({
      heldCarts: [],

      holdCurrentCart: (payload) => {
        const id = `HOLD-${Date.now()}`
        const count = get().heldCarts.length + 1
        const defaultLabel = `Pesanan #${count}`
        const newHeld: HeldCart = {
          id,
          label: payload.label?.trim() || defaultLabel,
          created_at: new Date().toISOString(),
          items: payload.items,
          diskon_persen: payload.diskon_persen,
          use_ppn: payload.use_ppn,
          ppn_persen: payload.ppn_persen,
          metode_bayar: payload.metode_bayar,
          total: payload.total,
        }

        set((state) => ({
          heldCarts: [newHeld, ...state.heldCarts],
        }))

        return id
      },

      resumeHeldCart: (id) => {
        const target = get().heldCarts.find((h) => h.id === id) || null
        if (target) {
          set((state) => ({
            heldCarts: state.heldCarts.filter((h) => h.id !== id),
          }))
        }
        return target
      },

      deleteHeldCart: (id) => {
        set((state) => ({
          heldCarts: state.heldCarts.filter((h) => h.id !== id),
        }))
      },

      clearAllHeldCarts: () => {
        set({ heldCarts: [] })
      },
    }),
    {
      name: 'zeepos_held_carts',
    },
  ),
)
