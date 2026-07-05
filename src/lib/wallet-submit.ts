/** AMMCreate charges one owner reserve as the transaction fee (~2 FALCON on testnet). */
export const AMM_CREATE_FEE_DROPS = '2000000'

export interface SubmitResult {
  success: boolean
  hash?: string
  result?: string
  message?: string
  error?: string
}

export async function submitWalletTx(
  tx_blob: string,
  networkKey: string,
): Promise<SubmitResult> {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_blob, network: networkKey }),
  })
  const data = (await res.json()) as SubmitResult
  if (data.error) {
    throw new Error(data.error)
  }
  if (!data.success) {
    const detail = [data.result, data.message].filter(Boolean).join(' — ')
    throw new Error(detail || 'Transaction failed')
  }
  return data
}