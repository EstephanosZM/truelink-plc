import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  outletId:  string
  outletName?: string
  darkMode?: boolean
  onClose?:  () => void
}

interface VisitRecord {
  visit_date:   string
  visit_status: string
  rep_name:     string
  products:     { name: string; qty: number; total: number }[]
  total:        number
  reason?:      string
  distance_m?:  number | null
}

export default function OutletVisitHistory({ outletId, outletName, darkMode = false, onClose }: Props) {
  const [visits,  setVisits]  = useState<VisitRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState({ visits: 0, sold: 0, revenue: 0, avgSale: 0 })

  useEffect(() => { load() }, [outletId])

  const load = async () => {
    setLoading(true)

    const { data: visits } = await supabase
      .from('outlet_visits')
      .select(`
        visit_date, visit_status, checkin_distance_m,
        non_sale_reasons(reason),
        sales_representatives(name)
      `)
      .eq('outlet_id', outletId)
      .order('visit_date', { ascending: false })
      .limit(30)

    const { data: sales } = await supabase
      .from('sales_records')
      .select('outlet_id, quantity, total_price, sale_date, products(name)')
      .eq('outlet_id', outletId)
      .order('sale_date', { ascending: false })

    if (!visits) { setLoading(false); return }

    const built: VisitRecord[] = visits.map((v: {
      visit_date: string; visit_status: string; checkin_distance_m: number | null
      non_sale_reasons?: { reason: string } | null
      sales_representatives?: { name: string } | null
    }) => {
      const daySales = (sales || []).filter((s: { sale_date: string }) => s.sale_date === v.visit_date) as {
        quantity: number; total_price: number; products: { name: string }
      }[]
      const products = daySales.map((s) => ({
        name:  s.products?.name || 'Unknown',
        qty:   s.quantity,
        total: s.total_price,
      }))
      return {
        visit_date:   v.visit_date,
        visit_status: v.visit_status,
        rep_name:     v.sales_representatives?.name || '—',
        products,
        total:        products.reduce((a, p) => a + p.total, 0),
        reason:       v.non_sale_reasons?.reason,
        distance_m:   v.checkin_distance_m,
      }
    })

    setVisits(built)

    const totalVisits = built.length
    const soldVisits  = built.filter((v) => v.visit_status === 'sold').length
    const revenue     = built.reduce((a, v) => a + v.total, 0)
    setSummary({
      visits:   totalVisits,
      sold:     soldVisits,
      revenue,
      avgSale:  soldVisits > 0 ? revenue / soldVisits : 0,
    })
    setLoading(false)
  }

  const fmtETB = (n: number) => `ETB ${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const bg   = darkMode ? 'bg-slate-900'   : 'bg-white'
  const card = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'
  const text = darkMode ? 'text-white'     : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'
  const div  = darkMode ? 'divide-slate-700' : 'divide-slate-200'

  const statusIcon = (s: string) => {
    if (s === 'sold')        return '✅'
    if (s === 'no_sale')     return '🟡'
    if (s === 'closed')      return '⚫'
    return '🔴'
  }

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${bg}`}>
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full overflow-hidden ${bg}`}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-700/30 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`${text} font-bold text-lg`}>{outletName || 'Outlet'}</h2>
            <p className={`${sub} text-xs`}>Visit History — last 30 visits</p>
          </div>
          {onClose && <button onClick={onClose} className={`${sub} text-2xl`}>×</button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Total Visits', value: summary.visits,              color: text         },
            { label: 'Sold Visits',  value: summary.sold,                color: 'text-green-400' },
            { label: 'Total Revenue',value: fmtETB(summary.revenue),     color: 'text-green-400' },
            { label: 'Avg per Sale', value: fmtETB(summary.avgSale),     color: 'text-blue-400'  },
          ].map((s) => (
            <div key={s.label} className={`${card} border rounded-xl p-3`}>
              <p className={`${sub} text-xs mb-0.5`}>{s.label}</p>
              <p className={`${s.color} font-bold text-lg leading-tight`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Visit list */}
        {visits.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">📭</p>
            <p className={`${sub} text-sm`}>No visit history yet</p>
          </div>
        ) : (
          <div className={`${card} border rounded-xl overflow-hidden divide-y ${div}`}>
            {visits.map((v, i) => (
              <div key={i} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{statusIcon(v.visit_status)}</span>
                    <span className={`${text} font-medium text-sm`}>{fmtDate(v.visit_date)}</span>
                  </div>
                  {v.total > 0 && (
                    <span className="text-green-400 font-semibold text-sm">{fmtETB(v.total)}</span>
                  )}
                </div>
                <p className={`${sub} text-xs mb-2`}>
                  Rep: {v.rep_name}
                  {v.distance_m ? ` · ${v.distance_m}m away` : ''}
                </p>
                {v.products.length > 0 && (
                  <div className="space-y-0.5 ml-6">
                    {v.products.map((p, j) => (
                      <div key={j} className="flex justify-between text-xs">
                        <span className={sub}>{p.name} × {p.qty}</span>
                        <span className={text}>{fmtETB(p.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {v.visit_status === 'no_sale' && v.reason && (
                  <p className={`text-xs ${sub} ml-6 mt-1`}>Reason: {v.reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
