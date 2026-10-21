/** Work share for display: 2 decimals, '<0.01' for tiny non-zero values (caller appends %). */
export const fmtWorkShare = (n: number) =>
  n > 0 && n < 0.01 ? '<0.01' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
