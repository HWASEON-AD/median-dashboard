'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/', label: '노출현황' },
  { href: '/captures', label: '캡처' },
  { href: '/admin', label: '어드민' },
]

export default function Nav() {
  const path = usePathname()
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center gap-1 h-12">
        <span className="font-bold text-gray-800 mr-4 text-sm">AMOS</span>
        {tabs.map(t => (
          <Link key={t.href} href={t.href}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              path === t.href
                ? 'bg-blue-600 text-white font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}>
            {t.label}
          </Link>
        ))}
      </div>
    </header>
  )
}
