import AccountProfile from './AccountProfile'

export const dynamic = 'force-dynamic'

export default async function AccountPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return <AccountProfile name={decodeURIComponent(name)} />
}
