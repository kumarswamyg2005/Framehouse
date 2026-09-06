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

  const showToast = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 2600)
  }, [])

  /** Re-reads the first page after an upload so new frames appear in order. */
  const refreshFirstPage = useCallback(async () => {
    const response = await fetch(`/api/events/${eventId}/photos`)
    if (!response.ok) return
    const data = (await response.json()) as { photos: SheetPhoto[]; nextCursor: string | null }
    setPhotos(data.photos)
    setCursor(data.nextCursor)
  }, [eventId])

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
   * uploaded frame arrives PENDING. Poll until none are, then stop — this is
   * not a live feed, it is waiting for a job that finishes in seconds.
   */
  useEffect(() => {
    if (!photos.some((photo) => photo.pending)) return
    const timer = setInterval(() => void refreshFirstPage(), 2500)
    return () => clearInterval(timer)
  }, [photos, refreshFirstPage])

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
        <span className={sheet.counts}>
          <span className={sheet.countStrong}>{photos.length}</span>{' '}
          {photos.length === 1 ? 'frame' : 'frames'}
          {isLead && (
            <>
              {' · '}
              <span className={sheet.countStrong}>{selectedIds.length}</span> selected
              {' · '}
              {gallery?.isPublished ? 'Published' : 'Draft'}
            </>
          )}
          {saveLabel && <> · {saveLabel}</>}
        </span>

        {isLead && (
          <span className={sheet.actions}>
            {selectedIds.length > 0 && (
              <button
                type="button"
                className={sheet.ghost}
                onClick={() => onSelectionChange([])}
                disabled={saveState === 'saving'}
              >
                Clear selection
              </button>
            )}
            <button
              type="button"
              className={sheet.solid}
              onClick={() => setPanelOpen((open) => !open)}
              disabled={selectedIds.length === 0 && !gallery?.isPublished}
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

      <Uploader eventId={eventId} hasPhotos={photos.length > 0} onUploaded={refreshFirstPage} />

      {photos.length === 0 ? (
        <p className={sheet.empty}>
          {isLead
            ? 'Nothing uploaded yet. Frames from everyone on this event land here.'
            : 'Nothing uploaded yet. Only you can see the frames you upload here.'}
        </p>
      ) : (
        <>
          {isLead && selectedIds.length === 0 && (
            <p className={sheet.empty} style={{ padding: '20px 0 0' }}>
              Select the frames you want the client to see.
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
