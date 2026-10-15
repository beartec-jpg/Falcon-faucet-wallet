import ContentPage, { A, Code, Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/community/validators/run-a-node',
  'Run a Falcon PL node',
  'Install a Falcon PL node with one command on Linux x86-64 (glibc 2.34+), and become a validator with a 50,000 FPL bond.',
)

export default function RunANodePage() {
  return (
    <ContentPage current="community" subtitle="Validators & nodes" title="Run a Falcon PL node" back={{ href: '/validator', label: 'Validators' }}>
      <Section title="Requirements">
        <ul className="list-disc pl-5 space-y-1">
          <li>Linux x86-64</li>
          <li>glibc 2.34 or newer</li>
        </ul>
      </Section>
      <Section title="Install a node">
        <Code>{'curl -fsSL https://falcon-fpl.com/install.sh | bash'}</Code>
      </Section>
      <Section title="Install as a validator">
        <Code>{'curl -fsSL https://falcon-fpl.com/install.sh | bash -s -- --validator --id NAME --no-wait'}</Code>
        <p>Replace NAME with your validator id. Contact details are optional.</p>
      </Section>
      <Section title="Bond and approval">
        <p>
          Validator seats need a 50,000 FPL bond. New validators are approved by Scott. Apply at{' '}
          <A href="/validator/apply">validator application</A>.
        </p>
      </Section>
      <p className="text-slate-400">
        See the live mesh on the <A href="/scan/map">network map</A>.
      </p>
    </ContentPage>
  )
}
