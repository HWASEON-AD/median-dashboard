'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'

interface Exposure { date: string; is_exposed: boolean }
interface Keyword {
  id: string; keyword: string; product: string | null
  blog_url: string | null; hwaseon_url: string | null
  tab_type: string | null; status: string; brand: string | null
  median_daily_exposure: Exposure[]
}

const STATUSES = ['미노출', '노출중', '종료', '진행X']
const BRANDS = ['메디안']

function getCode(url: string | null) {
  if (!url) return null
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || null } catch { return null }
}

function parsePaste(raw: string) {
  return raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const c = l.split('\t')
    return { brand: c[0]?.trim() || '메디안', product: c[1]?.trim() || '', keyword: c[2]?.trim() || c[0]?.trim() || '', tab_type: c[3]?.trim() || '', blog_url: c[4]?.trim() || '', hwaseon_url: c[5]?.trim() || '' }
  }).filter(r => r.keyword)
}

function parseXlsx(buf: ArrayBuffer) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: (string | number | Date | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const hi = rows.findIndex(r => r.some(c => ['키워드', '검색어'].includes(String(c).trim())))
  const headerRow = hi >= 0 ? rows[hi] : rows[0]
  const dataRows = hi >= 0 ? rows.slice(hi + 1) : rows.slice(1)
  const headers = headerRow.map(c => String(c ?? '').toLowerCase())
  const ci = {
    brand: headers.findIndex(h => ['브랜드', 'brand'].some(k => h.includes(k))),
    product: headers.findIndex(h => ['제품', 'product', '상품'].some(k => h.includes(k)) && !h.includes('링크')),
    keyword: headers.findIndex(h => ['키워드', '검색어', 'keyword'].some(k => h.includes(k))),
    tab: headers.findIndex(h => ['탭', 'tab', '노출탭'].some(k => h.includes(k))),
    blog_url: headers.findIndex(h => ['발행', 'blog'].some(k => h.includes(k)) && !h.includes('hwaseon') && !h.includes('제품')),
    hwaseon_url: headers.findIndex(h => ['hwaseon', '단축', '제품링크'].some(k => h.includes(k))),
  }
  return dataRows.filter(r => r.some(c => c !== '')).map(r => ({
    brand: String(r[ci.brand >= 0 ? ci.brand : 0] ?? '').trim() || '메디안',
    product: String(r[ci.product >= 0 ? ci.product : 1] ?? '').trim(),
    keyword: String(r[ci.keyword >= 0 ? ci.keyword : 2] ?? '').trim(),
    tab_type: String(r[ci.tab >= 0 ? ci.tab : 3] ?? '').trim(),
    blog_url: String(r[ci.blog_url >= 0 ? ci.blog_url : 4] ?? '').trim(),
    hwaseon_url: String(r[ci.hwaseon_url >= 0 ? ci.hwaseon_url : 5] ?? '').trim(),
  })).filter(r => r.keyword)
}

type ExposureRow = { keyword: string; product: string; brand: string; date: string; is_exposed: boolean }

function parseXlsxExposure(buf: ArrayBuffer): ExposureRow[] {
  // 단일 시트에서 날짜 컬럼 파싱 (브랜드|제품|키워드|노출탭|발행URL|제품링크URL|날짜1|날짜2|...)
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: (string | number | Date | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  if (rows.length < 2) return []
  const headers = rows[0].map(h => {
    if (h instanceof Date) return h.toISOString().slice(0, 10)
    return String(h ?? '').trim()
  })
  const kwIdx = headers.findIndex(h => ['키워드', 'keyword'].some(k => h.toLowerCase().includes(k)))
  const prIdx = headers.findIndex(h => ['제품', 'product'].some(k => h.toLowerCase().includes(k)) && !h.includes('링크'))
  const brIdx = headers.findIndex(h => ['브랜드', 'brand'].some(k => h.toLowerCase().includes(k)))
  const dateCols = headers.map((h, i) => ({ date: h, i })).filter(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date))
  if (!dateCols.length) return []
  const result: ExposureRow[] = []
  const seen = new Set<string>()
  for (const row of rows.slice(1)) {
    const keyword = String(row[kwIdx >= 0 ? kwIdx : 2] ?? '').trim()
    if (!keyword) continue
    const product = String(row[prIdx >= 0 ? prIdx : 1] ?? '').trim()
    const brand = String(row[brIdx >= 0 ? brIdx : 0] ?? '').trim() || '메디안'
    for (const { date, i } of dateCols) {
      const val = String(row[i] ?? '').trim()
      if (!val) continue
      const is_exposed = val.includes('노출') && !val.includes('미노출') || val === '1' || val.toLowerCase() === 'true'
      const uniq = `${keyword}|||${date}`
      if (seen.has(uniq)) continue
      seen.add(uniq)
      result.push({ keyword, product, brand, date, is_exposed })
    }
  }
  return result
}

export default function AdminPage() {
  const [rows, setRows] = useState<Keyword[]>([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab_type: '', status: '', brand: '메디안' })
  const [newRow, setNew] = useState({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab_type: '', brand: '메디안' })
  const [pasteText, setPaste] = useState('')
  const [pasteMode, setPasteMode] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [importing, setImporting] = useState(false)
  const [clicks, setClicks] = useState<Record<string, number>>({})
  const [cafeViews, setCafeViews] = useState<Record<string, number | null>>({})
  const [urlFilter, setUrlFilter] = useState('전체')
  const [productFilter, setProductFilter] = useState('제품 전체')
  const [brandFilter, setBrandFilter] = useState('브랜드 전체')
  const fileRef = useRef<HTMLInputElement>(null)

  const flash = (text: string, ok: boolean) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/keywords')
    const d = await r.json()
    const list: Keyword[] = Array.isArray(d) ? d : []
    setRows(list)
    setLoading(false)
    const codes = list.map(p => ({ id: p.id, code: getCode(p.hwaseon_url) })).filter((x): x is { id: string; code: string } => !!x.code)
    const map: Record<string, number> = {}
    await Promise.all(codes.map(async ({ id, code }) => {
      try { const res = await fetch(`/api/clicks?code=${code}`); const j = await res.json(); map[id] = j.totalVisits ?? 0 } catch { map[id] = 0 }
    }))
    setClicks(map)

    // 카페 URL 조회수
    const cafePosts = list.filter(p => p.blog_url?.includes('cafe.naver.com'))
    const cafeMap: Record<string, number | null> = {}
    await Promise.all(cafePosts.map(async p => {
      try { const res = await fetch(`/api/cafe-views?url=${encodeURIComponent(p.blog_url!)}`); const j = await res.json(); cafeMap[p.id] = j.views ?? null } catch { cafeMap[p.id] = null }
    }))
    setCafeViews(cafeMap)
  }, [])

  useEffect(() => { load() }, [load])

  // 키워드 수정/추가 후 즉시 1회 노출 체크 트리거 (fire-and-forget, 실패해도 흐름 유지)
  function triggerCheck(postId: string) {
    fetch('/api/trigger-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ post_id: postId }) })
      .catch(e => console.error('trigger-check 실패', e))
  }

  async function save(id: string) {
    const r = await fetch(`/api/keywords/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) })
    if (r.ok) {
      triggerCheck(id)  // 수정 성공 후 무조건 1회 트리거
      setEditId(null); load()
    } else flash('저장 실패', false)
  }

  async function del(id: string, kw: string) {
    if (!confirm(`"${kw}" 삭제?`)) return
    await fetch(`/api/keywords/${id}`, { method: 'DELETE' })
    load()
  }

  async function add() {
    if (!newRow.keyword.trim()) return flash('키워드 필수', false)
    const r = await fetch('/api/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRow) })
    if (r.ok) {
      // POST /api/keywords는 생성된 단건 row를 반환하므로 id 추출
      const created = await r.json().catch(() => null)
      // id가 있을 때만 트리거 (빈 문자열이면 GitHub Actions가 0건 매칭으로 헛돌므로 호출하지 않음)
      if (created?.id) triggerCheck(created.id)  // 추가 성공 후 새 post id로 1회 트리거
      setNew({ keyword: '', product: '', blog_url: '', hwaseon_url: '', tab_type: '', brand: '메디안' }); load()
    } else flash('추가 실패', false)
  }

  async function importRows(data: { keyword: string; product: string; tab_type: string; blog_url: string; hwaseon_url: string; brand: string }[]) {
    if (!data.length) return flash('파싱된 데이터 없음', false)
    if (replaceMode && !confirm(`기존 데이터 전체(${rows.length}개)를 삭제하고 새 데이터(${data.length}개)로 교체합니다. 계속하시겠습니까?`)) return
    setImporting(true)
    const r = await fetch('/api/keywords/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: data, replace: replaceMode }) })
    const d = await r.json()
    setImporting(false)
    if (r.ok) { flash(`${d.inserted}개 저장 완료 (신규 ${d.added}, 수정 ${d.updated})`, true); setPaste(''); setSelectedFile(null); setShowImport(false); load() }
    else flash(`오류: ${d.error}`, false)
  }

  async function importExposure(data: ExposureRow[]) {
    if (!data.length) return
    const r = await fetch('/api/exposure/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exposures: data }) })
    const d = await r.json()
    if (r.ok && d.count > 0) flash(`노출기록 ${d.count}건 저장`, true)
    else if (!r.ok) flash(`노출기록 오류: ${d.error}`, false)
  }

  function downloadTemplate() {
    const dates: string[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000)
      dates.push(d.toISOString().slice(0, 10))
    }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['브랜드', '제품', '키워드', '노출탭', '발행URL', '제품링크URL', ...dates],
      ['메디안', '치약', '메디안 치약 추천', '인플루언서 블로그', 'https://blog.naver.com/example/123', '', ...dates.map(() => '')],
      ['아윤체', '샴푸', '아윤체 두피 샴푸', '블로그', '', '', ...dates.map(() => '')],
    ])
    ws['!cols'] = [{ wch: 8 }, { wch: 15 }, { wch: 28 }, { wch: 12 }, { wch: 45 }, { wch: 35 }, ...dates.map(() => ({ wch: 11 }))]
    XLSX.utils.book_append_sheet(wb, ws, '노출현황')
    XLSX.writeFile(wb, '메디안_키워드_양식.xlsx')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setSelectedFile(file.name)
    const buf = await file.arrayBuffer()
    const kwData = parseXlsx(buf)
    const expData = parseXlsxExposure(buf)
    if (kwData.length) await importRows(kwData)
    if (expData.length) await importExposure(expData)
    if (fileRef.current) fileRef.current.value = ''
  }

  const pastePreview = parsePaste(pasteText)
  const brands = Array.from(new Set(rows.map(r => r.brand).filter(Boolean) as string[])).sort()
  const products = Array.from(new Set(rows.filter(r => brandFilter === '브랜드 전체' || r.brand === brandFilter).map(r => r.product).filter(Boolean) as string[])).sort()

  const filtered = rows.filter(r => {
    if (urlFilter === 'URL 없음' && r.blog_url) return false
    if (urlFilter === 'URL 있음' && !r.blog_url) return false
    if (productFilter !== '제품 전체' && r.product !== productFilter) return false
    if (brandFilter !== '브랜드 전체' && r.brand !== brandFilter) return false
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900">관리자 패널</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(s => !s)}
            className={`px-3 py-1.5 text-sm rounded ${showImport ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            Excel 임포트
          </button>
          <a href="/" className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">대시보드</a>
        </div>
      </header>

      {msg && (
        <div className={`fixed top-14 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium shadow-lg ${msg.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {msg.text}
        </div>
      )}

      <div className="max-w-screen-xl mx-auto px-4 py-5 space-y-5">

        {/* Excel 임포트 패널 */}
        {showImport && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-semibold text-gray-800">Excel 임포트</h2>
              <div className="flex gap-2">
                <button onClick={downloadTemplate}
                  className="px-3 py-1.5 rounded text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200">
                  📥 양식 다운로드
                </button>
                <a href="/api/export-excel" className="px-3 py-1.5 rounded text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200">
                  📤 현재 데이터 다운로드 (단일 시트)
                </a>
              </div>
            </div>

            {/* 업로드 방식 */}
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-xs text-gray-600 font-medium">업로드 방식:</span>
              <button onClick={() => setReplaceMode(false)}
                className={`px-3 py-1 rounded text-xs font-medium ${!replaceMode ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-300'}`}>
                추가/수정
              </button>
              <button onClick={() => setReplaceMode(true)}
                className={`px-3 py-1 rounded text-xs font-medium ${replaceMode ? 'bg-red-500 text-white' : 'bg-white text-gray-500 border border-gray-300'}`}>
                전체 교체
              </button>
              <span className="text-xs text-gray-400">
                {replaceMode ? '⚠️ 기존 데이터 전부 삭제 후 교체' : '기존 유지 + 새 데이터 추가·수정'}
              </span>
            </div>

            {/* 파일 / 복붙 탭 */}
            <div className="flex gap-2 mb-4">
              {/* 파일 업로드 버튼 — 클릭 시 바로 파일 창 */}
              <button
                onClick={() => { setPasteMode(false); fileRef.current?.click() }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${!pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                📂 파일 업로드
              </button>
              <button onClick={() => setPasteMode(true)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${pasteMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                복붙 (Ctrl+V)
              </button>
            </div>

            {/* 숨겨진 파일 input */}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />

            {!pasteMode ? (
              <div className="text-sm text-gray-400">
                {importing ? '저장 중...' : selectedFile ? `선택됨: ${selectedFile}` : '파일 업로드 버튼을 클릭하세요 (.xlsx / .xls / .csv)'}
              </div>
            ) : (
              <div>
                <textarea value={pasteText} onChange={e => setPaste(e.target.value)}
                  placeholder={"엑셀에서 복사(Ctrl+C) 후 붙여넣기(Ctrl+V)\n컬럼 순서: 브랜드 | 제품 | 키워드 | 노출탭 | 발행URL | 제품링크URL"}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm font-mono h-32 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <div className="flex items-center gap-3 mt-2">
                  <button onClick={() => importRows(pastePreview)} disabled={importing || !pastePreview.length}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40">
                    {importing ? '저장 중...' : `가져오기 (${pastePreview.length}행)`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 키워드 관리 */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-semibold text-gray-700">키워드 관리</span>
            <div className="flex items-center gap-2">
              <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                <option value="브랜드 전체">브랜드 전체</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={urlFilter} onChange={e => setUrlFilter(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                {['전체', 'URL 없음', 'URL 있음'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none">
                <option value="제품 전체">제품 전체</option>
                {products.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <span className="text-xs text-gray-400">{filtered.length}건</span>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-400">로딩 중...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1200px]">
                <thead className="bg-gray-50 text-gray-500 text-xs border-b border-gray-100">
                  <tr>
                    <th className="text-left px-3 py-2 w-8 whitespace-nowrap">#</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">브랜드</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">상태</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">제품</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">키워드</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">노출탭</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">발행URL</th>
                    <th className="text-left px-3 py-2 whitespace-nowrap">제품링크URL</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">총 노출일</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">카페 조회수</th>
                    <th className="text-right px-3 py-2 whitespace-nowrap">총 클릭수</th>
                    <th className="px-3 py-2 w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((row, i) => {
                    const exposureDays = (row.median_daily_exposure || []).filter(e => e.is_exposed).length
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        {editId === row.id ? (
                          <>
                            <td className="px-3 py-1.5 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-2 py-1.5">
                              <select value={edit.brand} onChange={e => setEdit(p => ({ ...p, brand: e.target.value }))}
                                className="border border-blue-400 rounded px-2 py-1 text-xs w-full">
                                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <select value={edit.status} onChange={e => setEdit(p => ({ ...p, status: e.target.value }))}
                                className="border border-blue-400 rounded px-2 py-1 text-xs w-full">
                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </td>
                            {(['product', 'keyword'] as const).map(f => (
                              <td key={f} className="px-2 py-1.5">
                                <input value={edit[f]} onChange={e => setEdit(p => ({ ...p, [f]: e.target.value }))}
                                  className="border border-blue-400 rounded px-2 py-1 text-xs w-full min-w-[80px]" />
                              </td>
                            ))}
                            <td className="px-2 py-1.5">
                              <input value={edit.tab_type} onChange={e => setEdit(p => ({ ...p, tab_type: e.target.value }))}
                                className="border border-blue-400 rounded px-2 py-1 text-xs w-full min-w-[60px]" />
                            </td>
                            {(['blog_url', 'hwaseon_url'] as const).map(f => (
                              <td key={f} className="px-2 py-1.5">
                                <input value={edit[f]} onChange={e => setEdit(p => ({ ...p, [f]: e.target.value }))}
                                  className="border border-blue-400 rounded px-2 py-1 text-xs w-full min-w-[100px]" />
                              </td>
                            ))}
                            <td className="px-3 py-1.5 text-gray-300 text-xs text-right">-</td>
                            <td className="px-3 py-1.5 text-gray-300 text-xs text-right">-</td>
                            <td className="px-3 py-1.5 text-gray-300 text-xs text-right">-</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <button onClick={() => save(row.id)} className="text-xs text-blue-600 hover:text-blue-800 mr-2">저장</button>
                              <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:text-gray-600">취소</button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-3 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-3">
                              <span className={`px-2 py-0.5 text-xs rounded font-medium whitespace-nowrap ${row.brand === '아윤체' ? 'bg-purple-50 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                                {row.brand || '메디안'}
                              </span>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${row.status === '노출중' ? 'bg-green-100 text-green-700' : row.status === '종료' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
                                {row.status || '-'}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-gray-600 text-xs whitespace-nowrap max-w-[120px] truncate">{row.product || '-'}</td>
                            <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{row.keyword}</td>
                            <td className="px-3 py-3 text-gray-500 text-xs whitespace-nowrap">{row.tab_type || '-'}</td>
                            <td className="px-3 py-3 max-w-[160px]">
                              {row.blog_url
                                ? <a href={row.blog_url} target="_blank" rel="noreferrer" className="text-blue-500 text-xs hover:underline truncate block max-w-[150px]">{row.blog_url}</a>
                                : <span className="text-gray-300 text-xs">-</span>}
                            </td>
                            <td className="px-3 py-3 max-w-[150px]">
                              {row.hwaseon_url
                                ? <a href={row.hwaseon_url} target="_blank" rel="noreferrer" className="text-purple-500 text-xs hover:underline truncate block max-w-[140px]">{row.hwaseon_url}</a>
                                : <span className="text-gray-400 text-xs">알수없음</span>}
                            </td>
                            <td className="px-3 py-3 text-right text-xs text-gray-600 whitespace-nowrap">{exposureDays > 0 ? `${exposureDays}일` : '-'}</td>
                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              {row.blog_url?.includes('cafe.naver.com')
                                ? cafeViews[row.id] != null
                                  ? <span className="text-xs font-semibold text-blue-600">{(cafeViews[row.id] as number).toLocaleString()}</span>
                                  : <span className="text-gray-300 text-xs">-</span>
                                : <span className="text-gray-200 text-xs">-</span>}
                            </td>
                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              {getCode(row.hwaseon_url) && clicks[row.id] != null
                                ? <span className="text-xs font-semibold text-purple-700">{clicks[row.id].toLocaleString()}</span>
                                : <span className="text-gray-300 text-xs">-</span>}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <button onClick={() => { setEditId(row.id); setEdit({ keyword: row.keyword, product: row.product || '', blog_url: row.blog_url || '', hwaseon_url: row.hwaseon_url || '', tab_type: row.tab_type || '', status: row.status, brand: row.brand || '메디안' }) }}
                                className="text-xs text-gray-400 hover:text-gray-700 mr-2">수정</button>
                              <button onClick={() => del(row.id, row.keyword)}
                                className="text-xs text-gray-300 hover:text-red-500">×</button>
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                  {/* 새 행 추가 */}
                  <tr className="bg-gray-50">
                    <td className="px-3 py-2 text-gray-400 text-xs">+</td>
                    <td className="px-2 py-2">
                      <select value={newRow.brand} onChange={e => setNew(p => ({ ...p, brand: e.target.value }))}
                        className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400">
                        {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td />
                    {([['product', '제품명'], ['keyword', '키워드 (필수)']] as [string, string][]).map(([k, ph]) => (
                      <td key={k} className="px-2 py-2">
                        <input value={(newRow as Record<string, string>)[k]} onChange={e => setNew(p => ({ ...p, [k]: e.target.value }))}
                          placeholder={ph}
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                    ))}
                    <td className="px-2 py-2">
                      <input value={newRow.tab_type} onChange={e => setNew(p => ({ ...p, tab_type: e.target.value }))}
                        placeholder="노출탭"
                        className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </td>
                    {([['blog_url', '발행URL'], ['hwaseon_url', '제품링크URL']] as [string, string][]).map(([k, ph]) => (
                      <td key={k} className="px-2 py-2">
                        <input value={(newRow as Record<string, string>)[k]} onChange={e => setNew(p => ({ ...p, [k]: e.target.value }))}
                          placeholder={ph}
                          className="border border-gray-300 rounded px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                    ))}
                    <td colSpan={3} />
                    <td className="px-2 py-2">
                      <button onClick={add} className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">추가</button>
                    </td>
                  </tr>
                  {filtered.length === 0 && rows.length > 0 && (
                    <tr><td colSpan={12} className="text-center py-8 text-gray-400 text-sm">필터 결과 없음</td></tr>
                  )}
                  {rows.length === 0 && (
                    <tr><td colSpan={12} className="text-center py-10 text-gray-400">데이터 없음</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
