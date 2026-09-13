import { useReactToPrint } from 'react-to-print'
import { receiptPrintPageStyle } from '../components/pos/ReceiptPrint'
import { supabase } from '../lib/supabase'

interface UsePrintOptions {
  contentRef: React.RefObject<HTMLElement | null>
  documentTitle?: string
}

export function usePrint({ contentRef, documentTitle }: UsePrintOptions) {
  return useReactToPrint({
    contentRef,
    documentTitle,
    pageStyle: receiptPrintPageStyle,
    onAfterPrint: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || !documentTitle) {
        return
      }

      await supabase.rpc('log_my_audit_event' as never, {
        p_entity_type: 'transaction',
        p_entity_id: documentTitle,
        p_action: 'receipt_reprint',
        p_description: `Struk ${documentTitle} dicetak ulang.`,
        p_metadata: {
          nomor_nota: documentTitle,
        },
      } as never)
    },
  })
}
