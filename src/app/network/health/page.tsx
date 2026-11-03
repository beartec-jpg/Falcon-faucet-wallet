import { redirect } from 'next/navigation'

/** Network health now lives in the Explorer (network tab, #network-health section). */
export default function NetworkHealthRedirect() {
  redirect('/scan#network-health')
}
