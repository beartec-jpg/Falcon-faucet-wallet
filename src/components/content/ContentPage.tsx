import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'

type NavItem = React.ComponentProps<typeof Header>['current']

/** Shared long-form layout, matching /scan/methodology. */
export default function ContentPage({
  current,
  subtitle,
  back,
  title,
  children,
}: {
  current: NavItem
  subtitle?: string
  back?: { href: string; label: string }
  title: string
  children: React.ReactNode
}) {
  return (
    <ProductShell intensity={0.4} className="bg-slate-950 text-slate-100">
      <Header current={current} subtitle={subtitle ?? 'Falcon PL · 2300'} />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-10 space-y-6 text-sm text-slate-300">
        {back && (
          <Link href={back.href} className="text-xs text-slate-500 hover:text-slate-300">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold" style={{ color: '#E0DBCA' }}>
          {title}
        </h1>
        {children}
      </main>
    </ProductShell>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  )
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="bg-slate-950/60 rounded-lg px-3 py-2 font-mono text-xs text-emerald-300 overflow-x-auto">
      {children}
    </pre>
  )
}

export const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="text-amber-300 hover:underline">
    {children}
  </Link>
)
