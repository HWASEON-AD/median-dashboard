'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Exposure { date: string; is_exposed: boolean }
interface Post {
  id: string; keyword: string; product: string | null
  blog_url: string | null; hwaseon_url: string | null
  tab_type: string | null; status: string; brand: string | null
  total_views: number | null
  median_daily_exposure: Exposure[]
}
interface DailyCapture {
  id: string; post_id: string; date: string
  brand: string | null; keyword: string; product: string | null
  image_url: string
}

function getCode(url: string | null) {
  if (!url) return null
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || null } catch { return null }
}

function toStr(d: Date) { return d.toISOString().slice(0, 10) }

function calcRange(mode: string): { start: string; end: string } {
  const today = new Date()
  const end = toStr(today)
  if (mode === '7d') { const s = new Date(today); s.setDate(s.getDate() - 6); return { start: toStr(s), end } }
  if (mode === '30d') { const s = new Date(today); s.setDate(s.getDate() - 29); return { start: toStr(s), end } }
  if (mode === '90d') { const s = new Date(today); s.setDate(s.getDate() - 89); return { start: toStr(s), end } }
  return { start: '2020-01-01', end }
}

function daysIn(start: string, end: string): string[] {
  const days: string[] = []; const cur = new Date(start); const endD = new Date(end)
  while (cur <= endD) { days.push(toStr(cur)); cur.setDate(cur.getDate() + 1) }
  return days
}

function CapGrid({ caps, onPreview }: { caps: DailyCapture[]; onPreview: (url: string) => void }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-3">
      {caps.map(c => (
        <div key={c.id} onClick={() => onPreview(c.image_url)}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
          <img src={c.image_url} alt={c.keyword} className="w-full object-contain bg-gray-50" loading="lazy" />
          <div className="p-2">
            <div className="text-xs font-medium text-gray-800 truncate">{c.keyword}</div>
            {c.product && <div className="text-xs text-gray-500 truncate">{c.product}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'exposure' | 'captures'>('exposure')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [capLoading, setCapLoading] = useState(false)
  // 선택 상태: 제품 선택 vs 키워드 선택 분리
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [selectedPost, setSelectedPost] = useState<Post | null>(null)
  const [openBrands, setOpenBrands] = useState<Set<string>>(new Set(['메디안']))
  const [openProducts, setOpenProducts] = useState<Set<string>>(new Set())
  const [rangeMode, setRangeMode] = useState('30d')
  const [customStart, setCustomStart] = useState(toStr(new Date(Date.now() - 29 * 86400000)))
  const [customEnd, setCustomEnd] = useState(toStr(new Date()))
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [capDate, setCapDate] = useState(toStr(new Date()))
  const [dailyCaptures, setDailyCaptures] = useState<DailyCapture[]>([])
  const [capBrand, setCapBrand] = useState<'전체' | '메디안'>('메디안')
  const [capPreview, setCapPreview] = useState<string | null>(null)

  const range = rangeMode === 'custom' ? { start: customStart, end: customEnd } : calcRange(rangeMode)
  const days = daysIn(range.start, range.end)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/keywords')
    const data = await r.json()
    const list: Post[] = Array.isArray(data) ? data : []
    setPosts(list)
    setLoading(false)
    const codes = list.map(p => ({ id: p.id, code: getCode(p.hwaseon_url) })).filter((x): x is { id: string; code: string } => !!x.code)
    const map: Record<string, number> = {}
    await Promise.all(codes.map(async ({ id, code }) => {
      try { const res = await fetch(`/api/clicks?code=${code}`); const d = await res.json(); map[id] = d.totalVisits ?? 0 } catch { map[id] = 0 }
    }))
    setClicks(map)
  }, [])

  useEffect(() => { load() }, [load])

  const loadCaptures = useCallback((date?: string) => {
    setCapLoading(true)
    const url = date ? `/api/captures?date=${date}` : '/api/captures'
    fetch(url).then(r => r.json()).then(d => {
      setDailyCaptures(d.records || [])
      if (!date && d.date) setCapDate(d.date)
      else if (date) setCapDate(date)
    }).finally(() => setCapLoading(false))
  }, [])

  useEffect(() => {
    if (activeTab !== 'captures') return
    if (dailyCaptures.length === 0) loadCaptures(capDate)
  }, [activeTab, capDate, dailyCaptures.length, loadCaptures])

  // 3-level: 브랜드 > product > keyword
  const brandProductMap: Record<string, Record<string, Post[]>> = {}
  for (const p of posts) {
    const brand = p.brand || '아모스'
    const product = p.product || '(미분류)'
    if (!brandProductMap[brand]) brandProductMap[brand] = {}
    if (!brandProductMap[brand][product]) brandProductMap[brand][product] = []
    brandProductMap[brand][product].push(p)
  }
  const brandList = Object.keys(brandProductMap).sort()
  // 히트맵용 product별 posts 매핑
  const productMap: Record<string, Post[]> = {}
  for (const p of posts) {
    const key = p.product || '(미분류)'
    if (!productMap[key]) productMap[key] = []
    productMap[key].push(p)
  }

  // 히트맵에 표시할 포스트 결정
  // - 키워드 선택: 해당 키워드만
  // - 제품 선택: 해당 제품 전체
  // - 아무것도 없으면: 노출중만
  const exposedPosts = posts.filter(p => p.status === '노출중')
  const heatmapPosts = selectedPost
    ? [selectedPost]
    : selectedProduct
      ? (productMap[selectedProduct] || [])
      : exposedPosts

  const exposedCount = exposedPosts.length
  const avgDays = posts.length === 0 ? 0 :
    Math.round(posts.reduce((a, p) => a + (p.median_daily_exposure || []).filter(e => e.is_exposed).length, 0) / posts.length)
  const totalClicks = Object.values(clicks).reduce((a, b) => a + b, 0)

  function inRange(e: Exposure) { return e.is_exposed && e.date >= range.start && e.date <= range.end }

  // 선택된 키워드 도표 데이터 (일별 노출 bar chart)
  const chartData = selectedPost ? days.map(d => {
    const exposed = (selectedPost.median_daily_exposure || []).some(e => e.date === d && e.is_exposed)
    return { date: d.slice(5), exposed: exposed ? 1 : 0 }
  }) : []

  // 제품 클릭 핸들러
  function handleProductClick(product: string, brand: string) {
    const key = `${brand}/${product}`
    const next = new Set(openProducts)
    if (next.has(key)) { next.delete(key) } else { next.add(key) }
    setOpenProducts(next)
    setSelectedProduct(prev => prev === product ? null : product)
    setSelectedPost(null)
  }

  // 키워드 클릭 핸들러 (사이드바 또는 히트맵 행)
  function handleKeywordClick(p: Post) {
    if (selectedPost?.id === p.id) {
      setSelectedPost(null)
    } else {
      setSelectedPost(p)
      setSelectedProduct(p.product)
    }
  }

  const medianCaps = dailyCaptures.filter(c => c.brand === '메디안')
  const filteredCaps = capBrand === '전체' ? dailyCaptures : medianCaps

  const heatmapLabel = selectedPost
    ? selectedPost.keyword
    : selectedProduct
      ? selectedProduct
      : '노출중'

  return (
    <div className="flex h-screen flex-col">
      {/* 헤더 */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-base font-bold text-gray-800">MEDIAN 블로그 노출 현황 대시보드</h1>
        <Link href="/admin" className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">관리자</Link>
      </header>

      {/* 탭 바 */}
      <div className="bg-white border-b border-gray-200 px-2 flex">
        {([['exposure','노출현황'],['captures','캡처']] as const).map(([t, l]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={activeTab === t
              ? 'px-4 py-2.5 text-sm font-medium border-b-2 border-blue-600 text-blue-600'
              : 'px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700'}>
            {l}
          </button>
        ))}
      </div>

      {activeTab === 'exposure' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* 사이드바 - 3레벨: 아모스 > 제품 > 키워드 */}
          <aside className="w-52 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
            <div className="overflow-y-auto text-sm flex-1">
              {loading ? (
                <div className="px-3 py-3 text-gray-400">불러오는 중...</div>
              ) : (
                <>
                  {/* Brand level - 동적 브랜드 */}
                  {brandList.map(brand => {
                    const isBrandOpen = openBrands.has(brand)
                    const brandProducts = Object.keys(brandProductMap[brand]).sort()
                    const brandCount = brandProducts.reduce((a, p) => a + brandProductMap[brand][p].length, 0)
                    return (
                      <div key={brand}>
                        <button
                          onClick={() => {
                            const next = new Set(openBrands)
                            if (next.has(brand)) { next.delete(brand) } else { next.add(brand) }
                            setOpenBrands(next)
                          }}
                          className="flex w-full items-center gap-1 px-2 py-1.5 font-bold text-gray-800 hover:bg-gray-100">
                          <span className="text-gray-500 text-[11px]">{isBrandOpen ? '▼' : '▶'}</span>
                          <span className="whitespace-nowrap">{brand}</span>
                          <span className="ml-auto text-gray-400 text-xs font-normal">{brandCount}</span>
                        </button>
                        {isBrandOpen && brandProducts.map(product => {
                          const isOpen = openProducts.has(`${brand}/${product}`)
                          const isSelected = selectedProduct === product
                          const productPosts = brandProductMap[brand][product]
                          return (
                            <div key={product}>
                              <button
                                onClick={() => handleProductClick(product, brand)}
                                className={`flex w-full items-center gap-1 pl-4 pr-2 py-1.5 hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}>
                                <span className="text-gray-400 text-[10px]">{isOpen ? '▼' : '▶'}</span>
                                <span className={`truncate text-xs font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>{product}</span>
                                <span className="ml-auto text-gray-300 text-[10px]">{productPosts.length}</span>
                              </button>
                              {isOpen && productPosts.map(p => (
                                <button key={p.id}
                                  onClick={() => handleKeywordClick(p)}
                                  className={`flex w-full items-center gap-1.5 pl-7 pr-2 py-1.5 text-xs transition-colors ${selectedPost?.id === p.id ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.status === '노출중' ? 'bg-green-500' : p.status === '종료' ? 'bg-red-300' : 'bg-gray-300'}`} />
                                  <span className="truncate">{p.keyword}</span>
                                </button>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {posts.length === 0 && (
                    <div className="px-3 py-4 text-xs text-gray-400">데이터가 없습니다. 관리자 페이지에서 Excel을 임포트하세요.</div>
                  )}
                </>
              )}
            </div>
          </aside>

          {/* 메인 영역 */}
          <main className="flex-1 overflow-y-auto p-5 min-w-0 bg-gray-50">
            {/* 날짜 컨트롤 */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <input type="date" value={range.start}
                    onChange={e => { setRangeMode('custom'); setCustomStart(e.target.value) }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <span className="text-gray-400 text-sm">~</span>
                  <input type="date" value={range.end}
                    onChange={e => { setRangeMode('custom'); setCustomEnd(e.target.value) }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div className="flex gap-1">
                  {[['7d','최근 7일'],['30d','최근 30일'],['90d','최근 90일'],['all','전체']].map(([m,l]) => (
                    <button key={m} onClick={() => setRangeMode(m)}
                      className={`px-2.5 py-1 text-xs rounded transition-colors ${rangeMode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <a href={`/api/export-excel?start=${range.start}&end=${range.end}`}
                className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors">
                Excel 다운로드
              </a>
            </div>

            {/* KPI */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { label: '전체 키워드', val: `${posts.length}개`, cls: 'bg-blue-50 text-blue-700', tip: '관리자에 등록된 전체 키워드(포스트) 수. 상태(노출중·미노출·종료) 무관 전체 합산.' },
                { label: '노출중 키워드', val: `${exposedCount}개`, cls: 'bg-green-50 text-green-700', tip: '현재 상태가 노출중인 키워드 수. 당일 3번 체크 중 한 번이라도 노출 확인되면 하루 종일 노출중 유지.' },
                { label: '평균 노출일수', val: `${avgDays}일`, cls: 'bg-yellow-50 text-yellow-700', tip: '전체 키워드의 누적 노출일수 평균. 선택한 날짜 범위와 무관하게 전체 기간 기준으로 계산.' },
                { label: '총 방문자수', val: totalClicks > 0 ? totalClicks.toLocaleString() : '-', cls: 'bg-purple-50 text-purple-700', tip: 'hwaseon-image 제품링크가 연결된 키워드의 방문자수 합계. 제품링크 미등록 키워드는 제외.' },
              ].map(c => (
                <div key={c.label} className={`rounded-lg p-3 ${c.cls}`}>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-xs opacity-70">{c.label}</span>
                    <div className="relative group flex-shrink-0">
                      <span className="w-3.5 h-3.5 rounded-full border border-current opacity-50 flex items-center justify-center text-[9px] font-bold cursor-help leading-none">?</span>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-48 bg-gray-800 text-white text-[11px] rounded-lg px-2.5 py-2 leading-relaxed shadow-lg pointer-events-none">
                        {c.tip}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
                      </div>
                    </div>
                  </div>
                  <div className="text-xl font-bold">{c.val}</div>
                </div>
              ))}
            </div>

            {/* 히트맵 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">
                데일리 노출 현황 ({heatmapLabel})
              </h2>
              {loading ? (
                <div className="text-sm text-gray-400 py-2">로딩 중...</div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="inline-block min-w-full">
                    {/* 날짜 헤더 */}
                    <div className="flex gap-0.5 mb-1">
                      <div className="w-44 flex-shrink-0" />
                      {days.map(d => (
                        <div key={d} className="w-5 flex-shrink-0 text-center text-gray-400" style={{ fontSize: '9px' }}>
                          {d.slice(8)}
                        </div>
                      ))}
                    </div>
                    {/* 키워드 행 - 클릭 시 도표 표시 */}
                    {heatmapPosts.map(p => {
                      const expSet = new Set((p.median_daily_exposure || []).filter(e => inRange(e)).map(e => e.date))
                      const isSelected = selectedPost?.id === p.id
                      return (
                        <div key={p.id}
                          onClick={() => handleKeywordClick(p)}
                          className={`flex items-center gap-0.5 mb-1 cursor-pointer rounded-md px-1 py-0.5 ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          <div className={`w-44 flex-shrink-0 pr-2 min-w-0 ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                            <div className="text-xs font-medium truncate leading-tight">{p.keyword}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-gray-400">{p.median_daily_exposure.length}일</span>
                              {p.total_views != null && (
                                <span className="text-[10px] text-gray-400">{p.total_views.toLocaleString()}회</span>
                              )}
                            </div>
                          </div>
                          {days.map(d => (
                            <div key={d} title={`${p.keyword} ${d}`}
                              className={`w-5 h-5 rounded flex-shrink-0 ${expSet.has(d) ? 'bg-green-500' : 'bg-gray-100'}`} />
                          ))}
                        </div>
                      )
                    })}
                    {heatmapPosts.length === 0 && exposedPosts.length === 0 && posts.length > 0 && (
                      <div className="text-sm text-gray-400 py-2">노출중인 키워드가 없습니다.</div>
                    )}
                    {posts.length === 0 && (
                      <div className="text-sm text-gray-400 py-2">데이터가 없습니다. 관리자 페이지에서 Excel을 임포트하세요.</div>
                    )}
                  </div>
                </div>
              )}
              {!loading && (
                <div className="flex gap-3 mt-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> 노출</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200 inline-block" /> 미노출</span>
                  <span className="text-gray-300">· 행 클릭 시 상세 도표</span>
                </div>
              )}
            </div>

            {/* 키워드 선택 시 도표 */}
            {!selectedPost ? (
              <div className="text-sm text-gray-400 text-center py-4">
                좌측에서 키워드를 선택하면 방문자수 차트가 표시됩니다.
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                {/* 키워드 정보 */}
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="font-semibold text-gray-800 text-base">{selectedPost.keyword}</h3>
                  <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${selectedPost.status === '노출중' ? 'bg-green-100 text-green-700' : selectedPost.status === '종료' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                    {selectedPost.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-5">
                  <div><span className="text-gray-400 text-xs block">제품</span>{selectedPost.product || '-'}</div>
                  <div><span className="text-gray-400 text-xs block">노출탭</span>{selectedPost.tab_type || '-'}</div>
                  <div><span className="text-gray-400 text-xs block">노출일수</span>{(selectedPost.median_daily_exposure || []).filter(e => e.is_exposed).length}일</div>
                  <div><span className="text-gray-400 text-xs block">총 클릭수</span>
                    {!selectedPost.hwaseon_url
                      ? <span className="text-gray-400 text-xs">조회수 트래킹 불가<br/><span className="text-gray-300">(image호스팅 연결x)</span></span>
                      : clicks[selectedPost.id] != null ? clicks[selectedPost.id].toLocaleString() : '-'}
                  </div>
                </div>

                {/* 일별 노출 도표 — 노출된 날만 점 표시 */}
                <h4 className="text-xs font-semibold text-gray-500 mb-3">일별 노출 현황</h4>
                <div className="overflow-x-auto pb-2">
                  <div className="relative" style={{ minWidth: `${chartData.length * 22}px`, height: 56 }}>
                    {/* 기준선 */}
                    <div className="absolute left-0 right-0 bg-gray-100 rounded-full" style={{ top: 14, height: 2 }} />
                    {chartData.map((d, i) => {
                      const showLabel = i === 0 || i % 7 === 0
                      const x = i * 22 + 11
                      return (
                        <div key={i} className="absolute flex flex-col items-center" style={{ left: x - 8, top: 0, width: 16 }}
                          title={`${d.date}: ${d.exposed ? '노출' : '미노출'}`}>
                          {d.exposed
                            ? <div className="w-4 h-4 rounded-full bg-red-500 shadow-sm shadow-red-200 ring-2 ring-white" />
                            : <div className="w-2 h-2 rounded-full bg-gray-200 mt-1" />}
                          {showLabel && (
                            <span className="absolute text-gray-400 text-center whitespace-nowrap" style={{ top: 26, fontSize: 9 }}>{d.date}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* URL 링크 */}
                <div className="flex gap-3 flex-wrap mt-3">
                  {selectedPost.blog_url && (
                    <a href={selectedPost.blog_url} target="_blank" rel="noreferrer" className="text-blue-500 text-xs hover:underline truncate">
                      발행 URL: {selectedPost.blog_url}
                    </a>
                  )}
                  {selectedPost.hwaseon_url && (
                    <a href={selectedPost.hwaseon_url} target="_blank" rel="noreferrer" className="text-purple-500 text-xs hover:underline truncate">
                      제품링크: {selectedPost.hwaseon_url}
                    </a>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      ) : (
        /* 캡처 탭 */
        <div className="flex-1 overflow-y-auto p-5 bg-gray-50">
          {/* 헤더: 날짜 선택 + 브랜드 필터 */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input type="date" value={capDate}
              onChange={e => loadCaptures(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <div className="flex gap-2">
              {(['전체','메디안'] as const).map(b => (
                <button key={b} onClick={() => setCapBrand(b)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${capBrand === b ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {b}
                </button>
              ))}
            </div>
          </div>
          {capLoading ? (
            <div className="text-center py-20 text-gray-400">로딩 중...</div>
          ) : capBrand === '전체' ? (
            <div className="space-y-8">
              {medianCaps.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                    메디안 <span className="text-xs font-normal text-gray-400">{medianCaps.length}건</span>
                  </h3>
                  <CapGrid caps={medianCaps} onPreview={setCapPreview} />
                </div>
              )}
              {dailyCaptures.length === 0 && (
                <div className="text-center py-20 text-gray-400 text-sm">해당 날짜 캡처 없음</div>
              )}
            </div>
          ) : filteredCaps.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-sm">해당 날짜 캡처 없음</div>
          ) : (
            <CapGrid caps={filteredCaps} onPreview={setCapPreview} />
          )}
          {capPreview && (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center" onClick={() => setCapPreview(null)}>
              <img src={capPreview} alt="preview" className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
