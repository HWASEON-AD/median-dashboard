import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '메디안 블로그 노출 현황 대시보드',
  description: '메디안 블로그 노출현황 + 캡처 통합 대시보드',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  )
}
