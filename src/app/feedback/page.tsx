import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMeta } from '@/lib/seo'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { FEEDBACK_CONFIG } from '@/config/feedback'
import FeedbackForm from './FeedbackForm'

export const metadata: Metadata = pageMeta(
  '/feedback',
  'Testnet feedback',
  'Report bugs, UX problems and ideas from the Falcon PL testnet. Approved feedback adds bonus points to your testnet activity score.',
)

export default function FeedbackPage() {
  return (
    <ProductShell intensity={0.4} className="bg-slate-950 text-slate-100">
      <Header current="community" subtitle="Falcon PL · 2300" />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10 space-y-6">
        <section className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.3em]" style={{ color: '#D4922A' }}>Testnet</div>
          <h1 className="text-3xl font-semibold" style={{ color: '#E0DBCA' }}>Send feedback</h1>
          <p className="text-sm text-slate-400">
            Found a bug, something confusing, or have an idea? Tell us. Each submission is reviewed; useful, valid feedback adds
            bonus points (usually {FEEDBACK_CONFIG.defaultBonus}, up to {FEEDBACK_CONFIG.maxBonus} in total) to the{' '}
            <Link href="/scan/methodology" className="hover:underline" style={{ color: '#D4922A' }}>Feedback category</Link> of your testnet activity score.
            Nothing is promised and the rules may change.
          </p>
        </section>
        <FeedbackForm />
      </main>
    </ProductShell>
  )
}
