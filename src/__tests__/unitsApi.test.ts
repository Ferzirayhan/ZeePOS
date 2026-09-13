import { beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingleMock = vi.fn()
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) =>
      table === 'product_units'
        ? { select: () => ({ eq: eqMock }) }
        : { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) },
    ),
  },
}))

import { getProductUnitByBarcode } from '../api/units'

describe('getProductUnitByBarcode', () => {
  beforeEach(() => {
    maybeSingleMock.mockReset()
    eqMock.mockClear()
  })

  it('mencari product_units berdasarkan barcode', async () => {
    const unit = {
      id: 9,
      tenant_id: 't1',
      product_id: 3,
      nama_satuan: 'dus',
      rasio: 12,
      barcode: '8990001112223',
      harga_beli: 80000,
      harga_jual: 110000,
      is_default: false,
    }
    maybeSingleMock.mockResolvedValue({ data: unit, error: null })

    const result = await getProductUnitByBarcode('8990001112223')

    expect(result).toEqual(unit)
    expect(eqMock).toHaveBeenCalledWith('barcode', '8990001112223')
  })

  it('mengembalikan null ketika barcode tidak ditemukan', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    const result = await getProductUnitByBarcode('tidak-ada')
    expect(result).toBeNull()
  })

  it('throw error ketika supabase mengembalikan error', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'RPC failed' } })

    await expect(getProductUnitByBarcode('x')).rejects.toThrow('RPC failed')
  })
})
