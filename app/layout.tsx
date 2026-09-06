import type { Metadata } from 'next'
import { Instrument_Serif, Inter, Roboto_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-inter' })
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
})
const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-roboto-mono',
})

export const metadata: Metadata = {
  title: 'Framehouse',
  description: 'Shoot, cull, and deliver event photography.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable} ${robotoMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
