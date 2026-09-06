'use client'

import { useEffect, useRef } from 'react'

/**
 * Makes the browser Back gesture close an overlay instead of leaving the page.
 *
 * On phones, Back is the universal "dismiss" gesture — a customer with a photo
 * open in the lightbox who swipes back expects to land on the gallery, not on
 * whatever they were looking at before it. Opening the overlay pushes a history
 * entry; Back pops it and closes.
 *
 * The callback is held in a ref so a caller passing an inline arrow function
 * does not re-run the effect on every render and push an entry each time.
 */
export function useCloseOnBack(onClose: () => void): void {
  const latest = useRef(onClose)
  latest.current = onClose

  useEffect(() => {
    window.history.pushState({ fhOverlay: true }, '')
    let poppedByUser = false

    const onPopState = () => {
      poppedByUser = true
      latest.current()
    }

    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
      // Closed some other way — esc, the close button, a delete. Drop the entry
      // we added so the next Back goes where the person actually expects. The
      // state check keeps this from firing a second navigation when the overlay
      // unmounted because the user had already navigated away.
      if (!poppedByUser && window.history.state?.fhOverlay) window.history.back()
    }
  }, [])
}
