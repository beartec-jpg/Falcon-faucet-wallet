'use client'

/**
 * /validator/apply: check a validator application built by the installer and send it to Scott.
 * The application arrives in the URL fragment (#app=…), which browsers never send to the server.
 * Nothing is stored or signed here; the GitHub issue is opened by the applicant in their own browser.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import {
  APPLICATIONS_REPO,
  applicationIssueUrl,
  decodeAppFragment,
  validateApplication,
  type Application,
} from '@/lib/pl-validators'

export default function ValidatorApplyPage() {
  const [raw, setRaw] = useState('')
  const [app, setApp] = useState<Application | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  async function check(obj: unknown) {
    const v = await validateApplication(obj)
    setErrors(v.errors)
    setApp(v.app ?? null)
  }

  useEffect(() => {
    try {
      const obj = decodeAppFragment(window.location.hash)
      if (obj) {
        setRaw(JSON.stringify(obj, null, 2))
        void check(obj)
      }
    } catch {
      setErrors(['the link does not contain a readable application'])
    }
  }, [])

  const issue = app ? applicationIssueUrl(app) : null
  const json = app ? JSON.stringify(app, null, 2) : ''

  return (
    <ProductShell intensity={0.4}>
      <Header current="community" subtitle="Validator application" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Link href="/validator" className="hover:text-brand-400">Validators</Link> · Apply
          </p>
          <h1 className="text-2xl font-bold text-white">Validator application</h1>
          <p className="mt-1 text-sm text-slate-400">
            The installer (<code>--validator</code>) builds this file on your machine. It holds only public data: your validator
            public key, a proof that you hold its secret key, your bond account and your contact.
          </p>
        </div>

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white">application.json</h2>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={8}
            placeholder='paste ~/falcon-pl-2300/validator/application.json here (or open the link the installer printed)'
            className="w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] text-slate-300"
          />
          <button
            type="button"
            className="rounded border border-brand-500/40 px-3 py-1.5 text-sm text-brand-300 hover:bg-brand-500/10"
            onClick={() => {
              try {
                void check(JSON.parse(raw))
              } catch {
                setApp(null)
                setErrors(['not valid JSON'])
              }
            }}
          >
            Check
          </button>
          {errors.length > 0 && (
            <ul className="list-inside list-disc text-xs text-red-300">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </section>

        {app && issue && (
          <section className="card space-y-3 border-emerald-500/30 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Looks good</h2>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-xs">
              <dt className="text-slate-500">validator id</dt><dd className="font-mono text-white">{app.id}</dd>
              <dt className="text-slate-500">key fingerprint</dt><dd className="font-mono text-slate-300">{app.validator_key_fingerprint}</dd>
              <dt className="text-slate-500">bond account</dt><dd className="font-mono text-slate-300">{app.bond_account}</dd>
              <dt className="text-slate-500">node version</dt><dd className="font-mono text-slate-300">{app.node_version}</dd>
              <dt className="text-slate-500">contact</dt><dd className="text-slate-300">{app.contact || '—'}</dd>
            </dl>
            <div className="flex flex-wrap gap-3 pt-1">
              <a href={issue.url} target="_blank" rel="noreferrer" className="rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500">
                Open GitHub application →
              </a>
              <button
                type="button"
                className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-brand-400"
                onClick={() => void navigator.clipboard?.writeText(json)}
              >
                Copy application.json
              </button>
              <a
                className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-brand-400"
                href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
                download={`falcon-pl-application-${app.id}.json`}
              >
                Download
              </a>
            </div>
            {!issue.includesJson && (
              <p className="text-xs text-amber-200">The link is too long to carry the whole file: paste the copied application.json into the issue&apos;s “Application” field.</p>
            )}
            <p className="text-[11px] text-slate-500">
              Issues go to the public repo <code>{APPLICATIONS_REPO}</code>. Scott checks the application and approves your id + key on
              chain. Your installer is polling and continues on its own (funding → bond → activation). Status: <Link href="/validator" className="text-brand-400 hover:underline">/validator</Link>.
            </p>
          </section>
        )}
      </main>
    </ProductShell>
  )
}
