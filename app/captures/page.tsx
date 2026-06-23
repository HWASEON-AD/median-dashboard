'use client'
import { useEffect, useState, useCallback } from 'react'

// median_daily_captures 스키마 기준 캡처 레코드
interface DailyCapture {
  id: string
  post_id: string
  date: string
  brand: string | null
  keyword: string
  product: string | null
  image_url: string
  captured_at: string
}

function toStr(d: Date) { return d.toISOString().slice(0, 10) }

export default function CapturesPage() {
  const [records, setRecords] = useState<DailyCapture[]>([])
  const [date, setDate] = useState(toStr(new Date()))
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)

  // /api/captures 호출 (날짜 미지정 시 최근 캡처 날짜 자동 반환)
  const loadCaptures = useCallback((d?: string) => {
    setLoading(true)
    const url = d ? `/api/captures?date=${d}` : '/api/captures'
    fetch(url)
      .then(r => r.json())
      .then(data => {
        setRecords(data.records || [])
        // 응답의 date를 화면 날짜로 반영
        if (data.date) setDate(data.date)
      })
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [])

  // 최초 진입 시 날짜 미지정으로 호출 → 최근 캡처 날짜 자동 로드
  useEffect(() => { loadCaptures() }, [loadCaptures])

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">메디안 캡처</h2>
          {/* 응답 날짜 표시 */}
          <span className="text-sm text-gray-500">{date}</span>
        </div>
        {/* 날짜 선택 — 변경 시 해당 날짜로 재호출 */}
        <input type="date" value={date}
          onChange={e => loadCaptures(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-20 text-gray-400">캡처 데이터 없음</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
          {records.map(c => (
            <div key={c.id} onClick={() => setPreview(c.image_url)}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
              <img src={c.image_url} alt={c.keyword} className="w-full object-contain bg-gray-50" loading="lazy" />
              <div className="p-2">
                <div className="text-xs font-medium text-gray-800 truncate">{c.keyword}</div>
                {c.product && <div className="text-xs text-gray-500 truncate">{c.product}</div>}
                {c.brand && (
                  <span className="mt-1 inline-block text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">
                    {c.brand}
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
