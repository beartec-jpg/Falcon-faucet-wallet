// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import AccountProfile from './AccountProfile'

export const dynamic = 'force-dynamic'

export default async function AccountPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return <AccountProfile name={decodeURIComponent(name)} />
}
