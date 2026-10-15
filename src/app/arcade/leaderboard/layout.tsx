import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/arcade/leaderboard',
  'Arcade leaderboard',
  'Falcon PL arcade epoch leaderboards: top scores per game for the current epoch.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
