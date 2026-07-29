import Image from 'next/image'

export default function Logo({
  size = 160,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <div className={`flex justify-center ${className}`}>
      <div
        className="relative rounded-2xl overflow-hidden flex-shrink-0 border border-brand-500/30 bg-slate-950/40"
        style={{
          width: size,
          height: size,
          boxShadow: '0 0 40px rgba(192,120,56,0.25), 0 0 80px rgba(224,168,74,0.1)',
        }}
      >
        {/* Soft gold ring glow */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 50% 45%, rgba(224,168,74,0.18) 0%, transparent 65%)',
          }}
        />
        <Image
          src="/falcon-logo.png"
          alt="Falcon Ledger logo"
          width={size}
          height={size}
          priority
          className="relative w-full h-full object-contain p-2"
        />
      </div>
    </div>
  )
}
