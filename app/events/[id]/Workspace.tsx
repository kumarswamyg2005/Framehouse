'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ContactSheet, type SheetPhoto } from './ContactSheet'
import { PublishPanel, type GalleryState } from './PublishPanel'
import { Uploader } from './Uploader'
import sheet from './sheet.module.css'
import publishStyles from './publish.module.css'

type Props = {
  eventId: string
  eventName: string
  isLead: boolean
  appUrl: string
  initialPhotos: SheetPhoto[]
  initialCursor: string | null
  initialGallery: GalleryState
  initialSelectedIds: string[]
}

const SAVE_DEBOUNCE_MS = 700

/**
 * Owns the state the sheet, the uploader and the publish panel all touch:
 * which frames exist, and which are selected. Kept in one place so a newly
 * uploaded frame appears in the sheet without a round trip through the server
 * component, and so selection has a single writer.
 */
export function Workspace({
  eventId,
  eventName,
  isLead,
  appUrl,
  initialPhotos,
  initialCursor,
  initialGallery,
  initialSelectedIds,
}: Props) {
  const [photos, setPhotos] = useState(initialPhotos)
  const [cursor, setCursor] = useState(initialCursor)
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds)
  const [gallery, setGallery] = useState<GalleryState>(initialGallery)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [panelOpen, setPanelOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(false)

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Holds the dismiss timer in a ref so a second toast within the window cannot
   * be cut short by the first one's timeout still being in flight — which is
   * what happened when a publish was followed quickly by an unpublish.
   */
  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => {
      setToast(null)
      toastTimer.current = null
    }, 3200)
  }, [])

  /**
   * Appends a freshly confirmed frame.
   *
   * Frames are ordered oldest-first, so a new upload belongs at the end — which
   * is also why this cannot re-read "the first page": on an event with more than
   * one page, the new frame is not on it, and replacing state that way would
   * also throw away every page the lead had already scrolled.
   */
  const onUploaded = useCallback((photo: SheetPhoto) => {
    setPhotos((prev) => (prev.some((p) => p.id === photo.id) ? prev : [...prev, photo]))
  }, [])

  /** Patches specific frames in place, leaving loaded pages alone. */
  const refreshPhotos = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const response = await fetch(
        `/api/events/${eventId}/photos?ids=${ids.map(encodeURIComponent).join(',')}`
      )
      if (!response.ok) return
      const data = (await response.json()) as { photos: SheetPhoto[] }
      const patched = new Map(data.photos.map((p) => [p.id, p]))
      // Ids we asked about that came back missing were rejected during
      // finalisation; drop them rather than polling them forever.
      const returned = new Set(data.photos.map((p) => p.id))
      setPhotos((prev) =>
        prev
          .filter((p) => returned.has(p.id) || !ids.includes(p.id))
          .map((p) => patched.get(p.id) ?? p)
      )
    },
    [eventId]
  )

  const saveSelection = useCallback(
    async (ids: string[]) => {
      setSaveState('saving')
      const response = await fetch(`/api/events/${eventId}/gallery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: gallery?.title ?? eventName, photoIds: ids }),
      })

      if (!response.ok) {
        setSaveState('error')
        return
      }

      const { gallery: saved } = (await response.json()) as {
        gallery: { id: string; slug: string; title: string }
      }
      // Selecting for the first time creates the gallery row; adopt its id and
      // slug so the publish panel has something to act on.
      setGallery((prev) => ({
        id: saved.id,
        slug: saved.slug,
        title: saved.title,
        isPublished: prev?.isPublished ?? false,
      }))
      setSaveState('saved')
    },
    [eventId, eventName, gallery?.title]
  )

  // Debounced so dragging across twenty frames is one write, not twenty.
  const onSelectionChange = useCallback(
    (ids: string[]) => {
      setSelectedIds(ids)
      dirty.current = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void saveSelection(ids), SAVE_DEBOUNCE_MS)
    },
    [saveSelection]
  )

  /**
   * Thumbnails are generated after the confirm response returns, so a freshly
   * uploaded frame arrives PENDING. Poll only those frames until none are left,
   * then stop — this is not a live feed, it is waiting for a job that finishes
   * in seconds.
   */
  const pendingIds = photos.filter((p) => p.pending).map((p) => p.id)
  const pendingKey = pendingIds.join(',')

  useEffect(() => {
    if (!pendingKey) return
    const ids = pendingKey.split(',')
    const timer = setInterval(() => void refreshPhotos(ids), 2500)
    return () => clearInterval(timer)
    // Keyed on the id list rather than the photos array, so the interval is not
    // torn down and rebuilt on every unrelated state change.
  }, [pendingKey, refreshPhotos])

  // A pending selection change must not be lost to a tab close.
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (saveState === 'saving' || (dirty.current && saveTimer.current)) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  const onDeleted = useCallback((id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id))
    setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id))
  }, [])

  const onLoadedMore = useCallback((more: SheetPhoto[], next: string | null) => {
    setPhotos((prev) => [...prev, ...more])
    setCursor(next)
  }, [])

  const saveLabel = {
    idle: null,
    saving: 'Saving selection…',
    saved: 'Selection saved',
    error: 'Selection could not be saved. It will retry on the next change.',
  }[saveState]

  return (
    <>
      <div className={sheet.toolbar}>
        <div className={sheet.stats}>
          {/* The visible label is split across two elements for typography, so
              each stat carries an accessible name that reads as one phrase. */}
          <span
            className={sheet.stat}
            // role="img": aria-label is prohibited on a bare span, and this is a
            // composite of two styled fragments that reads as one phrase.
            role="img"
            aria-label={`${photos.length} ${photos.length === 1 ? 'frame' : 'frames'}`}
          >
            <span className={sheet.statValue} aria-hidden="true">
              {photos.length}
            </span>
            <span aria-hidden="true">{photos.length === 1 ? 'frame' : 'frames'}</span>
          </span>

          {isLead && (
            <span
              className={`${sheet.stat} ${sheet.statSelected}`}
              role="img"
              aria-label={`${selectedIds.length} selected`}
            >
              <span className={sheet.statValue} aria-hidden="true">
                {selectedIds.length}
              </span>
              <span aria-hidden="true">selected</span>
            </span>
          )}

          {isLead && (
            <span className={sheet.stat}>
              <span
                className={`${sheet.badge} ${gallery?.isPublished ? sheet.badgeLive : ''}`}
                role="img"
                aria-label={gallery?.isPublished ? 'Gallery published' : 'Gallery draft'}
              >
                <span className={sheet.badgeDot} aria-hidden="true" />
                <span aria-hidden="true">{gallery?.isPublished ? 'Published' : 'Draft'}</span>
              </span>
            </span>
          )}

          {saveLabel && (
            <span className={sheet.stat}>
              <span className={sheet.saveState}>{saveLabel}</span>
            </span>
          )}
        </div>

        {isLead && (
          <span className={sheet.actions}>
            {selectedIds.length > 0 && (
              <button
                type="button"
                className="btn btnQuiet btnSmall"
                onClick={() => onSelectionChange([])}
                disabled={saveState === 'saving'}
              >
                Clear selection
              </button>
            )}
            <button
              type="button"
              className="btn btnPrimary btnSmall"
              onClick={() => setPanelOpen((open) => !open)}
              disabled={selectedIds.length === 0 && !gallery?.isPublished}
              title={
                selectedIds.length === 0 && !gallery?.isPublished
                  ? 'Select at least one frame first'
                  : undefined
              }
            >
              {gallery?.isPublished ? 'Gallery' : 'Publish'}
            </button>
          </span>
        )}
      </div>

      {panelOpen && gallery && (
        <PublishPanel
          eventName={eventName}
          gallery={gallery}
          selectedCount={selectedIds.length}
          appUrl={appUrl}
          onChanged={setGallery}
          onClose={() => setPanelOpen(false)}
          onToast={showToast}
        />
      )}

      <Uploader eventId={eventId} hasPhotos={photos.length > 0} onUploaded={onUploaded} />

      {photos.length === 0 ? (
        <div className={sheet.emptyState}>
          <p className={sheet.emptyTitle}>
            {isLead ? 'No frames yet' : 'Nothing uploaded yet'}
          </p>
          <p className={sheet.emptyBody}>
            {isLead
              ? 'Frames from everyone on this event land here. Add your team below, or drop your own files above.'
              : 'Drop files above to upload. Only you can see the frames you upload — your lead sees them too, nobody else on the team does.'}
          </p>
        </div>
      ) : (
        <>
          {isLead && selectedIds.length === 0 && (
            <p className={sheet.prompt}>
              Select the frames you want the client to see — click one, or press{' '}
              <kbd className={sheet.kbd}>space</kbd> on a focused frame.
            </p>
          )}
          <ContactSheet
            eventId={eventId}
            photos={photos}
            nextCursor={cursor}
            canSelect={isLead}
            showByline={isLead}
            selectedIds={selectedIds}
            onSelectionChange={onSelectionChange}
            onDeleted={onDeleted}
            onLoadedMore={onLoadedMore}
          />
        </>
      )}

      {toast && (
        <div className={publishStyles.toast} role="status">
          {toast}
        </div>
      )}
    </>
  )
}
