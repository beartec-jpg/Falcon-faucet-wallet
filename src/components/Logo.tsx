'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function Logo() {
  const [imageError, setImageError] = useState(false)

  return (
    <div className="flex justify-center">
      <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 shadow-lg border border-brand-500/20 flex items-center justify-center bg-slate-800">
        {imageError ? (
          <div className="text-xs text-slate-500 text-center px-2">Logo</div>
        ) : (
          <Image 
            src="/falcon-logo.png" 
            alt="Falcon Ledger logo" 
            width={96} 
            height={96} 
            priority 
            className="w-full h-full object-contain"
            onError={() => setImageError(true)}
          />
        )}
      </div>
    </div>
  )
}
