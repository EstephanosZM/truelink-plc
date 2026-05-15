import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  routePlanId: string
  dayNumber:   number
  repName?:    string
  darkMode?:   boolean
  onClose?:    () => void
}

interface StopSummary {
  sequence:     number
  outlet_name:  string
  land_mark:    string | null
  visit_status: string
  products:     { name: string; qty: number; total: number }[]
  total:        number
  reason?:      string
}

export default function RouteCompletionReport({
  routePlanId, dayNumber, repName, darkMode = false, onClose,
}: Props) {
  const [stops,    setStops]    = useState<StopSummary[]>([])
  const [loading,  setLoading]  = useState(true)
  const [summary,  setSummary]  = useState({
    assigned: 0, visited: 0, sold: 0, noSale: 0, notVisited: 0,
    totalRevenue: 0, totalUnits: 0,
  })

  useEffect(() => { load() }, [routePlanId, dayNumber])

  const load = async () => {
    setLoading(true)

    const { data: routeStops } = await supabase
      .from('route_stops')
      .select('outlet_id, sequence, outlets(outlet_name, land_mark)')
      .eq('route_plan_id', routePlanId)
      .eq('day_number', dayNumber)
      .order('sequence')

    const { data: visits } = await supabase
      .from('outlet_visits')
      .select('outlet_id, visit_status, non_sale_reason_id, non_sale_reasons(reason)')
      .eq('route_plan_id', routePlanId)
      .eq('day_number', dayNumber)

    const { data: sales } = await supabase
      .from('sales_records')
      .select('outlet_id, product_id, quantity, total_price, products(name)')
      .eq('route_plan_id', routePlanId)
      .eq('day_number', dayNumber)

    if (!routeStops) { setLoading(false); return }

    const built: StopSummary[] = routeStops.map((rs: {
      outlet_id: string; sequence: number
      outlets: { outlet_name: string; land_mark: string | null }
    }) => {
      const visit    = (visits || []).find((v: { outlet_id: string }) => v.outlet_id === rs.outlet_id) as {
        visit_status: string; non_sale_reasons?: { reason: string } | null
      } | undefined
      const outSales = (sales || []).filter((s: { outlet_id: string }) => s.outlet_id === rs.outlet_id) as {
        product_id: string; quantity: number; total_price: number
        products: { name: string }
      }[]
      const products = outSales.map((s) => ({
        name: s.products?.name || 'Unknown',
        qty:  s.quantity,
        total: s.total_price,
      }))
      const total = products.reduce((a, p) => a + p.total, 0)

      return {
        sequence:    rs.sequence,
        outlet_name: rs.outlets?.outlet_name || '—',
        land_mark:   rs.outlets?.land_mark   || null,
        visit_status: visit?.visit_status    || 'not_visited',
        products,
        total,
        reason: visit?.non_sale_reasons?.reason,
      }
    })

    setStops(built)

    const assigned    = built.length
    const visited     = built.filter((s) => s.visit_status !== 'not_visited').length
    const sold        = built.filter((s) => s.visit_status === 'sold').length
    const noSale      = built.filter((s) => s.visit_status === 'no_sale').length
    const notVisited  = built.filter((s) => s.visit_status === 'not_visited').length
    const totalRevenue = built.reduce((a, s) => a + s.total, 0)
    const totalUnits   = (sales || []).reduce((a: number, s: { quantity: number }) => a + s.quantity, 0)
    setSummary({ assigned, visited, sold, noSale, notVisited, totalRevenue, totalUnits })
    setLoading(false)
  }

  const fmtETB = (n: number) => `ETB ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const bg   = darkMode ? 'bg-slate-900'   : 'bg-white'
  const card = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'
  const text = darkMode ? 'text-white'     : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'
  const div  = darkMode ? 'divide-slate-700' : 'divide-slate-200'

  const statusBadge = (status: string) => {
    if (status === 'sold')        return <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-400 rounded-full font-medium">✅ Sold</span>
    if (status === 'no_sale')     return <span className="text-xs px-2 py-0.5 bg-amber-900/50 text-amber-400 rounded-full font-medium">🟡 No sale</span>
    if (status === 'closed')      return <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-400 rounded-full font-medium">⚫ Closed</span>
    return <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-400 rounded-full font-medium">🔴 Not visited</span>
  }

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${bg}`}>
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className={`${sub} text-sm`}>Loading report…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full overflow-hidden ${bg}`}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className={`${text} font-bold text-lg`}>Route Completion Report</h2>
            <p className={`${sub} text-xs`}>
              Day {dayNumber}{repName ? ` · ${repName}` : ''} · {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className={`${sub} text-2xl`}>×</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Assigned',    value: summary.assigned,    color: text         },
            { label: 'Visited',     value: summary.visited,     color: 'text-blue-400'  },
            { label: 'Sold',        value: summary.sold,        color: 'text-green-400' },
            { label: 'No Sale',     value: summary.noSale,      color: 'text-amber-400' },
            { label: 'Not Visited', value: summary.notVisited,  color: 'text-red-400'   },
            { label: 'Visit Rate',  value: `${summary.assigned ? Math.round(summary.visited/summary.assigned*100) : 0}%`, color: 'text-blue-400' },
          ].map((s) => (
            <div key={s.label} className={`${card} border rounded-xl p-3`}>
              <p className={`${sub} text-xs mb-0.5`}>{s.label}</p>
              <p className={`${s.color} font-bold text-xl`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Revenue + units */}
        <div className={`${card} border rounded-xl p-4 flex items-center justify-between`}>
          <div>
            <p className={`${sub} text-xs mb-0.5`}>Total Revenue</p>
            <p className="text-green-400 font-bold text-2xl">{fmtETB(summary.totalRevenue)}</p>
          </div>
          <div className="text-right">
            <p className={`${sub} text-xs mb-0.5`}>Units Sold</p>
            <p className={`${text} font-bold text-xl`}>{summary.totalUnits}</p>
          </div>
        </div>

        {/* Stop by stop */}
        <div>
          <p className={`${sub} text-xs font-semibold uppercase tracking-wide mb-2`}>Stop Details</p>
          <div className={`${card} border rounded-xl overflow-hidden divide-y ${div}`}>
            {stops.map((stop) => (
              <div key={stop.sequence} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
                      stop.visit_status === 'sold'    ? 'bg-green-600' :
                      stop.visit_status === 'no_sale' ? 'bg-amber-600' :
                      stop.visit_status === 'closed'  ? 'bg-slate-600' : 'bg-red-600'
                    }`}>{stop.sequence}</span>
                    <div className="min-w-0">
                      <p className={`${text} font-medium text-sm truncate`}>{stop.outlet_name}</p>
                      {stop.land_mark && <p className={`${sub} text-xs truncate`}>📍 {stop.land_mark}</p>}
                    </div>
                  </div>
                  {statusBadge(stop.visit_status)}
                </div>
                {stop.visit_status === 'sold' && stop.products.length > 0 && (
                  <div className={`ml-8 space-y-1`}>
                    {stop.products.map((p, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className={sub}>{p.name} × {p.qty}</span>
                        <span className={text}>{fmtETB(p.total)}</span>
                      </div>
                    ))}
                    <div className={`flex justify-between text-xs font-semibold pt-1 border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
                      <span className={sub}>Total</span>
                      <span className="text-green-400">{fmtETB(stop.total)}</span>
                    </div>
                  </div>
                )}
                {stop.visit_status === 'no_sale' && stop.reason && (
                  <p className={`ml-8 text-xs ${sub}`}>Reason: {stop.reason}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
