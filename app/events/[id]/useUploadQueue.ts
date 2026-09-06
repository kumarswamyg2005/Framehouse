'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Per-file upload state machine:
 *
 *   queued -> presigning -> uploading -> confirming -> ready
 *                  |            |            |
 *                  +------------+------------+--> failed (retryable)
 *
 * Each file is independent. One failure does not stop the batch, and a failed
 * file can be retried on its own without re-picking it.
 */
export type UploadStatus = 'queued' | 'presigning' | 'uploading' | 'confirming' | 'ready' | 'failed'

export type UploadItem = {
  id: string
  file: File
  status: UploadStatus
  /** 0..1, meaningful while uploading. */
  progress: number
  error?: string
}

const CONCURRENCY = 3
const MAX_BYTES = 25 * 1024 * 1024
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Rejected here so an obviously-bad file never costs a round trip. The server
 *  checks the same things again — this is a courtesy, not the control. */
function preflight(file: File): string | null {
  if (!ACCEPTED.has(file.type)) return 'Only JPEG, PNG and WebP images can be uploaded.'
  if (file.size > MAX_BYTES) return 'Larger than 25 MB.'
  if (file.size === 0) return 'That file is empty.'
  return null
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null
  return payload?.error?.message ?? fallback
}

export function useUploadQueue(eventId: string, onUploaded: () => void) {
  const [items, setItems] = useState<UploadItem[]>([])
  const running = useRef(0)
  const pending = useRef<string[]>([])
  const itemsRef = useRef<Map<string, UploadItem>>(new Map())

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    const current = itemsRef.current.get(id)
    if (current) itemsRef.current.set(id, { ...current, ...next })
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)))
  }, [])

  const uploadOne = useCallback(
    async (id: string) => {
      const item = itemsRef.current.get(id)
      if (!item) return

      try {
        patch(id, { status: 'presigning', progress: 0, error: undefined })

        const presignResponse = await fetch(`/api/events/${eventId}/photos/presign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: item.file.name,
            mimeType: item.file.type,
            fileSize: item.file.size,
          }),
        })
        if (!presignResponse.ok) {
          throw new Error(await readError(presignResponse, 'Could not start the upload.'))
        }
        const { uploadUrl, storageKey } = (await presignResponse.json()) as {
          uploadUrl: string
          storageKey: string
        }

        patch(id, { status: 'uploading' })

        // XHR rather than fetch: it is the only way to observe upload progress,
        // and a 25 MB file over a hotel wifi needs a progress bar.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', uploadUrl, true)
          xhr.setRequestHeader('Content-Type', item.file.type)
          xhr.upload.onprogress = (progressEvent) => {
            if (progressEvent.lengthComputable) {
              patch(id, { progress: progressEvent.loaded / progressEvent.total })
            }
          }
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`Storage rejected the upload (${xhr.status}).`))
          xhr.onerror = () => reject(new Error('The connection dropped during the upload.'))
          xhr.onabort = () => reject(new Error('The upload was cancelled.'))
          xhr.send(item.file)
        })

        patch(id, { status: 'confirming', progress: 1 })

        // Until this succeeds there is no database row. An upload that dies
        // before here leaves an unreferenced object, never orphaned metadata.
        const confirmResponse = await fetch(`/api/events/${eventId}/photos/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storageKey, filename: item.file.name }),
        })
        if (!confirmResponse.ok) {
          throw new Error(await readError(confirmResponse, 'The upload could not be confirmed.'))
        }

        patch(id, { status: 'ready' })
        onUploaded()
      } catch (error) {
        patch(id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'The upload failed.',
        })
      } finally {
        running.current -= 1
        pump()
      }
    },
    [eventId, onUploaded, patch]
  )

  // Keeps at most CONCURRENCY uploads in flight. More than that and each one
  // gets a thinner slice of the same uplink for no gain.
  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && pending.current.length > 0) {
      const id = pending.current.shift()
      if (!id) break
      running.current += 1
      void uploadOne(id)
    }
  }, [uploadOne])

  const add = useCallback(
    (files: File[]) => {
      const next: UploadItem[] = files.map((file) => {
        const rejection = preflight(file)
        return {
          id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
          file,
          status: rejection ? 'failed' : 'queued',
          progress: 0,
          ...(rejection ? { error: rejection } : {}),
        }
      })

      for (const item of next) itemsRef.current.set(item.id, item)
      setItems((prev) => [...prev, ...next])
      pending.current.push(...next.filter((i) => i.status === 'queued').map((i) => i.id))
      pump()
    },
    [pump]
  )

  const retry = useCallback(
    (id: string) => {
      const item = itemsRef.current.get(id)
      if (!item || item.status !== 'failed') return
      if (preflight(item.file)) return // still invalid; nothing to retry
      patch(id, { status: 'queued', error: undefined, progress: 0 })
      pending.current.push(id)
      pump()
    },
    [patch, pump]
  )

  const clearFinished = useCallback(() => {
    for (const [id, item] of itemsRef.current) {
      if (item.status === 'ready') itemsRef.current.delete(id)
    }
    setItems((prev) => prev.filter((item) => item.status !== 'ready'))
  }, [])

  const active = items.filter((i) => i.status !== 'ready' && i.status !== 'failed').length
  const failed = items.filter((i) => i.status === 'failed').length
  const done = items.filter((i) => i.status === 'ready').length
  const overall =
    items.length === 0
      ? 0
      : items.reduce((sum, i) => sum + (i.status === 'ready' ? 1 : i.progress), 0) / items.length

  return { items, add, retry, clearFinished, active, failed, done, overall }
}
