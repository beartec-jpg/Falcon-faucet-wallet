// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { permanentRedirect } from 'next/navigation'

/** Board replaced by community socials page. */
export default function BoardRedirect() {
  permanentRedirect('/community')
}
