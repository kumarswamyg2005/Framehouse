import type { Metadata } from 'next'
import { Fraunces, Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

/**
 * Three families, three jobs.
 *
 * Fraunces is the display face. It is variable across optical size, weight and
 * two shape axes — SOFT (rounding) and WONK (irregularity) — which is why it
 * can be two voices in one file: quiet and upright inside the tool, warmer and
 * wonkier on the entry page. It is drawn from 1970s phototypesetting, which is
 * the same era this product's whole vocabulary comes from.
 *
 * Instrument Sans carries the interface. It has more of a drawn quality than
 * Inter without giving up the neutrality dense UI needs.
 *
 * JetBrains Mono is for frame numbers and for literal values a person copies.
 * Nothing else.
 */
const display = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
  variable: '--font-display',
})

const ui = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'Framehouse',
  description: 'Shoot, cull, and deliver event photography.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
