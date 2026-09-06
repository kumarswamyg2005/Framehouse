'use client'

import { flushSync } from 'react-dom'

/**
 * Runs a React state update inside a View Transition, so the browser morphs
 * between the two rendered states instead of cutting.
 *
 * Used for the thumbnail-to-lightbox move: the small frame in the grid and the
 * large one in the overlay share a `view-transition-name`, and the browser
 * tweens position and size between them. It is the pattern Unsplash and
 * Pinterest use, and it is the one animation here that carries information — it
 * tells you which frame you opened.
 *
 * Two details that are easy to get wrong:
 *
 * `flushSync` is required. startViewTransition snapshots the DOM before and
 * after its callback, so the update has to be synchronous inside it; React
 * would otherwise batch and both snapshots would be identical.
 *
 * A `view-transition-name` must be unique in the document. The grid stays
 * mounted behind the lightbox, so if the thumbnail keeps its name once the
 * overlay is up, the browser sees a duplicate and aborts the whole transition.
 * `afterUpdate` runs after the new DOM is committed but before the second
 * snapshot, which is exactly the window in which to hand the name over.
 *
 * Progressive enhancement — an unsupported browser, or someone who asked for
 * reduced motion, gets the state change with no animation and no name juggling.
 */
type Transition = { finished: Promise<void> }

export function withViewTransition(
  update: () => void,
  afterUpdate?: () => void,
  onFinished?: () => void
): void {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const start = (
    document as Document & { startViewTransition?: (cb: () => void) => Transition }
  ).startViewTransition

  if (reduced || typeof start !== 'function') {
    update()
    afterUpdate?.()
    onFinished?.()
    return
  }

  const transition = start.call(document, () => {
    flushSync(update)
    afterUpdate?.()
  })

  // Always clear up, including when the transition is skipped or interrupted.
  transition.finished.catch(() => {}).finally(() => onFinished?.())
}
