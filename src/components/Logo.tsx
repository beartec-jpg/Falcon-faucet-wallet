import Image from 'next/image'

export default function Logo() {
  return (
    <div className="flex justify-center">
      <div className="w-40 h-40 rounded-2xl overflow-hidden flex-shrink-0 shadow-lg border border-brand-500/20">
        <Image src="/falcon-logo.png" alt="Falcon Ledger logo" width={160} height={160} priority className="w-full h-full object-contain" />
      </div>
    </div>
  )
}
