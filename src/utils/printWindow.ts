// Safe print-window helper.
//
// Replaces raw document.write + template-string interpolation of database
// strings (store name, header/footer struk, product name) which let a stored
// value such as `</title><script>alert(1)</script>` execute in the popup.
//
// The helper builds the static document skeleton once via document.write,
// then injects every data value as Element.textContent so the browser
// auto-escapes it. Trusted static markup (e.g. a generated barcode SVG) is
// injected through a separate innerHTML slot so the two paths never cross.

export interface PrintSlot {
  id: string
  text?: string
  trustedHtml?: string
}

export interface SafePrintDocument {
  title: string
  styleCss: string
  slots: PrintSlot[]
}

export function openPrintWindow(url: string, width: string, height: string): Window | null {
  const popup = window.open(url, '_blank', `width=${width},height=${height}`)
  if (!popup) {
    return null
  }
  popup.opener = null
  return popup
}

export function writeSafePrintDocument(
  doc: Document,
  popup: { focus: () => void; print: () => void; close?: () => void },
  options: SafePrintDocument,
): void {
  const slotSkeleton = options.slots
    .map((slot) => `<div id="${slot.id}"></div>`)
    .join('')
  const styleTag = options.styleCss ? `<style>${options.styleCss}</style>` : ''
  doc.open()
  doc.write(
    `<!DOCTYPE html><html><head><title></title>${styleTag}</head><body>${slotSkeleton}</body></html>`,
  )

  // Inject data values AFTER writing the skeleton but BEFORE close(), so the
  // nodes exist in the live document. textContent auto-escapes; trustedHtml is
  // reserved for static generated markup (e.g. barcode SVG) that never comes
  // from a database string.
  doc.title = options.title
  for (const slot of options.slots) {
    const node = doc.getElementById(slot.id)
    if (!node) {
      continue
    }
    if (slot.trustedHtml !== undefined) {
      node.innerHTML = slot.trustedHtml
    }
    if (slot.text !== undefined) {
      node.textContent = slot.text
    }
  }

  doc.close()
  popup.focus()
  popup.print()
}
