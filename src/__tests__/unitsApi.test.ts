import { beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingleMock = vi.fn()
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }))

// Query berantai untuk getProductUnits / getAdminProductUnits:
// .select(kolom).eq('product_id', id).order('rasio', ...)
const orderMock = vi.fn()
const listEqMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ order: orderMock }))
const selectMock = vi.fn<(...args: unknown[]) => unknown>(() => ({
  eq: listEqMock,
  maybeSingle: maybeSingleMock,
}))
const fromMock = vi.fn((table: string) =>
  table === 'product_units' || table === 'product_units_admin'
    ? { select: selectMock }
    : { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) },
)

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}))

import { getAdminProductUnits, getProductUnitByBarcode, getProductUnits } from '../api/units'

describe('getProductUnitByBarcode', () => {
  beforeEach(() => {
    maybeSingleMock.mockReset()
    eqMock.mockClear()
    selectMock.mockClear()
    listEqMock.mockClear()
    orderMock.mockReset()
    fromMock.mockClear()
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
    selectMock.mockReturnValueOnce({ eq: eqMock, maybeSingle: maybeSingleMock })
    maybeSingleMock.mockResolvedValue({ data: unit, error: null })

    const result = await getProductUnitByBarcode('8990001112223')

    expect(result).toEqual(unit)
    expect(eqMock).toHaveBeenCalledWith('barcode', '8990001112223')
  })

  it('mengembalikan null ketika barcode tidak ditemukan', async () => {
    selectMock.mockReturnValueOnce({ eq: eqMock, maybeSingle: maybeSingleMock })
    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    const result = await getProductUnitByBarcode('tidak-ada')
    expect(result).toBeNull()
  })

  it('throw error ketika supabase mengembalikan error', async () => {
    selectMock.mockReturnValueOnce({ eq: eqMock, maybeSingle: maybeSingleMock })
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'RPC failed' } })

    await expect(getProductUnitByBarcode('x')).rejects.toThrow('RPC failed')
  })
})

describe('jalur baca satuan produk', () => {
  beforeEach(() => {
    maybeSingleMock.mockReset()
    selectMock.mockClear()
    listEqMock.mockClear()
    orderMock.mockReset()
    fromMock.mockClear()
  })

  it('getProductUnits memakai daftar kolom eksplisit tanpa harga_beli', async () => {
    orderMock.mockResolvedValue({ data: [], error: null })

    await getProductUnits(7)

    expect(fromMock).toHaveBeenCalledWith('product_units')
    const columns = selectMock.mock.calls[0]?.[0] as unknown as string
    expect(columns).not.toContain('*')
    expect(columns).not.toContain('harga_beli')
    expect(columns).toContain('harga_jual')
    expect(columns).toContain('rasio')
    expect(listEqMock).toHaveBeenCalledWith('product_id', 7)
  })

  it('getAdminProductUnits membaca product_units_admin dan memuat harga_beli', async () => {
    orderMock.mockResolvedValue({
      data: [
        {
          id: 1,
          tenant_id: 't1',
          product_id: 7,
          nama_satuan: 'dus',
          rasio: 12,
          barcode: null,
          harga_beli: 80000,
          harga_jual: 110000,
          is_default: false,
          created_at: null,
        },
      ],
      error: null,
    })

    const result = await getAdminProductUnits(7)

    expect(fromMock).toHaveBeenCalledWith('product_units_admin')
    const columns = selectMock.mock.calls[0]?.[0] as unknown as string
    expect(columns).not.toContain('*')
    expect(columns).toContain('harga_beli')
    expect(result[0]?.harga_beli).toBe(80000)
  })

  it('getAdminProductUnits mengembalikan array kosong untuk sesi non-admin', async () => {
    // View admin digerbangi is_admin() di dalam definisinya: non-admin
    // menerima nol baris, bukan error.
    orderMock.mockResolvedValue({ data: [], error: null })

    await expect(getAdminProductUnits(7)).resolves.toEqual([])
  })
})
