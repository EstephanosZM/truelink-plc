import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import RepScorecard from '../components/RepScorecard'
import RouteCompletionReport from '../components/RouteCompletionReport'
import OutletVisitHistory from '../components/OutletVisitHistory'

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16']

type MainView = 'overview' | 'reps' | 'products' | 'territories' | 'proximity' | 'scorecard' | 'completion' | 'outlet-history'

export default function ReportsPage() {
  const { territories, salesReps, brands, flavors, products } = useStore()

  const [view,         setView]         = useState<MainView>('overview')
  const [period,       setPeriod]       = useState('month')
  const [filterTerrId, setFilterTerrId] = useState('')
  const [loading,      setLoading]      = useState(false)

  // Overview data
  const [overview, setOverview] = useState<{
    totalRevenue: number; totalUnits: number; outletsVisited: number; totalOutlets: number
    dailyRevenue: { date: string; revenue: number }[]
    topProducts:  { name: string; revenue: number }[]
    topOutlets:   { name: string; revenue: number }[]
  } | null>(null)

  // Rep data
  const [repData, setRepData] = useState<{
    id: string; name: string; visited: number; units: number; revenue: number; flagged: number
  }[]>([])

  // Product data
  const [productData,  setProductData]  = useState<{ id: string; name: string; brand: string; flavor: string; units: number; revenue: number; outlets: number }[]>([])
  const [brandRevenue, setBrandRevenue] = useState<{ name: string; value: number }[]>([])

  // Territory data
  const [terrData, setTerrData] = useState<{
    id: string; name: string; outlets: number; visited: number; units: number; revenue: number
  }[]>([])

  // Completion report
  const [completionPlans, setCompletionPlans] = useState<{ id: string; route_name: string | null; generated_at: string; n_days: number; territory: string }[]>([])
  const [selPlanId,       setSelPlanId]       = useState('')
  const [selDay,          setSelDay]          = useState(1)
  const [planDays,        setPlanDays]        = useState<number[]>([])

  // Outlet history
  const [outletSearch,  setOutletSearch]  = useState('')
  const [outletResults, setOutletResults] = useState<{ id: string; outlet_name: string; land_mark: string | null }[]>([])
  const [selOutletId,   setSelOutletId]   = useState('')
  const [selOutletName, setSelOutletName] = useState('')

  const getDateRange = () => {
    const now = new Date()
    const end = now.toISOString().split('T')[0]
    if (period === 'today') return { start: end, end }
    if (period === 'week')  { const d = new Date(now); d.setDate(d.getDate()-7);   return { start: d.toISOString().split('T')[0], end } }
    if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth()-1); return { start: d.toISOString().split('T')[0], end } }
    if (period === 'last_month') {
      const s = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: s.toISOString().split('T')[0], end: e.toISOString().split('T')[0] }
    }
    return { start: end, end }
  }

  useEffect(() => { if (['overview','reps','products','territories','proximity'].includes(view)) loadData() }, [view, period, filterTerrId])
  useEffect(() => { if (view === 'completion') loadPlans() }, [view])
  useEffect(() => { if (selPlanId) loadPlanDays() }, [selPlanId])

  const getOids = async (terrId: string) => {
    const { data } = await supabase.from('outlets').select('id').eq('territory_id', terrId)
    return (data || []).map((o: { id: string }) => o.id)
  }

  const loadData = async () => {
    setLoading(true)
    const { start, end } = getDateRange()

    if (view === 'overview') {
      let q = supabase.from('sales_records')
        .select('quantity, total_price, outlet_id, product_id, sale_date')
        .gte('sale_date', start).lte('sale_date', end)
      if (filterTerrId) { const ids = await getOids(filterTerrId); q = q.in('outlet_id', ids) }
      const { data: recs } = await q
      const rows = recs || []

      const totalRevenue   = rows.reduce((a: number, r: { total_price: number }) => a + r.total_price, 0)
      const totalUnits     = rows.reduce((a: number, r: { quantity: number })    => a + r.quantity,    0)
      const visitedOutlets = new Set(rows.map((r: { outlet_id: string }) => r.outlet_id)).size
      const { count: tc }  = await supabase.from('outlets').select('id', { count: 'exact', head: true })

      const byDate: Record<string, number> = {}
      rows.forEach((r: { sale_date: string; total_price: number }) => { byDate[r.sale_date] = (byDate[r.sale_date]||0) + r.total_price })
      const dailyRevenue = Object.entries(byDate).sort((a,b)=>a[0].localeCompare(b[0]))
        .map(([date, revenue]) => ({ date: date.slice(5), revenue: Math.round(revenue as number) }))

      const byProd: Record<string, number> = {}
      rows.forEach((r: { product_id: string; total_price: number }) => { byProd[r.product_id] = (byProd[r.product_id]||0) + r.total_price })
      const topProducts = Object.entries(byProd).sort((a,b)=>b[1]-a[1]).slice(0,5)
        .map(([id, rev]) => ({ name: (products.find((p)=>p.id===id)?.name||'Unknown').slice(0,20), revenue: Math.round(rev as number) }))

      const byOut: Record<string, number> = {}
      rows.forEach((r: { outlet_id: string; total_price: number }) => { byOut[r.outlet_id] = (byOut[r.outlet_id]||0) + r.total_price })
      const { data: outNames } = await supabase.from('outlets').select('id, outlet_name').in('id', Object.keys(byOut).slice(0,10))
      const nMap: Record<string,string> = {}
      ;(outNames||[]).forEach((o: { id: string; outlet_name: string }) => { nMap[o.id] = o.outlet_name })
      const topOutlets = Object.entries(byOut).sort((a,b)=>b[1]-a[1]).slice(0,5)
        .map(([id, rev]) => ({ name: (nMap[id]||'Unknown').slice(0,20), revenue: Math.round(rev as number) }))

      setOverview({ totalRevenue, totalUnits, outletsVisited: visitedOutlets, totalOutlets: tc||0, dailyRevenue, topProducts, topOutlets })
    }

    if (view === 'reps') {
      const { data: recs }  = await supabase.from('sales_records').select('sales_rep_id, quantity, total_price').gte('sale_date', start).lte('sale_date', end)
      const { data: stops } = await supabase.from('route_stops').select('sales_rep_id, visited, checkin_flagged').eq('visited', true)
      const { data: repSalesAll } = await supabase.from('sales_records').select('sales_rep_id, quantity').gte('sale_date', start).lte('sale_date', end)
      const salesByRep: Record<string, number> = {}
      ;(repSalesAll||[]).forEach((r: { sales_rep_id: string; quantity: number }) => { salesByRep[r.sales_rep_id] = (salesByRep[r.sales_rep_id]||0) + r.quantity })

      setRepData(salesReps.map((rep) => ({
        id: rep.id, name: rep.name,
        visited: (stops||[]).filter((s: { sales_rep_id: string }) => s.sales_rep_id === rep.id).length,
        units:   salesByRep[rep.id] || 0,
        revenue: (recs||[]).filter((r: { sales_rep_id: string }) => r.sales_rep_id === rep.id).reduce((a: number, r: { total_price: number }) => a + r.total_price, 0),
        flagged: (stops||[]).filter((s: { sales_rep_id: string; checkin_flagged: boolean }) => s.sales_rep_id === rep.id && s.checkin_flagged).length,
      })).filter((r) => r.revenue > 0 || r.visited > 0).sort((a,b)=>b.revenue-a.revenue))
    }

    if (view === 'products') {
      const { data: recs } = await supabase.from('sales_records').select('product_id, quantity, total_price, outlet_id').gte('sale_date', start).lte('sale_date', end)
      const pData = products.map((p) => {
        const pr = (recs||[]).filter((r: { product_id: string }) => r.product_id === p.id)
        return {
          id: p.id, name: p.name,
          brand:   brands.find((b)=>b.id===p.brand_id)?.name  || '',
          flavor:  flavors.find((f)=>f.id===p.flavor_id)?.name || '',
          units:   pr.reduce((a: number, r: { quantity: number }) => a + r.quantity, 0),
          revenue: pr.reduce((a: number, r: { total_price: number }) => a + r.total_price, 0),
          outlets: new Set(pr.map((r: { outlet_id: string }) => r.outlet_id)).size,
        }
      }).filter((p)=>p.units>0).sort((a,b)=>b.revenue-a.revenue)
      setProductData(pData)
      const bm: Record<string,number> = {}
      pData.forEach((p) => { bm[p.brand] = (bm[p.brand]||0) + p.revenue })
      setBrandRevenue(Object.entries(bm).map(([name,value]) => ({ name, value: Math.round(value as number) })))
    }

    if (view === 'territories') {
      const tData = await Promise.all(territories.map(async (t) => {
        const ids = await getOids(t.id)
        const { data: recs } = ids.length
          ? await supabase.from('sales_records').select('quantity, total_price, outlet_id').in('outlet_id', ids).gte('sale_date', start).lte('sale_date', end)
          : { data: [] }
        const visited = new Set((recs||[]).map((r: { outlet_id: string }) => r.outlet_id)).size
        return {
          id: t.id, name: t.name, outlets: ids.length, visited,
          units:   (recs||[]).reduce((a: number, r: { quantity: number }) => a + r.quantity, 0),
          revenue: (recs||[]).reduce((a: number, r: { total_price: number }) => a + r.total_price, 0),
        }
      }))
      setTerrData(tData.sort((a,b)=>b.revenue-a.revenue))
    }

    setLoading(false)
  }

  const loadPlans = async () => {
    const { data } = await supabase
      .from('route_plans')
      .select('id, route_name, generated_at, n_days, territories(name)')
      .eq('status', 'saved')
      .order('generated_at', { ascending: false })
      .limit(30)
    setCompletionPlans((data||[]).map((p: {
      id: string; route_name: string|null; generated_at: string; n_days: number
      territories: { name: string }|null
    }) => ({
      id: p.id, route_name: p.route_name, generated_at: p.generated_at,
      n_days: p.n_days, territory: p.territories?.name || '—',
    })))
  }

  const loadPlanDays = async () => {
    const { data } = await supabase.from('route_stops').select('day_number').eq('route_plan_id', selPlanId)
    const unique = [...new Set((data||[]).map((r: { day_number: number }) => r.day_number))].sort((a,b)=>a-b)
    setPlanDays(unique)
    if (unique.length > 0) setSelDay(unique[0])
  }

  const searchOutlets = async (q: string) => {
    if (q.length < 2) { setOutletResults([]); return }
    const { data } = await supabase.from('outlets').select('id, outlet_name, land_mark')
      .ilike('outlet_name', `%${q}%`).eq('status', 'active').limit(10)
    setOutletResults(data || [])
  }

  const fmt    = (n: number) => `ETB ${n.toLocaleString('en', { minimumFractionDigits: 0 })}`
  const fmtFull = (n: number) => `ETB ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const leftViews = [
    { key: 'overview',       label: 'Overview'           },
    { key: 'scorecard',      label: 'Rep Scorecard'      },
    { key: 'reps',           label: 'By Rep'             },
    { key: 'products',       label: 'By Product'         },
    { key: 'territories',    label: 'By Territory'       },
    { key: 'completion',     label: 'Completion Reports' },
    { key: 'outlet-history', label: 'Outlet History'     },
    { key: 'proximity',      label: 'Proximity Audit'    },
  ]

  const showFilters = ['overview','reps','products','territories','proximity'].includes(view)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left nav */}
      <div className="w-52 bg-white border-r border-slate-200 p-3 space-y-0.5 overflow-y-auto shrink-0">
        {leftViews.map((v) => (
          <button key={v.key} onClick={() => setView(v.key as MainView)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              view === v.key ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Filters */}
        {showFilters && (
          <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-slate-200 shrink-0">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="last_month">Last Month</option>
            </select>
            <select value={filterTerrId} onChange={(e) => setFilterTerrId(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All Territories</option>
              {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {loading && <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">

          {/* Rep Scorecard */}
          {view === 'scorecard' && (
            <RepScorecard darkMode={false} />
          )}

          {/* Completion Report */}
          {view === 'completion' && (
            <div className="space-y-4 max-w-3xl">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="font-semibold text-slate-900 mb-4">Select Route to View</h2>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Route Plan</label>
                    <select value={selPlanId} onChange={(e) => setSelPlanId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select plan…</option>
                      {completionPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.route_name || 'Unnamed'} — {p.territory} — {new Date(p.generated_at).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Day</label>
                    <select value={selDay} onChange={(e) => setSelDay(parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={!selPlanId}>
                      {planDays.map((d) => <option key={d} value={d}>Day {d}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              {selPlanId && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden" style={{ height: '600px' }}>
                  <RouteCompletionReport
                    routePlanId={selPlanId}
                    dayNumber={selDay}
                    darkMode={false}
                  />
                </div>
              )}
            </div>
          )}

          {/* Outlet History */}
          {view === 'outlet-history' && (
            <div className="space-y-4 max-w-3xl">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="font-semibold text-slate-900 mb-3">Search Outlet</h2>
                <div className="relative">
                  <input
                    value={outletSearch}
                    onChange={(e) => { setOutletSearch(e.target.value); searchOutlets(e.target.value) }}
                    placeholder="Type outlet name…"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {outletResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 mt-1 overflow-hidden">
                      {outletResults.map((o) => (
                        <button key={o.id} onClick={() => {
                          setSelOutletId(o.id); setSelOutletName(o.outlet_name)
                          setOutletSearch(o.outlet_name); setOutletResults([])
                        }} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm border-b border-slate-100 last:border-0">
                          <p className="font-medium text-slate-900">{o.outlet_name}</p>
                          {o.land_mark && <p className="text-xs text-slate-500">📍 {o.land_mark}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {selOutletId && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden" style={{ height: '600px' }}>
                  <OutletVisitHistory outletId={selOutletId} outletName={selOutletName} darkMode={false} />
                </div>
              )}
            </div>
          )}

          {/* Overview */}
          {view === 'overview' && overview && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Revenue',  value: fmt(overview.totalRevenue),  color: 'text-blue-600'   },
                  { label: 'Units Sold',     value: overview.totalUnits.toLocaleString(), color: 'text-green-600' },
                  { label: 'Outlets Visited',value: `${overview.outletsVisited}/${overview.totalOutlets}`, color: 'text-amber-600' },
                  { label: 'Visit Rate',     value: overview.totalOutlets ? `${Math.round(overview.outletsVisited/overview.totalOutlets*100)}%` : '0%', color: 'text-purple-600' },
                ].map((c) => (
                  <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-5">
                    <p className="text-xs text-slate-500 mb-1">{c.label}</p>
                    <p className={`text-2xl font-semibold ${c.color}`}>{c.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue Over Time</h3>
                {overview.dailyRevenue.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={overview.dailyRevenue}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                      <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-slate-400 text-center py-8">No revenue data</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { title: 'Top 5 Products', data: overview.topProducts, color: '#3b82f6' },
                  { title: 'Top 5 Outlets',  data: overview.topOutlets,  color: '#10b981' },
                ].map((c) => (
                  <div key={c.title} className="bg-white rounded-xl border border-slate-200 p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">{c.title}</h3>
                    {c.data.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={c.data} layout="vertical">
                          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                          <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                          <Bar dataKey="revenue" fill={c.color} radius={[0,4,4,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <p className="text-sm text-slate-400 text-center py-8">No data</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By Rep */}
          {view === 'reps' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{['Sales Rep','Outlets Visited','Units Sold','Revenue','Avg/Outlet','Flagged'].map((h) =>
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {repData.map((r, i) => (
                    <tr key={r.id} className={`hover:bg-slate-50 ${i===0 ? 'bg-green-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{i===0&&'🏆 '}{r.name}</td>
                      <td className="px-4 py-3 text-slate-700">{r.visited}</td>
                      <td className="px-4 py-3 text-slate-700">{r.units}</td>
                      <td className="px-4 py-3 font-medium">{fmt(r.revenue)}</td>
                      <td className="px-4 py-3 text-slate-700">{r.visited ? fmt(r.revenue/r.visited) : '—'}</td>
                      <td className="px-4 py-3">
                        {r.flagged > 0
                          ? <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">{r.flagged}</span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                  {!repData.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No data</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* By Product */}
          {view === 'products' && (
            <div className="space-y-4">
              {productData.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue by Brand</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={brandRevenue} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                          label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}>
                          {brandRevenue.map((_, i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-5">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4">Top Products — Units</h3>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={productData.slice(0,8)} layout="vertical">
                        <XAxis type="number" tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={120} />
                        <Tooltip />
                        <Bar dataKey="units" fill="#8b5cf6" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>{['Product','Brand','Flavor','Units','Revenue','Outlets'].map((h) =>
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {productData.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                        <td className="px-4 py-3 text-slate-600">{p.brand}</td>
                        <td className="px-4 py-3 text-slate-600">{p.flavor}</td>
                        <td className="px-4 py-3 text-slate-700">{p.units}</td>
                        <td className="px-4 py-3 font-medium">{fmtFull(p.revenue)}</td>
                        <td className="px-4 py-3 text-slate-700">{p.outlets}</td>
                      </tr>
                    ))}
                    {!productData.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No data</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* By Territory */}
          {view === 'territories' && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{['Territory','Outlets','Visited','Visit Rate','Units','Revenue'].map((h) =>
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {terrData.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                      <td className="px-4 py-3 text-slate-600">{t.outlets}</td>
                      <td className="px-4 py-3 text-slate-600">{t.visited}</td>
                      <td className="px-4 py-3 text-slate-600">{t.outlets ? `${Math.round(t.visited/t.outlets*100)}%` : '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{t.units}</td>
                      <td className="px-4 py-3 font-medium">{fmt(t.revenue)}</td>
                    </tr>
                  ))}
                  {!terrData.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No data</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* Proximity Audit */}
          {view === 'proximity' && <ProximityAudit />}
        </div>
      </div>
    </div>
  )
}

function ProximityAudit() {
  const [data, setData]       = useState<{rep:string;territory:string;outlet:string;distance:number|null;flagged:boolean;flag_reason:string|null;visited_at:string|null}[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data: stops } = await supabase.from('route_stops')
      .select(`outlets(outlet_name), sales_representatives(name), route_plans(territories(name)), checkin_distance_m, checkin_within_radius, checkin_flagged, flag_reason, visited_at`)
      .or('checkin_within_radius.eq.false,checkin_flagged.eq.true')
      .not('visited_at', 'is', null)
      .order('visited_at', { ascending: false }).limit(100)
    setData((stops||[]).map((s: {
      outlets:{outlet_name:string}|null; sales_representatives:{name:string}|null
      route_plans:{territories:{name:string}|null}|null
      checkin_distance_m:number|null; checkin_flagged:boolean; flag_reason:string|null; visited_at:string|null
    }) => ({
      rep:       s.sales_representatives?.name || 'Unknown',
      territory: s.route_plans?.territories?.name || 'Unknown',
      outlet:    s.outlets?.outlet_name || 'Unknown',
      distance:  s.checkin_distance_m,
      flagged:   s.checkin_flagged,
      flag_reason: s.flag_reason,
      visited_at:  s.visited_at,
    })))
    setLoading(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-400">Loading…</div>

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200">
        <p className="text-sm text-slate-600">Visits where rep was outside radius or flagged an issue.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>{['Rep','Territory','Outlet','Distance','Flagged','Reason','Time'].map((h) =>
            <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((p, i) => (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-medium text-slate-900">{p.rep}</td>
              <td className="px-4 py-3 text-slate-600">{p.territory}</td>
              <td className="px-4 py-3 text-slate-700">{p.outlet}</td>
              <td className="px-4 py-3 text-slate-600">{p.distance ? `${p.distance}m` : '—'}</td>
              <td className="px-4 py-3">
                {p.flagged ? <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">Yes</span>
                           : <span className="text-slate-400">No</span>}
              </td>
              <td className="px-4 py-3 text-slate-600 text-xs">{p.flag_reason || '—'}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">
                {p.visited_at ? new Date(p.visited_at).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
          {!data.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No proximity issues recorded</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
