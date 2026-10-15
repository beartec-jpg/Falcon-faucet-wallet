import { permanentRedirect } from 'next/navigation'

/** Board replaced by community socials page. */
export default function BoardRedirect() {
  permanentRedirect('/community')
}
