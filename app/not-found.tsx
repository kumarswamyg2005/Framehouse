import Link from 'next/link'

export const metadata = { title: 'Not found · Framehouse' }

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '32px 20px',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '44ch' }}>
        <h1
          style={{
            fontFamily: 'var(--font-instrument-serif), Georgia, serif',
            fontSize: 44,
            lineHeight: 1.05,
            color: 'var(--bone)',
          }}
        >
          Nothing here
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--bone-dim)' }}>
          This page does not exist, or it belongs to an event you are not on.
        </p>
        <p style={{ marginTop: 24, fontSize: 14 }}>
          <Link href="/events" style={{ color: 'var(--bone)' }}>
            Back to your events
          </Link>
        </p>
      </div>
    </main>
  )
}
