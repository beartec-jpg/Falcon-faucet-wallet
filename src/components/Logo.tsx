import Image from 'next/image'

export default function Logo() {
  return (
    <div className="flex justify-center">
      <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 shadow-lg border border-brand-500/20">
        <Image src="/falcon-logo.png" alt="Falcon Ledger" width={96} height={96} priority className="w-full h-full object-contain" />
      </div>
    </div>
  )
}
