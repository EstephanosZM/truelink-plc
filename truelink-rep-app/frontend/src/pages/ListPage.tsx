import { useState } from 'react'
import { useRepStore } from '../store/useRepStore'
import { fmtETB } from '../lib/utils'
import OutletSheet from '../components/OutletSheet'

export default function ListPage() {
  const { todayStops, setActiveOutletId } = useRepStore()
  const [showSheet, setShowSheet] = useState(false)
  const [filter, setFilter]       = useState<'all' | 'pending' | 'sold' | 'no_sale'>('all')

  const filtered = todayStops.filter((s) => {
    if (filter === 'all')     return true
    if (filter === 'pending') return !s.visit || s.visit.visit_status === 'not_visited'
    if (filter === 'sold')    return s.visit?.visit_status === 'sold'
    if (filter === 'no_sale') return s.visit?.visit_status === 'no_sale'
    return true
  })

  const statusBadge = (status?: string) => {
    if (status === 'sold')    return <span className="text-xs px-2 py-0.5 bg-green-900/50 text-green-400 rounded-full">Sold</span>
    if (status === 'no_sale') return <span className="text-xs px-2 py-0.5 bg-amber-900/50 text-amber-400 rounded-full">No sale</span>
    if (status === 'closed')  return <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-400 rounded-full">Closed</span>
    return <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-400 rounded-full">Pending</span>
  }

  const statusDot = (status?: string) => {
    if (status === 'sold')    return 'bg-green-500'
    if (status === 'no_sale') return 'bg-amber-500'
    if (status === 'closed')  return 'bg-slate-500'
    return 'bg-red-500'
  }

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all',     label: `All (${todayStops.length})` },
    { key: 'pending', label: `Pending (${todayStops.filter((s) => !s.visit || s.visit.visit_status === 'not_visited').length})` },
    { key: 'sold',    label: `Sold (${todayStops.filter((s) => s.visit?.visit_status === 'sold').length})` },
    { key: 'no_sale', label: `No sale (${todayStops.filter((s) => s.visit?.visit_status === 'no_sale').length})` },
  ]

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-900">
      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-3 overflow-x-auto scrollbar-none border-b border-slate-800 shrink-0">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <p className="text-4xl mb-3">📭</p>
            <p>No stops in this filter</p>
          </div>
        )}
        {filtered.map((stop) => {
          const stopRevenue = (stop.sales || []).reduce((a, r) => a + r.total_price, 0)
          return (
            <button
              key={stop.id}
              onClick={() => { setActiveOutletId(stop.outlet_id); setShowSheet(true) }}
              className="w-full flex items-center gap-4 px-4 py-4 border-b border-slate-800 hover:bg-slate-800/50 active:bg-slate-800 transition-colors text-left"
            >
              {/* Sequence badge */}
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${statusDot(stop.visit?.visit_status)}`}>
                <span className="text-white text-sm font-bold">{stop.sequence}</span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{stop.outlet.outlet_name}</p>
                <p className="text-slate-400 text-xs truncate">
                  {stop.outlet.land_mark || stop.outlet.owner_name || '—'}
                </p>
                {stop.visit?.visit_status === 'no_sale' && stop.visit.non_sale_reason_id && (
                  <p className="text-amber-500 text-xs mt-0.5">No sale recorded</p>
                )}
              </div>

              {/* Right side */}
              <div className="text-right shrink-0">
                {statusBadge(stop.visit?.visit_status)}
                {stopRevenue > 0 && (
                  <p className="text-green-400 text-xs font-semibold mt-1">{fmtETB(stopRevenue)}</p>
                )}
              </div>

              <span className="text-slate-600 text-sm">›</span>
            </button>
          )
        })}
      </div>

      {showSheet && <OutletSheet onClose={() => setShowSheet(false)} />}
    </div>
  )
}
