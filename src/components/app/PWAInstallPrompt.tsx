import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  if (!deferredPrompt || dismissed) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-[130] w-full max-w-sm rounded-[20px] border border-[#dbeafe] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
      <p className="text-sm font-extrabold text-[#1b1e20]">Install aplikasi POS</p>
      <p className="mt-1 text-sm text-[#52627d]">
        Tambahkan ke desktop atau home screen supaya terasa seperti aplikasi kasir.
      </p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-[12px] px-4 py-2 text-sm font-bold text-[#6f7b79]"
        >
          Nanti
        </button>
        <button
          type="button"
          onClick={async () => {
            await deferredPrompt.prompt()
            await deferredPrompt.userChoice
            setDeferredPrompt(null)
          }}
          className="rounded-[12px] bg-[#2563eb] px-4 py-2 text-sm font-bold text-white"
        >
          Install
        </button>
      </div>
    </div>
  )
}
