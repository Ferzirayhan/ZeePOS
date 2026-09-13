import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { openPrintWindow, writeSafePrintDocument, type PrintSlot } from '../utils/printWindow'

describe('openPrintWindow', () => {
  const originalOpen = window.open

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    window.open = originalOpen
  })

  it('returns null when the popup is blocked (window.open returns null)', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const result = openPrintWindow('', '420', '600')
    expect(result).toBeNull()
  })

  it('opens with _blank and width/height features', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    openPrintWindow('', '420', '600')
    expect(openSpy).toHaveBeenCalledWith('', '_blank', 'width=420,height=600')
  })

  it('severs the popup opener reference so the print window cannot reach back into the POS window', () => {
    const popup = { opener: window } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const handle = openPrintWindow('', '420', '600')
    expect(handle).toBe(popup)
    expect(popup.opener).toBeNull()
  })
})

describe('writeSafePrintDocument', () => {
  it('writes a full document shell and closes, focuses, and prints the window', () => {
    const slots: PrintSlot[] = [{ id: 'heading', text: 'Toko Saya' }]
    const popup = {
      opener: null,
      document: document,
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    } as unknown as Window & { document: Document }

    writeSafePrintDocument(popup.document, popup, {
      title: 'Test Struk',
      styleCss: 'body{font-family:sans-serif}',
      slots,
    })

    expect(document.title).toBe('Test Struk')
    expect(document.doctype).not.toBeNull()
    expect(document.doctype?.name).toBe('html')
    expect(document.documentElement.outerHTML).toContain('font-family:sans-serif')
    expect(popup.focus).toHaveBeenCalledOnce()
    expect(popup.print).toHaveBeenCalledOnce()
  })

  it('renders a malicious store name as plain text, never as executable markup', () => {
    const malicious = '"><script>alert("pwned")</script><img src=x onerror=alert(1)>'
    const slots: PrintSlot[] = [{ id: 'nama', text: malicious }]
    const popup = {
      opener: null,
      document: document,
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    } as unknown as Window & { document: Document }

    writeSafePrintDocument(popup.document, popup, { title: malicious, styleCss: '', slots })

    const node = document.querySelector('#nama')
    expect(node).not.toBeNull()
    // textContent returns the raw string back, proving it was stored as text.
    expect(node?.textContent).toBe(malicious)
    // The serialized DOM must not contain a live <script> element or a live
    // <img> element carrying an onerror handler. (The escaped payload text
    // legitimately contains the substring "onerror=alert(1)", so we assert
    // against live element/attribute presence, not the raw string.)
    expect(document.querySelector('script')).toBeNull()
    const liveImg = document.querySelector('img[onerror]')
    expect(liveImg).toBeNull()
  })

  it('injects trusted static markup (barcode SVG) verbatim via a separate trustedHtml slot', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    const slots: PrintSlot[] = [
      { id: 'nama', text: 'Kopi Sachet' },
      { id: 'barcode', trustedHtml: svg },
    ]
    const popup = {
      opener: null,
      document: document,
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    } as unknown as Window & { document: Document }

    writeSafePrintDocument(popup.document, popup, { title: 'Barcode', styleCss: '', slots })

    const barcodeNode = document.querySelector('#barcode')
    expect(barcodeNode?.querySelector('svg')).not.toBeNull()
    expect(barcodeNode?.querySelector('rect')?.getAttribute('width')).toBe('10')
    expect(document.querySelector('#nama')?.textContent).toBe('Kopi Sachet')
  })
})
