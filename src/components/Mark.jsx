/**
 * The product's mark: the four lifecycle states as blocks rising left to
 * right, with the second (RESERVED) drawn as a pause — the one gate where an
 * order waits for its owner. Flat rectangles, no gradient.
 */
export function Mark({ size = 20, tone = 'light' }) {
  const ink = tone === 'dark' ? '#0a0a0a' : '#f5f5f5'
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="0" y="12" width="4" height="8" rx="1" fill={ink} />
      <rect x="5.3" y="8" width="1.6" height="12" rx="0.8" fill="#139aae" />
      <rect x="8.1" y="8" width="1.6" height="12" rx="0.8" fill="#139aae" />
      <rect x="11" y="4" width="4" height="16" rx="1" fill={ink} />
      <rect x="16" y="0" width="4" height="20" rx="1" fill={ink} />
    </svg>
  )
}
