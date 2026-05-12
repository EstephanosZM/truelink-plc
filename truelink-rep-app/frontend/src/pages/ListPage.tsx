import { useState } from 'react'
import { useRepStore } from '../store/useRepStore'
import { fmtETB } from '../lib/utils'
import OutletSheet from '../components/OutletSheet'
import RegisterOutletSheet from '../components/RegisterOutletSheet'

export default function ListPage() {
  const { todayStops, setActiveOutletId, darkMode } = useRepStore()
  const [showSheet,    setShowSheet]    = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [filter,       setFilter]       = useState<'all' | 'pending' | 'sold' | 'no_sale'>('all')

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

  const dotColor = (status?: string) => {
    if (status === 'sold')    return 'bg-green-500'
    if (status === 'no_sale') return 'bg-amber-500'
    if (status === 'closed')  return 'bg-slate-500'
    return 'bg-red-500'
  }

  const bg   = darkMode ? 'bg-slate-900' : 'bg-slate-50'
  const card = darkMode ? 'border-slate-800 hover:bg-slate-800/50' : 'border-slate-200 hover:bg-slate-50'
  const text = darkMode ? 'text-white' : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all',     label: `All (${todayStops.length})` },
    { key: 'pending', label: `Pending (${todayStops.filter((s) => !s.visit || s.visit.visit_status === 'not_visited').length})` },
    { key: 'sold',    label: `Sold (${todayStops.filter((s) => s.visit?.visit_status === 'sold').length})` },
    { key: 'no_sale', label: `No sale (${todayStops.filter((s) => s.visit?.visit_status === 'no_sale').length})` },
  ]

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${bg}`}>
      {/* Filter tabs */}
      <div className={`flex gap-1 px-4 py-3 overflow-x-auto scrollbar-none border-b ${darkMode ? 'border-slate-800' : 'border-slate-200'} shrink-0`}>
        {filters.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-blue-600 text-white'
                : darkMode ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Stop list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <p className="text-4xl mb-3">📭</p>
            <p>No stops in this filter</p>
          </div>
        )}
        {filtered.map((stop) => {
          const revenue = (stop.sales || []).reduce((a, r) => a + r.total_price, 0)
          return (
            <button key={stop.id}
              onClick={() => { setActiveOutletId(stop.outlet_id); setShowSheet(true) }}
              className={`w-full flex items-center gap-4 px-4 py-4 border-b active:opacity-70 transition-colors text-left ${card}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${dotColor(stop.visit?.visit_status)}`}>
                <span className="text-white text-sm font-bold">{stop.sequence}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`${text} font-medium truncate`}>{stop.outlet.outlet_name}</p>
                <p className={`${sub} text-xs truncate`}>
                  {stop.outlet.land_mark || stop.outlet.owner_name || '—'}
                </p>
              </div>
              <div className="text-right shrink-0">
                {statusBadge(stop.visit?.visit_status)}
                {revenue > 0 && <p className="text-green-400 text-xs font-semibold mt-1">{fmtETB(revenue)}</p>}
              </div>
              <span className={`${sub} text-sm`}>›</span>
            </button>
          )
        })}
      </div>

      {/* Register new outlet button */}
      <div className={`px-4 py-3 border-t ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'} shrink-0`}>
        <button
          onClick={() => setShowRegister(true)}
          className="w-full py-3 border-2 border-dashed border-blue-500/50 rounded-2xl text-blue-400 font-medium text-sm hover:bg-blue-500/10 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <span className="text-lg">📍</span>
          Register New Outlet
        </button>
      </div>

      {showSheet    && <OutletSheet           onClose={() => setShowSheet(false)}    />}
      {showRegister && <RegisterOutletSheet   onClose={() => setShowRegister(false)} />}
    </div>
  )
}
