const ESC = 0x1b
const GS = 0x1d

function textBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

export interface ReceiptData {
  store_name?: string
  store_address?: string
  store_phone?: string
  invoice: string
  created_at?: string
  cashier?: string
  customer_name?: string
  items: Array<{
    name: string
    qty: number
    price: number
  }>
  subtotal: number
  discount_total?: number
  ppn_total?: number
  grand_total: number
  payment_method_label?: string
  cash_received?: number
  change?: number
  note?: string
  footer?: string
}

function formatCurrency(val: number): string {
  return 'Rp ' + Number(val || 0).toLocaleString('id-ID')
}

export function buildReceiptBytes(data: ReceiptData, paperSize: '58mm' | '80mm' = '58mm'): Uint8Array {
  const width = paperSize === '58mm' ? 32 : 48
  const bytes: number[] = []

  // Reset printer
  bytes.push(ESC, 0x40)

  const center = (text: string) => {
    const pad = Math.max(0, Math.floor((width - text.length) / 2))
    bytes.push(...textBytes(' '.repeat(pad) + text + '\n'))
  }

  const leftRight = (l: string, r: string) => {
    const space = Math.max(1, width - l.length - r.length)
    bytes.push(...textBytes(l + ' '.repeat(space) + r + '\n'))
  }

  const line = () => {
    bytes.push(...textBytes('-'.repeat(width) + '\n'))
  }

  const doubleLine = () => {
    bytes.push(...textBytes('='.repeat(width) + '\n'))
  }

  const bold = (on: boolean) => {
    bytes.push(ESC, 0x45, on ? 0x01 : 0x00)
  }

  // Header Toko
  bold(true)
  center(data.store_name || 'ZEEPOS STORE')
  bold(false)

  if (data.store_address) center(data.store_address.slice(0, width))
  if (data.store_phone) center(`Telp: ${data.store_phone}`)
  line()

  // Info Transaksi
  leftRight(`#${data.invoice}`, data.created_at || '')
  if (data.cashier) leftRight('Kasir', data.cashier)
  if (data.customer_name) leftRight('Pelanggan', data.customer_name)
  doubleLine()

  // Daftar Barang
  for (const item of data.items) {
    const title = item.name.slice(0, width)
    bytes.push(...textBytes(title + '\n'))
    leftRight(`  ${item.qty}x`, formatCurrency(item.price))
  }

  line()

  // Ringkasan Harga
  leftRight('Subtotal', formatCurrency(data.subtotal))
  if (data.discount_total && data.discount_total > 0) {
    leftRight('Diskon', `-${formatCurrency(data.discount_total)}`)
  }
  if (data.ppn_total && data.ppn_total > 0) {
    leftRight('PPN', `+${formatCurrency(data.ppn_total)}`)
  }

  bold(true)
  leftRight('TOTAL', formatCurrency(data.grand_total))
  bold(false)
  line()

  // Pembayaran
  if (data.payment_method_label) leftRight('Metode', data.payment_method_label)
  if (data.cash_received != null && data.cash_received > 0) {
    leftRight('Bayar', formatCurrency(data.cash_received))
  }
  if (data.change != null && data.change > 0) {
    bold(true)
    leftRight('Kembalian', formatCurrency(data.change))
    bold(false)
  }

  if (data.note) {
    line()
    bytes.push(...textBytes(`Catatan: ${data.note.slice(0, width * 2)}\n`))
  }

  line()
  center(data.footer || 'Terima kasih atas kunjungan Anda!')
  bytes.push(...textBytes('\n\n\n'))

  // Auto-cut paper: GS V 66 0
  bytes.push(GS, 0x56, 0x42, 0x00)

  return new Uint8Array(bytes)
}

export function drawerKickBytes(pin: 2 | 5 = 2): Uint8Array {
  return new Uint8Array([ESC, 0x70, pin === 5 ? 0x01 : 0x00, 0x19, 0xfa])
}

interface WebUSBEndpoint {
  endpointNumber: number
  direction: 'in' | 'out'
}

interface WebUSBAlternate {
  interfaceClass: number
  endpoints: WebUSBEndpoint[]
}

interface WebUSBInterface {
  interfaceNumber: number
  alternates: WebUSBAlternate[]
}

interface WebUSBConfiguration {
  interfaces: WebUSBInterface[]
}

interface WebUSBDevice {
  opened: boolean
  configuration: WebUSBConfiguration | null
  configurations: WebUSBConfiguration[]
  open: () => Promise<void>
  close: () => Promise<void>
  selectConfiguration: (configurationValue: number) => Promise<void>
  claimInterface: (interfaceNumber: number) => Promise<void>
  transferOut: (endpointNumber: number, data: unknown) => Promise<unknown>
}

let cachedDevice: WebUSBDevice | null = null
let cachedEndpoint: number = 1

export async function requestThermalPrinter(): Promise<WebUSBDevice> {
  const nav = navigator as unknown as { usb?: { requestDevice: (opt: { filters: unknown[] }) => Promise<WebUSBDevice> } }
  if (!nav.usb) {
    throw new Error('WebUSB tidak didukung pada browser ini. Silakan gunakan Chrome atau Edge.')
  }

  const device = await nav.usb.requestDevice({ filters: [] })
  await device.open()
  if (device.configuration === null) {
    await device.selectConfiguration(1)
  }

  let interfaceNumber: number | null = null
  let endpointNumber: number | null = null

  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass === 7) {
          interfaceNumber = iface.interfaceNumber
          endpointNumber = alt.endpoints.find((e) => e.direction === 'out')?.endpointNumber ?? null
        }
      }
    }
  }

  if (interfaceNumber === null) {
    for (const config of device.configurations) {
      for (const iface of config.interfaces) {
        for (const alt of iface.alternates) {
          const out = alt.endpoints.find((e) => e.direction === 'out')
          if (out && interfaceNumber === null) {
            interfaceNumber = iface.interfaceNumber
            endpointNumber = out.endpointNumber
          }
        }
      }
    }
  }

  if (interfaceNumber === null) {
    await device.close()
    throw new Error('Antarmuka printer USB tidak terdeteksi pada perangkat ini.')
  }

  await device.claimInterface(interfaceNumber)
  cachedDevice = device
  cachedEndpoint = endpointNumber ?? 1
  return device
}

export async function printToThermal(bytes: Uint8Array): Promise<void> {
  if (!cachedDevice || !cachedDevice.opened) {
    await requestThermalPrinter()
  }

  if (!cachedDevice) {
    throw new Error('Printer thermal belum terhubung.')
  }

  await cachedDevice.transferOut(cachedEndpoint, bytes)
}

export async function kickCashDrawer(): Promise<void> {
  await printToThermal(drawerKickBytes())
}
