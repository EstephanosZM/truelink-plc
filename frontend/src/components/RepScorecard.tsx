import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  repId?:   string  // if null, show all reps
  darkMode?: boolean
}

interface RepScore {
  id:            string
  name:          string
  thisMonth:     { revenue: number; visits: number; sold: number; assigned: number }
  lastMonth:     { revenue: number; visits: number; sold: number }
  avgSalePerOutlet: number
  visitRate:     number
  revenueChange: number   // % vs last month
  visitChange:   number
  rating:        'green' | 'amber' | 'red'
}

export default function RepScorecard({ repId, darkMode = false }: Props) {
  const [scores,  setScores]  = useState<RepScore[]>([])
  const [loading, setLoading] = useState(true)
  const [view,    setView]    = useState<'cards' | 'table'>('cards')

  useEffect(() => { load() }, [repId])

  const load = async () => {
    setLoading(true)

    const now   = new Date()
    const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
    const lastEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
    const thisEnd   = now.toISOString().split('T')[0]

    // Load reps
    let repQuery = supabase.from('sales_representatives').select('id, name')
    if (repId) repQuery = repQuery.eq('id', repId)
    const { data: reps } = await repQuery.order('name')
    if (!reps) { setLoading(false); return }

    const built: RepScore[] = await Promise.all(reps.map(async (rep: { id: string; name: string }) => {
      // This month sales
      const { data: thisSales } = await supabase
        .from('sales_records')
        .select('quantity, total_price')
        .eq('sales_rep_id', rep.id)
        .gte('sale_date', thisStart).lte('sale_date', thisEnd)

      // Last month sales
      const { data: lastSales } = await supabase
        .from('sales_records')
        .select('quantity, total_price')
        .eq('sales_rep_id', rep.id)
        .gte('sale_date', lastStart).lte('sale_date', lastEnd)

      // This month visits
      const { data: thisVisits } = await supabase
        .from('outlet_visits')
        .select('visit_status')
        .eq('sales_rep_id', rep.id)
        .gte('visit_date', thisStart).lte('visit_date', thisEnd)

      // Last month visits
      const { data: lastVisits } = await supabase
        .from('outlet_visits')
        .select('visit_status')
        .eq('sales_rep_id', rep.id)
        .gte('visit_date', lastStart).lte('visit_date', lastEnd)

      // Assigned outlets this month
      const { data: assigned } = await supabase
        .from('route_stops')
        .select('id')
        .eq('sales_rep_id', rep.id)
        .gte('route_date', thisStart).lte('route_date', thisEnd)

      const thisRevenue  = (thisSales  || []).reduce((a: number, s: { total_price: number }) => a + s.total_price, 0)
      const lastRevenue  = (lastSales  || []).reduce((a: number, s: { total_price: number }) => a + s.total_price, 0)
      const thisVisCount = (thisVisits || []).filter((v: { visit_status: string }) => v.visit_status !== 'not_visited').length
      const lastVisCount = (lastVisits || []).filter((v: { visit_status: string }) => v.visit_status !== 'not_visited').length
      const soldCount    = (thisVisits || []).filter((v: { visit_status: string }) => v.visit_status === 'sold').length
      const assignedCnt  = (assigned   || []).length

      const revenueChange = lastRevenue  > 0 ? ((thisRevenue  - lastRevenue)  / lastRevenue  * 100) : 0
      const visitChange   = lastVisCount > 0 ? ((thisVisCount - lastVisCount) / lastVisCount * 100) : 0
      const visitRate     = assignedCnt  > 0 ? Math.round(thisVisCount / assignedCnt * 100) : 0
      const avgSale       = soldCount    > 0 ? thisRevenue / soldCount : 0

      const rating: 'green' | 'amber' | 'red' =
        visitRate >= 70 && revenueChange >= 0  ? 'green' :
        visitRate >= 40 || revenueChange >= -10 ? 'amber' : 'red'

      return {
        id: rep.id, name: rep.name,
        thisMonth:  { revenue: thisRevenue, visits: thisVisCount, sold: soldCount, assigned: assignedCnt },
        lastMonth:  { revenue: lastRevenue, visits: lastVisCount, sold: 0 },
        avgSalePerOutlet: avgSale,
        visitRate, revenueChange, visitChange, rating,
      }
    }))

    setScores(built.sort((a, b) => b.thisMonth.revenue - a.thisMonth.revenue))
    setLoading(false)
  }

  const fmtETB = (n: number) => `ETB ${n.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

  const bg   = darkMode ? 'bg-slate-900'   : 'bg-slate-50'
  const card = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
  const text = darkMode ? 'text-white'     : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'

  const ratingBg = {
    green: 'bg-green-900/30 border-green-800',
    amber: 'bg-amber-900/30 border-amber-800',
    red:   'bg-red-900/30 border-red-800',
  }
  const ratingText = { green: 'text-green-400', amber: 'text-amber-400', red: 'text-red-400' }
  const ratingLabel = { green: '🟢 On Track', amber: '🟡 Needs Attention', red: '🔴 Below Target' }

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-12 ${bg}`}>
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className={`${bg} h-full overflow-y-auto`}>
      <div className="p-5 space-y-4">
        {/* Header + toggle */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`${text} font-bold text-lg`}>Rep Scorecard</h2>
            <p className={`${sub} text-xs`}>This month vs last month</p>
          </div>
          <div className="flex bg-slate-800 rounded-lg p-0.5 gap-0.5">
            {(['cards','table'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === v ? 'bg-blue-600 text-white' : `${sub} hover:text-slate-300`
                }`}>
                {v === 'cards' ? '⊞ Cards' : '☰ Table'}
              </button>
            ))}
          </div>
        </div>

        {/* Cards view */}
        {view === 'cards' && scores.map((rep, i) => (
          <div key={rep.id} className={`${card} border rounded-2xl overflow-hidden`}>
            {/* Rep header */}
            <div className={`px-4 py-3 flex items-center justify-between border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                  i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-slate-500' : 'bg-blue-600'
                }`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : rep.name[0].toUpperCase()}
                </div>
                <div>
                  <p className={`${text} font-semibold`}>{rep.name}</p>
                  <p className={`text-xs ${ratingText[rep.rating]}`}>{ratingLabel[rep.rating]}</p>
                </div>
              </div>
              <div className={`px-2 py-1 rounded-lg border text-xs font-medium ${ratingBg[rep.rating]} ${ratingText[rep.rating]}`}>
                {rep.visitRate}% visits
              </div>
            </div>

            {/* Stats grid */}
            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <p className={`${sub} text-xs`}>Revenue This Month</p>
                <p className="text-green-400 font-bold text-lg">{fmtETB(rep.thisMonth.revenue)}</p>
                <p className={`text-xs ${rep.revenueChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmtPct(rep.revenueChange)} vs last month
                </p>
              </div>
              <div>
                <p className={`${sub} text-xs`}>Outlets Visited</p>
                <p className={`${text} font-bold text-lg`}>{rep.thisMonth.visits} / {rep.thisMonth.assigned}</p>
                <p className={`text-xs ${rep.visitChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {fmtPct(rep.visitChange)} vs last month
                </p>
              </div>
              <div>
                <p className={`${sub} text-xs`}>Sold</p>
                <p className={`${text} font-bold`}>{rep.thisMonth.sold} outlets</p>
              </div>
              <div>
                <p className={`${sub} text-xs`}>Avg per Sale</p>
                <p className={`${text} font-bold`}>{fmtETB(rep.avgSalePerOutlet)}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="px-4 pb-4">
              <div className="flex justify-between text-xs mb-1">
                <span className={sub}>Visit Progress</span>
                <span className={text}>{rep.visitRate}%</span>
              </div>
              <div className={`w-full ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} rounded-full h-2`}>
                <div className={`h-2 rounded-full transition-all ${
                  rep.rating === 'green' ? 'bg-green-500' :
                  rep.rating === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                }`} style={{ width: `${rep.visitRate}%` }} />
              </div>
            </div>
          </div>
        ))}

        {/* Table view */}
        {view === 'table' && (
          <div className={`${card} border rounded-xl overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={`border-b ${darkMode ? 'border-slate-700 bg-slate-700/50' : 'border-slate-200 bg-slate-50'}`}>
                  <tr>
                    {['Rep','Revenue','vs Last','Visits','Visit Rate','Avg/Sale','Rating'].map((h) => (
                      <th key={h} className={`text-left px-4 py-3 text-xs font-semibold ${sub} whitespace-nowrap`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className={`divide-y ${darkMode ? 'divide-slate-700' : 'divide-slate-200'}`}>
                  {scores.map((rep, i) => (
                    <tr key={rep.id} className={darkMode ? 'hover:bg-slate-700/30' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}</span>
                          <span className={`${text} font-medium`}>{rep.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-green-400 font-medium">{fmtETB(rep.thisMonth.revenue)}</td>
                      <td className={`px-4 py-3 text-xs font-medium ${rep.revenueChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {fmtPct(rep.revenueChange)}
                      </td>
                      <td className={`px-4 py-3 ${text}`}>{rep.thisMonth.visits}/{rep.thisMonth.assigned}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          rep.rating === 'green' ? 'bg-green-900/50 text-green-400' :
                          rep.rating === 'amber' ? 'bg-amber-900/50 text-amber-400' :
                          'bg-red-900/50 text-red-400'
                        }`}>{rep.visitRate}%</span>
                      </td>
                      <td className={`px-4 py-3 ${sub} text-xs`}>{fmtETB(rep.avgSalePerOutlet)}</td>
                      <td className="px-4 py-3">
                        <span className={ratingText[rep.rating]}>{ratingLabel[rep.rating]}</span>
                      </td>
                    </tr>
                  ))}
                  {!scores.length && (
                    <tr><td colSpan={7} className={`px-4 py-8 text-center ${sub}`}>No data this month</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
