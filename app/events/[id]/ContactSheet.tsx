'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loupe } from './Loupe'
import styles from './sheet.module.css'

export type SheetPhoto = {
  id: string
  filename: string
  width: number | null
  height: number | null
  uploadedBy: { id: string; name: string }
  /** Still being decoded and resized; there is no thumbnail to show yet. */
  pending: boolean
  thumbnailUrl: string | null
}

type Props = {
  eventId: string
  photos: SheetPhoto[]
  nextCursor: string | null
  /** Leads select and publish; members only view their own frames. */
  canSelect: boolean
  showByline: boolean
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  onDeleted: (id: string) => void
  onLoadedMore: (photos: SheetPhoto[], cursor: string | null) => void
}

export function ContactSheet({
  eventId,
  photos,
  nextCursor,
  canSelect,
  showByline,
  selectedIds,
  onSelectionChange,
  onDeleted,
  onLoadedMore,
}: Props) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const [focusIndex, setFocusIndex] = useState(0)
  const [loupeIndex, setLoupeIndex] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hintsDismissed, setHintsDismissed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const gridRef = useRef<HTMLUListElement>(null)
  const lastToggled = useRef<number | null>(null)

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // Preserve sheet order so gallery position matches what the lead sees.
      onSelectionChange(photos.filter((p) => next.has(p.id)).map((p) => p.id))
    },
    [onSelectionChange, photos, selected]
  )

  /** shift+click selects everything between the last toggle and this one. */
  const selectRange = useCallback(
    (index: number) => {
      const anchor = lastToggled.current
      if (anchor == null) return toggle(photos[index]!.id)

      const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
      const next = new Set(selected)
      for (let i = from; i <= to; i++) next.add(photos[i]!.id)
      onSelectionChange(photos.filter((p) => next.has(p.id)).map((p) => p.id))
    },
    [onSelectionChange, photos, selected, toggle]
  )

  /** Read the real column count off the layout rather than guessing from a
   *  breakpoint, so arrow keys stay correct at any window width. */
  const columns = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return 1
    const cells = Array.from(grid.children) as HTMLElement[]
    const firstTop = cells[0]?.offsetTop
    const index = cells.findIndex((cell) => cell.offsetTop !== firstTop)
    return index === -1 ? cells.length || 1 : index
  }, [])

  const focusCell = useCallback((index: number) => {
    const grid = gridRef.current
    if (!grid) return
    const clamped = Math.max(0, Math.min(index, grid.children.length - 1))
    setFocusIndex(clamped)
    ;(grid.children[clamped]?.querySelector('button') as HTMLButtonElement | undefined)?.focus()
  }, [])

  function onKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const cols = columns()
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
    }

    if (event.key in moves) {
      event.preventDefault()
      focusCell(focusIndex + moves[event.key]!)
      return
    }

    if (event.key === ' ' && canSelect) {
      event.preventDefault()
      const photo = photos[focusIndex]
      if (photo) {
        lastToggled.current = focusIndex
        toggle(photo.id)
      }
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    const response = await fetch(
      `/api/events/${eventId}/photos?cursor=${encodeURIComponent(nextCursor)}`
    )
    if (response.ok) {
      const data = (await response.json()) as { photos: SheetPhoto[]; nextCursor: string | null }
      onLoadedMore(data.photos, data.nextCursor)
    }
    setLoadingMore(false)
  }

  async function remove(id: string) {
    setBusy(id)
    const response = await fetch(`/api/photos/${id}`, { method: 'DELETE' })
    if (response.ok) {
      onDeleted(id)
      setLoupeIndex(null)
    }
    setBusy(null)
  }

  // Presigned thumbnail URLs expire after five minutes. Rather than let the
  // sheet quietly fill with broken frames, refresh the page data just before
  // they lapse. Cheap, and it keeps the invariant short-lived TTLs exist for.
  useEffect(() => {
    if (photos.length === 0) return
    const timer = setTimeout(() => window.location.reload(), 4.5 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [photos.length])

  if (photos.length === 0) return null

  return (
    <>
      <ul className={styles.grid} ref={gridRef} onKeyDown={onKeyDown}>
        {photos.map((photo, index) => {
          const isSelected = selected.has(photo.id)
          return (
            <li key={photo.id} className={styles.cell}>
              <button
                type="button"
                className={`${styles.frame} ${isSelected ? styles.selected : ''}`}
                tabIndex={index === focusIndex ? 0 : -1}
                aria-pressed={canSelect ? isSelected : undefined}
                aria-label={
                  photo.pending
                    ? `${photo.filename}, frame ${index + 1}, still processing`
                    : canSelect
                      ? `${photo.filename}, frame ${index + 1}${isSelected ? ', selected' : ''}`
                      : `${photo.filename}, frame ${index + 1}`
                }
                onFocus={() => setFocusIndex(index)}
                // aria-disabled, not disabled: a disabled button is removed
                // from the focus order, so arrow-key navigation would move
                // focusIndex past it while the visible focus ring stayed behind,
                // and Space would then act on a different frame than the one
                // that looks focused.
                aria-disabled={photo.pending || undefined}
                onClick={(event) => {
                  if (photo.pending) return
                  if (!canSelect) return setLoupeIndex(index)
                  if (event.shiftKey) return selectRange(index)
                  lastToggled.current = index
                  toggle(photo.id)
                }}
                onDoubleClick={() => {
                  if (!photo.pending) setLoupeIndex(index)
                }}
              >
                {/* Thumbnails are presigned R2 URLs, never public ones. */}
                {photo.thumbnailUrl ? (
                  <img
                    src={photo.thumbnailUrl}
                    alt={photo.filename}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className={styles.pendingFrame} aria-hidden="true" />
                )}
                {isSelected && <span className={styles.mark} />}
              </button>
              <span className={styles.frameNo}>
                {String(index + 1).padStart(3, '0')}
                {showByline && <span className={styles.byline}>{photo.uploadedBy.name}</span>}
              </span>
            </li>
          )
        })}
      </ul>

      {nextCursor && (
        <p style={{ marginTop: 24 }}>
          <button type="button" className={styles.ghost} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more frames'}
          </button>
        </p>
      )}

      {canSelect && !hintsDismissed && (
        <div className={styles.hints}>
          <span>
            <span className={styles.hintKey}>space</span> select
          </span>
          <span>
            <span className={styles.hintKey}>↑ ↓ ← →</span> move
          </span>
          <span>
            <span className={styles.hintKey}>shift+click</span> range
          </span>
          <span>
            <span className={styles.hintKey}>double-click</span> loupe
          </span>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => setHintsDismissed(true)}
            aria-label="Dismiss keyboard hints"
          >
            ×
          </button>
        </div>
      )}

      {loupeIndex !== null && photos[loupeIndex] && (
        <Loupe
          photos={photos}
          index={loupeIndex}
          onIndex={setLoupeIndex}
          onClose={() => setLoupeIndex(null)}
          onDelete={remove}
          deleting={busy}
        />
      )}
    </>
  )
}
