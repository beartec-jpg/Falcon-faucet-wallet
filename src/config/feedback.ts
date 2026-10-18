/**
 * Testnet feedback programme. Submissions are reviewed in the First 35 admin;
 * approved ones add bonus points to the testnet activity score ("feedback" category).
 *
 * Scale: the nine activity categories sum to 100 and the small ones (faucet, arcade,
 * infra) are worth 5. Feedback is a bonus category on top, capped at 5 like those,
 * with a default of 1 point per approved item: five useful reports equal a full
 * small category, and one report is never worth more than a single small category.
 * Exceptional reports (e.g. a reproducible security or funds bug) can be given up
 * to the cap in one go.
 */
export const FEEDBACK_CONFIG = {
  categories: ['bug', 'ux', 'idea', 'docs', 'other'] as const,
  /** Default bonus (tracker points) proposed when approving. Editable per item. */
  defaultBonus: 1,
  /** Largest bonus a single item can get (equals TRACKER_CONFIG.bonusCaps.feedback). */
  maxBonus: 5,
  /** Field limits. */
  descriptionMin: 20,
  descriptionMax: 2000,
  areaMax: 80,
  contactMax: 64,
  /** Screenshot uploads: per-image cap (after the client downscales to ~1600px JPEG) and count. */
  imageMaxBytes: 5_000_000,
  maxImages: 3,
  /**
   * Whole multipart request cap. Vercel functions reject bodies over 4.5 MB, so the
   * client compresses each image to ~1.4 MB at most and the server refuses anything bigger.
   */
  requestMaxBytes: 4_400_000,
  adminNotesMax: 1000,
  /** Submissions per hashed IP per 24 h, and per account per 24 h. */
  perIpPerDay: 5,
  perAccountPerDay: 5,
}

export type FeedbackCategory = (typeof FEEDBACK_CONFIG.categories)[number]
export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = { bug: 'Bug', ux: 'UX', idea: 'Idea', docs: 'Docs', other: 'Other' }
