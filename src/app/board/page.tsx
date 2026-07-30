import { redirect } from 'next/navigation'

/** Board replaced by community socials page. */
export default function BoardRedirect() {
  redirect('/community')
}
