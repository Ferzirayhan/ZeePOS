/**
 * Klaster D — NumpadModal presisi desimal (task 11.2, design D.1).
 *
 * Dua sisi yang diuji bersama:
 *  - Property 16: baris bersatuan pecahan dapat mengetik 0,25 / 0,5 / 0,75 dan
 *    digit yang melewati presisi baris ditolak.
 *  - Property 17: dengan `decimalPlaces` default (0), numpad berperilaku persis
 *    seperti sebelum perubahan — tidak ada tombol separator, tidak ada koma.
 *
 * **Validates: Requirements 2.9, 3.4**
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NumpadModal } from '../components/pos/NumpadModal'

interface RenderOptions {
  initialValue?: number
  decimalPlaces?: number
  minValue?: number
  maxValue?: number
  isCurrency?: boolean
  quickOptions?: number[]
}

function renderNumpad(options: RenderOptions = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <NumpadModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      title="Qty"
      initialValue={options.initialValue ?? 0}
      decimalPlaces={options.decimalPlaces}
      minValue={options.minValue}
      maxValue={options.maxValue}
      isCurrency={options.isCurrency}
      quickOptions={options.quickOptions}
    />,
  )
  return { onConfirm, onClose }
}

/** Baris kedua di kartu display adalah nilai yang sedang diketik. */
function displayText(): string {
  const label = screen.getByText('Input Nilai')
  const paragraphs = label.parentElement?.querySelectorAll('p') ?? []
  return paragraphs[1]?.textContent ?? ''
}

function press(key: string) {
  fireEvent.click(screen.getByRole('button', { name: key }))
}

/** Tombol konfirmasi memuat ikon, jadi nama aksesibelnya bukan string persis. */
function confirmValue() {
  fireEvent.click(screen.getByRole('button', { name: /Konfirmasi/i }))
}

function separatorButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /^[,.]$/ })
}

describe('NumpadModal — tombol separator desimal', () => {
  it('tidak merender separator ketika decimalPlaces tidak diberikan (jalur bilangan bulat)', () => {
    renderNumpad()
    expect(separatorButton()).toBeNull()
  })

  it('tidak merender separator ketika decimalPlaces = 0', () => {
    renderNumpad({ decimalPlaces: 0 })
    expect(separatorButton()).toBeNull()
  })

  it('merender separator ketika decimalPlaces > 0', () => {
    renderNumpad({ decimalPlaces: 3 })
    expect(separatorButton()).not.toBeNull()
  })

  it('menolak separator kedua: tombol disabled dan nilai tidak berubah', () => {
    renderNumpad({ decimalPlaces: 3 })

    press('5')
    fireEvent.click(separatorButton()!)
    press('2')
    expect(displayText()).toBe('5,2')

    const separator = separatorButton()!
    expect(separator).toBeDisabled()
    fireEvent.click(separator)
    expect(displayText()).toBe('5,2')
  })

  it('mengetik 0,25 dari nol: separator lalu dua digit', () => {
    const { onConfirm } = renderNumpad({ decimalPlaces: 3, minValue: 0.001, maxValue: 10 })

    fireEvent.click(separatorButton()!)
    expect(displayText()).toBe('0,')
    press('2')
    press('5')
    expect(displayText()).toBe('0,25')

    confirmValue()
    expect(onConfirm).toHaveBeenCalledWith(0.25)
  })
})

describe('NumpadModal — batas presisi baris', () => {
  it('menolak digit setelah presisi penuh: 0,25 pada 2 desimal tetap 0,25', () => {
    const { onConfirm } = renderNumpad({
      initialValue: 0.25,
      decimalPlaces: 2,
      minValue: 0.01,
      maxValue: 3,
    })

    expect(displayText()).toBe('0,25')
    press('5')
    expect(displayText()).toBe('0,25')

    confirmValue()
    expect(onConfirm).toHaveBeenCalledWith(0.25)
  })

  it('menolak digit ke-4 pada plafon 3 desimal (NUMERIC(12,3))', () => {
    renderNumpad({ initialValue: 1.234, decimalPlaces: 3, maxValue: 100 })

    expect(displayText()).toBe('1,234')
    press('5')
    expect(displayText()).toBe('1,234')
  })

  it('masih menerima digit selama presisi belum penuh', () => {
    renderNumpad({ initialValue: 0.5, decimalPlaces: 3, maxValue: 100 })

    expect(displayText()).toBe('0,5')
    press('7')
    press('5')
    expect(displayText()).toBe('0,575')
  })
})

describe('NumpadModal — normalisasi initialValue', () => {
  it('membuang nol berlebih: 0,250 menjadi 0,25', () => {
    renderNumpad({ initialValue: 0.25, decimalPlaces: 3 })
    expect(displayText()).toBe('0,25')
  })

  it('bilangan bulat pada satuan pecahan tidak mendapat ekor desimal', () => {
    renderNumpad({ initialValue: 3, decimalPlaces: 3 })
    expect(displayText()).toBe('3')
  })

  it('nol tetap nol', () => {
    renderNumpad({ initialValue: 0, decimalPlaces: 3 })
    expect(displayText()).toBe('0')
  })
})

describe('NumpadModal — penegakan minValue / maxValue', () => {
  it('menolak konfirmasi di bawah minValue tanpa menutup modal', () => {
    const { onConfirm, onClose } = renderNumpad({
      initialValue: 0,
      decimalPlaces: 3,
      minValue: 0.001,
      maxValue: 5,
    })

    confirmValue()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('menolak digit yang membuat nilai melewati maxValue', () => {
    renderNumpad({ decimalPlaces: 3, minValue: 0.001, maxValue: 3 })

    press('3')
    fireEvent.click(separatorButton()!)
    press('5')
    expect(displayText()).toBe('3,')
  })

  it('membulatkan ke decimalPlaces sebelum membandingkan dengan batas', () => {
    // 0.30000000000000004 adalah hasil khas 0.1 + 0.2. Tanpa pembulatan
    // sebelum perbandingan, nilai ini ditolak oleh maxValue 0.3.
    const { onConfirm, onClose } = renderNumpad({
      initialValue: 0.1 + 0.2,
      decimalPlaces: 2,
      minValue: 0.01,
      maxValue: 0.3,
    })

    expect(displayText()).toBe('0,3')
    confirmValue()
    expect(onConfirm).toHaveBeenCalledWith(0.3)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('NumpadModal — keyboard', () => {
  it('menerima koma maupun titik sebagai separator desimal', () => {
    renderNumpad({ decimalPlaces: 3, maxValue: 100 })

    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: ',' })
    fireEvent.keyDown(window, { key: '5' })
    expect(displayText()).toBe('2,5')

    // Separator kedua diabaikan, apa pun bentuk tombolnya.
    fireEvent.keyDown(window, { key: '.' })
    fireEvent.keyDown(window, { key: '7' })
    expect(displayText()).toBe('2,57')
  })

  it('mengabaikan separator pada jalur bilangan bulat', () => {
    renderNumpad({ decimalPlaces: 0, maxValue: 100 })

    fireEvent.keyDown(window, { key: '2' })
    fireEvent.keyDown(window, { key: ',' })
    fireEvent.keyDown(window, { key: '5' })
    expect(displayText()).toBe('25')
  })
})

describe('NumpadModal — jalur bilangan bulat tidak berubah (Property 17)', () => {
  it('mengetik qty bulat dan mengonfirmasi bilangan bulat', () => {
    const { onConfirm, onClose } = renderNumpad({ initialValue: 1, maxValue: 9999 })

    expect(displayText()).toBe('1')
    press('2')
    expect(displayText()).toBe('12')
    confirmValue()

    expect(onConfirm).toHaveBeenCalledWith(12)
    expect(onClose).toHaveBeenCalled()
  })

  it('digit pertama menimpa nol awal dan pemisah ribuan id-ID tetap dipakai', () => {
    renderNumpad({ initialValue: 0, maxValue: 999999 })

    press('1')
    press('2')
    press('3')
    press('4')
    expect(displayText()).toBe('1.234')
  })

  it('jalur rupiah tetap berprefiks Rp tanpa desimal', () => {
    renderNumpad({ initialValue: 0, isCurrency: true, quickOptions: [50000] })

    press('5')
    press('0')
    press('0')
    press('0')
    expect(displayText()).toBe('Rp 5.000')
    expect(separatorButton()).toBeNull()
  })

  it('C dan backspace berperilaku seperti sebelumnya', () => {
    renderNumpad({ initialValue: 25, maxValue: 9999 })

    press('backspace')
    expect(displayText()).toBe('2')
    press('C')
    expect(displayText()).toBe('0')
  })
})

describe('NumpadModal — quickOptions', () => {
  it('menampilkan opsi pecahan dengan koma dan memakainya sebagai nilai', () => {
    const { onConfirm } = renderNumpad({
      decimalPlaces: 3,
      minValue: 0.001,
      maxValue: 10,
      quickOptions: [0.25, 0.5, 1],
    })

    fireEvent.click(screen.getByRole('button', { name: '0,25' }))
    expect(displayText()).toBe('0,25')

    confirmValue()
    expect(onConfirm).toHaveBeenCalledWith(0.25)
  })
})
