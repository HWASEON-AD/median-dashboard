'use client'
import { useEffect, useState } from 'react'

interface Capture {
  id: string
  batch_id: string
  keyword: string
  product: string | null
  tab: string | null
  is_exposed: boolean
  image_url: string
  created_at: string
}

export default function CapturesPage() {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [batches, setBatches] = useState<string[]>([])
  const [selectedBatch, setSelectedBatch] = useState<string>('')
  const [showHidden, setShowHidden] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ayunche-captures')
      .then(r => r.json())
      .then(data => {
        const list: Capture[] = Array.isArray(data) ? data : []
        setCaptures(list)
        const bs = Array.from(new Set(list.map(c => c.batch_id))).sort((a, b) => b.localeCompare(a))
        setBatches(bs)
        if (bs.length) setSelectedBatch(bs[0])
        setLoading(false)
      })
  }, [])

  const filtered = captures.filter(c => {
    if (c.batch_id !== selectedBatch) return false
    if (!showHidden && !c.is_exposed) return false
    return true
  })

  const batchLabel = (id: string) => {
    const [date, slot] = id.split('_')
    const slotMap: Record<string, string> = { morning: '오전', afternoon: '오후', evening: '저녁' }
    return `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)} ${slotMap[slot] || slot}`
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">아윤채 캡처</h2>
        <div className="flex items-center gap-3">
          <select value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {batches.map(b => <option key={b} value={b}>{batchLabel(b)}</option>)}
          </select>
          <button onClick={() => setShowHidden(s => !s)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${showHidden ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {showHidden ? '미노출 숨기기' : '미노출 보기'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">캡처 데이터 없음</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
          {filtered.map(c => (
            <div key={c.id} onClick={() => setPreview(c.image_url)}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
              <img src={c.image_url} alt={c.keyword} className="w-full aspect-[9/16] object-cover" loading="lazy" />
              <div className="p-2">
                <div className="text-xs font-medium text-gray-800 truncate">{c.keyword}</div>
                {c.product && <div className="text-xs text-gray-500 truncate">{c.product}</div>}
                {c.tab && (
                  <span className={`mt-1 inline-block text-xs px-1.5 py-0.5 rounded ${c.is_exposed ? 'bg-green-100 text-green-700' : 'bg-orange-50 text-orange-600'}`}>
                    {c.tab}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 전체화면 오버레이 */}
      {preview && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={() => setPreview(null)}>
          <img src={preview} alt="preview" className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain" />
        </div>
      )}
    </div>
  )
}
