'use client'

import { useRef, useState } from 'react'
import { useUploadQueue, type ConfirmedPhoto, type UploadItem } from './useUploadQueue'
import styles from './sheet.module.css'

const STATE_LABEL: Record<UploadItem['status'], string> = {
  queued: 'Waiting',
  presigning: 'Starting',
  uploading: 'Uploading',
  confirming: 'Finishing',
  ready: 'Done',
  failed: 'Failed',
}

export function Uploader({
  eventId,
  hasPhotos,
  onUploaded,
}: {
  eventId: string
  hasPhotos: boolean
  onUploaded: (photo: ConfirmedPhoto) => void
}) {
  const { items, add, retry, clearFinished, active, failed, done, overall } = useUploadQueue(
    eventId,
    onUploaded
  )
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <section>
      <div
        className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          add(Array.from(e.dataTransfer.files))
        }}
      >
        <p className={styles.dropCopy}>
          {hasPhotos ? 'Drag more photos here, or ' : 'No photos yet. Drag them here, or '}
          <button type="button" className={styles.pick} onClick={() => inputRef.current?.click()}>
            choose files
          </button>
          .
        </p>
        <p className={styles.dropHint}>JPEG, PNG or WebP · up to 25 MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            add(Array.from(e.target.files ?? []))
            e.target.value = '' // so the same file can be picked again after a failure
          }}
        />
      </div>

      {items.length > 0 && (
        <div className={styles.queue}>
          <div className={styles.queueHead}>
            <span>
              {active > 0
                ? `Uploading ${active} of ${items.length}`
                : `${done} uploaded${failed > 0 ? `, ${failed} failed` : ''}`}
            </span>
            {active === 0 && done > 0 && (
              <button type="button" className={styles.dismiss} onClick={clearFinished}>
                Clear finished
              </button>
            )}
          </div>

          <div
            className={styles.bar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overall * 100)}
            aria-label="Overall upload progress"
          >
            <div className={styles.barFill} style={{ width: `${overall * 100}%` }} />
          </div>

          <ul className={styles.queueList}>
            {items.map((item) => (
              <li key={item.id} className={styles.queueRow}>
                <span className={styles.queueName} title={item.file.name}>
                  {item.file.name}
                </span>
                <span className={styles.queueState}>
                  {item.status === 'failed' ? (
                    <>
                      <span>{item.error}</span>
                      <button type="button" className={styles.retry} onClick={() => retry(item.id)}>
                        Retry
                      </button>
                    </>
                  ) : item.status === 'uploading' ? (
                    <span>{Math.round(item.progress * 100)}%</span>
                  ) : (
                    <span className={item.status === 'ready' ? styles.stateReady : undefined}>
                      {STATE_LABEL[item.status]}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
