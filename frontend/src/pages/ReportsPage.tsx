import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16']

interface OverviewData {
  totalRevenue: number; totalUnits: number
  outletsVisited: number; totalOutlets: number
  dailyRevenue: { date: string; revenue: number }[]
  topProducts: { name: string; revenue: number }[]
  topOutlets: { name: string; revenue: number }[]
}

interface RepData {
  id: string; name: string
  visited: number; units: number; revenue: number; flagged: number
}

interface ProductData {
  id: string; name: string; brand: string; flavor: string
  units: number; revenue: number; outlets: number
}

interface TerritoryData {
  id: string; name: string
  outlets: number; visited: number; units: number; revenue: number
}

interface BrandRevenue { name: string; value: number }

export default function ReportsPage() {
  const { territories, salesReps, brands, flavors, products } = useStore()

  const [view,          setView]          = useState<'overview'|'reps'|'products'|'territories'|'proximity'>('overview')
  const [period,        setPeriod]        = useState('month')
  const [filterTerrId,  setFilterTerrId]  = useState('')
  const [overview,      setOverview]      = useState<OverviewData | null>(null)
  const [repData,       setRepData]       = useState<RepData[]>([])
  const [productData,   setProductData]   = useState<ProductData[]>([])
  const [brandRevenue,  setBrandRevenue]  = useState<BrandRevenue[]>([])
  const [territoryData, setTerritoryData] = useState<TerritoryData[]>([])
  const [proxData,      setProxData]      = useState<{rep:string;territory:string;outlet:string;distance:number|null;flagged:boolean;flag_reason:string|null;visited_at:string|null}[]>([])
  const [loading,       setLoading]       = useState(false)

  const getDateRange = () => {
    const now = new Date()
    const end = now.toISOString().split('T')[0]
    if (period === 'today')  return { start: end, end }
    if (period === 'week')   { const d = new Date(now); d.setDate(d.getDate()-7);   return { start: d.toISOString().split('T')[0], end } }
    if (period === 'month')  { const d = new Date(now); d.setMonth(d.getMonth()-1); return { start: d.toISOString().split('T')[0], end } }
    if (period === 'last_month') {
      const s = new Date(now.getFullYear(), now.getMonth()-1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: s.toISOString().split('T')[0], end: e.toISOString().split('T')[0] }
    }
    return { start: end, end }
  }

  useEffect(() => { loadData() }, [view, period, filterTerrId])

  const getOutletIdsForTerritory = async (terrId: string) => {
    const { data } = await supabase.from('outlets').select('id').eq('territory_id', terrId)
    return (data || []).map((o: {id:string}) => o.id)
  }

  const loadData = async () => {
    setLoading(true)
    const { start, end } = getDateRange()

    // ── Overview ──────────────────────────────────────────────
    if (view === 'overview') {
      let q = supabase.from('sales_records')
        .select('quantity, total_price, outlet_id, product_id, sale_date')
        .gte('sale_date', start).lte('sale_date', end)

      if (filterTerrId) {
        const ids = await getOutletIdsForTerritory(filterTerrId)
        q = q.in('outlet_id', ids)
      }
      const { data: recs } = await q
      const rows = recs || []

      const totalRevenue    = rows.reduce((a: number, r: {total_price:number}) => a + r.total_price, 0)
      const totalUnits      = rows.reduce((a: number, r: {quantity:number}) => a + r.quantity, 0)
      const visitedOutlets  = new Set(rows.map((r: {outlet_id:string}) => r.outlet_id)).size
      const { count: tc }   = await supabase.from('outlets').select('id', { count:'exact', head:true })

      // Daily revenue
      const byDate: Record<string, number> = {}
      rows.forEach((r: {sale_date:string; total_price:number}) => {
        byDate[r.sale_date] = (byDate[r.sale_date] || 0) + r.total_price
      })
      const dailyRevenue = Object.entries(byDate)
        .sort((a,b) => a[0].localeCompare(b[0]))
        .map(([date, revenue]) => ({ date: date.slice(5), revenue: Math.round(revenue) }))

      // Top 5 products
      const byProduct: Record<string, number> = {}
      rows.forEach((r: {product_id:string; total_price:number}) => {
        byProduct[r.product_id] = (byProduct[r.product_id] || 0) + r.total_price
      })
      const topProducts = Object.entries(byProduct)
        .sort((a,b) => b[1]-a[1]).slice(0,5)
        .map(([id, revenue]) => ({
          name: products.find((p) => p.id === id)?.name?.slice(0,20) || 'Unknown',
          revenue: Math.round(revenue),
        }))

      // Top 5 outlets
      const byOutlet: Record<string, number> = {}
      rows.forEach((r: {outlet_id:string; total_price:number}) => {
        byOutlet[r.outlet_id] = (byOutlet[r.outlet_id] || 0) + r.total_price
      })
      const { data: outletNames } = await supabase.from('outlets').select('id, outlet_name')
        .in('id', Object.keys(byOutlet).slice(0,10))
      const nameMap: Record<string,string> = {}
      ;(outletNames||[]).forEach((o: {id:string;outlet_name:string}) => { nameMap[o.id] = o.outlet_name })
      const topOutlets = Object.entries(byOutlet)
        .sort((a,b) => b[1]-a[1]).slice(0,5)
        .map(([id, revenue]) => ({ name: (nameMap[id]||'Unknown').slice(0,20), revenue: Math.round(revenue) }))

      setOverview({ totalRevenue, totalUnits, outletsVisited: visitedOutlets,
                    totalOutlets: tc||0, dailyRevenue, topProducts, topOutlets })
    }

    // ── By Rep ────────────────────────────────────────────────
    if (view === 'reps') {
      const { data: recs }  = await supabase.from('sales_records')
        .select('sales_rep_id, quantity, total_price').gte('sale_date', start).lte('sale_date', end)
      const { data: stops } = await supabase.from('route_stops')
        .select('sales_rep_id, visited, checkin_flagged').eq('visited', true)

      const result: RepData[] = salesReps.map((rep) => {
        const repRecs  = (recs||[]).filter((r: {sales_rep_id:string}) => r.sales_rep_id === rep.id)
        const repStops = (stops||[]).filter((s: {sales_rep_id:string}) => s.sales_rep_id === rep.id)
        return {
          id: rep.id, name: rep.name,
          visited: repStops.length,
          units:   repRecs.reduce((a: number, r: {quantity:number}) => a + r.quantity, 0),
          revenue: repRecs.reduce((a: number, r: {total_price:number}) => a + r.total_price, 0),
          flagged: repStops.filter((s: {checkin_flagged:boolean}) => s.checkin_flagged).length,
        }
      })
      setRepData(result.filter((r) => r.revenue > 0 || r.visited > 0).sort((a,b) => b.revenue - a.revenue))
    }

    // ── By Product ────────────────────────────────────────────
    if (view === 'products') {
      const { data: recs } = await supabase.from('sales_records')
        .select('product_id, quantity, total_price, outlet_id').gte('sale_date', start).lte('sale_date', end)

      const result: ProductData[] = products.map((p) => {
        const pRecs = (recs||[]).filter((r: {product_id:string}) => r.product_id === p.id)
        return {
          id: p.id, name: p.name,
          brand:   brands.find((b) => b.id === p.brand_id)?.name  || '',
          flavor:  flavors.find((f) => f.id === p.flavor_id)?.name || '',
          units:   pRecs.reduce((a: number, r: {quantity:number}) => a + r.quantity, 0),
          revenue: pRecs.reduce((a: number, r: {total_price:number}) => a + r.total_price, 0),
          outlets: new Set(pRecs.map((r: {outlet_id:string}) => r.outlet_id)).size,
        }
      })
      const filtered = result.filter((p) => p.units > 0).sort((a,b) => b.revenue - a.revenue)
      setProductData(filtered)

      // Brand revenue for pie chart
      const brandMap: Record<string,number> = {}
      filtered.forEach((p) => { brandMap[p.brand] = (brandMap[p.brand]||0) + p.revenue })
      setBrandRevenue(Object.entries(brandMap).map(([name, value]) => ({ name, value: Math.round(value) })))
    }

    // ── By Territory ──────────────────────────────────────────
    if (view === 'territories') {
      const result: TerritoryData[] = await Promise.all(territories.map(async (t) => {
        const ids = await getOutletIdsForTerritory(t.id)
        const { data: recs } = ids.length
          ? await supabase.from('sales_records').select('quantity, total_price, outlet_id')
              .in('outlet_id', ids).gte('sale_date', start).lte('sale_date', end)
          : { data: [] }
        const visited = new Set((recs||[]).map((r: {outlet_id:string}) => r.outlet_id)).size
        return {
          id: t.id, name: t.name, outlets: ids.length, visited,
          units:   (recs||[]).reduce((a: number, r: {quantity:number}) => a + r.quantity, 0),
          revenue: (recs||[]).reduce((a: number, r: {total_price:number}) => a + r.total_price, 0),
        }
      }))
      setTerritoryData(result.sort((a,b) => b.revenue - a.revenue))
    }

    // ── Proximity Audit ───────────────────────────────────────
    if (view === 'proximity') {
      const { data: stops } = await supabase.from('route_stops')
        .select(`
          outlets(outlet_name),
          sales_representatives(name),
          route_plans(territories(name)),
          checkin_distance_m, checkin_within_radius,
          checkin_flagged, flag_reason, visited_at
        `)
        .or('checkin_within_radius.eq.false,checkin_flagged.eq.true')
        .not('visited_at', 'is', null)
        .order('visited_at', { ascending: false })
        .limit(100)

      setProxData((stops||[]).map((s: {
        outlets:{outlet_name:string}|null;
        sales_representatives:{name:string}|null;
        route_plans:{territories:{name:string}|null}|null;
        checkin_distance_m:number|null;
        checkin_flagged:boolean;
        flag_reason:string|null;
        visited_at:string|null
      }) => ({
        rep:       s.sales_representatives?.name   || 'Unknown',
        territory: s.route_plans?.territories?.name || 'Unknown',
        outlet:    s.outlets?.outlet_name           || 'Unknown',
        distance:  s.checkin_distance_m,
        flagged:   s.checkin_flagged,
        flag_reason: s.flag_reason,
        visited_at:  s.visited_at,
      })))
    }

    setLoading(false)
  }

  const fmt    = (n: number) => `ETB ${n.toLocaleString('en', { minimumFractionDigits:0, maximumFractionDigits:0 })}`
  const fmtFull = (n: number) => `ETB ${n.toLocaleString('en', { minimumFractionDigits:2, maximumFractionDigits:2 })}`

  const views = [
    { key:'overview',    label:'Overview'        },
    { key:'reps',        label:'By Rep'          },
    { key:'products',    label:'By Product'      },
    { key:'territories', label:'By Territory'    },
    { key:'proximity',   label:'Proximity Audit' },
  ]

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left nav */}
      <div className="w-48 bg-white border-r border-slate-200 p-4 space-y-1 shrink-0">
        {views.map((v) => (
          <button key={v.key} onClick={() => setView(v.key as typeof view)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              view === v.key ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6 bg-slate-50">

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
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

        {/* ── Overview ── */}
        {view === 'overview' && overview && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Revenue',     value: fmt(overview.totalRevenue),      color: 'text-blue-600'  },
                { label: 'Units Sold',         value: overview.totalUnits.toLocaleString(), color: 'text-green-600' },
                { label: 'Outlets Visited',    value: `${overview.outletsVisited} / ${overview.totalOutlets}`, color: 'text-amber-600'  },
                { label: 'Visit Rate',         value: overview.totalOutlets ? `${Math.round(overview.outletsVisited/overview.totalOutlets*100)}%` : '0%', color: 'text-purple-600' },
              ].map((c) => (
                <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-5">
                  <p className="text-xs text-slate-500 mb-1">{c.label}</p>
                  <p className={`text-2xl font-semibold ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>

            {/* Daily revenue line chart */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue Over Time</h3>
              {overview.dailyRevenue.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={overview.dailyRevenue}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize:11 }} />
                    <YAxis tick={{ fontSize:11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                    <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-slate-400 text-center py-8">No revenue data for this period</p>
              )}
            </div>

            {/* Top products + outlets */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Top 5 Products by Revenue</h3>
                {overview.topProducts.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={overview.topProducts} layout="vertical">
                      <XAxis type="number" tick={{ fontSize:10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={110} />
                      <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                      <Bar dataKey="revenue" fill="#3b82f6" radius={[0,4,4,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-slate-400 text-center py-8">No data</p>}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Top 5 Outlets by Revenue</h3>
                {overview.topOutlets.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={overview.topOutlets} layout="vertical">
                      <XAxis type="number" tick={{ fontSize:10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize:10 }} width={110} />
                      <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                      <Bar dataKey="revenue" fill="#10b981" radius={[0,4,4,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-slate-400 text-center py-8">No data</p>}
              </div>
            </div>
          </div>
        )}

        {/* ── By Rep ── */}
        {view === 'reps' && (
          <div className="space-y-6">
            {/* Bar chart comparison */}
            {repData.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue by Sales Rep</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={repData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize:11 }} />
                    <YAxis tick={{ fontSize:11 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                    <Bar dataKey="revenue" radius={[4,4,0,0]}>
                      {repData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{['Sales Rep','Outlets Visited','Units Sold','Revenue','Avg/Outlet','Flagged'].map((h) =>
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {repData.map((r, i) => (
                    <tr key={r.id} className={`hover:bg-slate-50 ${i===0 ? 'bg-green-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{i===0 && '🏆 '}{r.name}</td>
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
                  {!repData.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No sales data for this period</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── By Product ── */}
        {view === 'products' && (
          <div className="space-y-6">
            {/* Charts */}
            {productData.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue by Brand</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={brandRevenue} dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) =>
                          `${name} ${(percent*100).toFixed(0)}%`}>
                        {brandRevenue.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Top 10 Products — Units Sold</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={productData.slice(0,10)} layout="vertical">
                      <XAxis type="number" tick={{ fontSize:10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize:9 }} width={120} />
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
                  {!productData.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No sales data for this period</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── By Territory ── */}
        {view === 'territories' && (
          <div className="space-y-6">
            {territoryData.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue by Territory</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={territoryData} dataKey="revenue" nameKey="name"
                        cx="50%" cy="50%" outerRadius={75}
                        label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}>
                        {territoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [fmt(v), 'Revenue']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Visit Rate by Territory</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={territoryData.map((t) => ({
                      name: t.name,
                      rate: t.outlets ? Math.round(t.visited/t.outlets*100) : 0,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize:11 }} />
                      <YAxis tick={{ fontSize:11 }} domain={[0,100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(v: number) => [`${v}%`, 'Visit Rate']} />
                      <Bar dataKey="rate" fill="#f59e0b" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>{['Territory','Outlets','Visited','Visit Rate','Units','Revenue'].map((h) =>
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {territoryData.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                      <td className="px-4 py-3 text-slate-600">{t.outlets}</td>
                      <td className="px-4 py-3 text-slate-600">{t.visited}</td>
                      <td className="px-4 py-3 text-slate-600">{t.outlets ? `${Math.round(t.visited/t.outlets*100)}%` : '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{t.units}</td>
                      <td className="px-4 py-3 font-medium">{fmt(t.revenue)}</td>
                    </tr>
                  ))}
                  {!territoryData.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No data</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Proximity Audit ── */}
        {view === 'proximity' && (
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
                {proxData.map((p, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{p.rep}</td>
                    <td className="px-4 py-3 text-slate-600">{p.territory}</td>
                    <td className="px-4 py-3 text-slate-700">{p.outlet}</td>
                    <td className="px-4 py-3 text-slate-600">{p.distance ? `${p.distance}m` : '—'}</td>
                    <td className="px-4 py-3">
                      {p.flagged
                        ? <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">Yes</span>
                        : <span className="text-slate-400">No</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{p.flag_reason || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {p.visited_at ? new Date(p.visited_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
                {!proxData.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No proximity issues recorded</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
