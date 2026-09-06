import styles from '@/components/Skeleton.module.css'

export default function Loading() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading your events">
      <div className={styles.bar} />
      <div className={`${styles.block} ${styles.title}`} />
      <div className={`${styles.block} ${styles.meta}`} />
      <div className={styles.rows}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.row} />
        ))}
      </div>
    </div>
  )
}
