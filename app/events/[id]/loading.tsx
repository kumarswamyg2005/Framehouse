import styles from '@/components/Skeleton.module.css'

/** Matches the shape of the contact sheet so nothing moves when it arrives. */
export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading the event">
      <div className={styles.bar} />
      <div className={`${styles.block} ${styles.title}`} />
      <div className={`${styles.block} ${styles.meta}`} />
      <div className={styles.toolbar} />
      <div className={styles.grid}>
        {Array.from({ length: 18 }, (_, i) => (
          <div key={i} className={`${styles.block} ${styles.frame}`} />
        ))}
      </div>
    </div>
  )
}
