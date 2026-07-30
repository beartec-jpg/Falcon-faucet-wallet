/** Public community destinations — labels only in the UI; never show raw URLs. */

export type CommunitySocial = {
  id: string
  name: string
  description: string
  href: string
  /** Accent for icon chip */
  accent: string
}

export const COMMUNITY_SOCIALS: CommunitySocial[] = [
  {
    id: 'x',
    name: 'X',
    description: 'Announcements, updates, and conversation.',
    // Set your public X profile here when ready — leave empty to hide the card
    href: process.env.NEXT_PUBLIC_COMMUNITY_X_URL ?? '',
    accent: '#e7e9ea',
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Chat with the community, ask questions, share builds.',
    href: 'https://discord.gg/6QueNQ2KD',
    accent: '#5865F2',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Fast updates and community discussion on the go.',
    href: 'https://t.me/+OA4KW13oJolhZDNk',
    accent: '#2AABEE',
  },
]

export function activeCommunitySocials() {
  return COMMUNITY_SOCIALS.filter((s) => s.href.trim().length > 0)
}
