import { useRepStore } from '../store/useRepStore'
import { fmtETB, dailyTarget, todayLabel } from '../lib/utils'

export default function HomePage() {
  const { activeRep, todayStops, stockLoads, products, setPage, routePlanId } = useRepStore()

  if (!activeRep) return null

  const target    = dailyTarget(activeRep.monthly_target)
  const assigned  = todayStops.length
  const visited   = todayStops.filter((s) => s.visit && s.visit.visit_status !== 'not_visited').length
  const sold      = todayStops.filter((s) => s.visit?.visit_status === 'sold').length
  const noSale    = todayStops.filter((s) => s.visit?.visit_status === 'no_sale').length
  const remaining = assigned - visited

  const totalRevenue = todayStops.reduce((acc, s) => {
    return acc + (s.sales || []).reduce((a, r) => a + r.total_price, 0)
  }, 0)

  const progressPct = target > 0 ? Math.min(100, Math.round(totalRevenue / target * 100)) : 0

  // Stock summary
  const totalLoaded  = stockLoads.reduce((a, s) => a + s.current_balance + (s.quantity_added || 0), 0)
  const totalBalance = stockLoads.reduce((a, s) => a + s.current_balance, 0)
  const totalSoldUnits = totalLoaded - totalBalance

  const initials = activeRep.name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-b from-blue-700 to-blue-600 px-5 pt-12 pb-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <span className="text-white font-bold">{initials}</span>
          </div>
          <div>
            <p className="text-blue-200 text-sm">{greeting()},</p>
            <p className="text-white font-bold text-lg">{activeRep.name} 👋</p>
          </div>
        </div>
        <p className="text-blue-200 text-xs">{todayLabel()}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4">
        {/* Today's route card */}
        {routePlanId ? (
          <>
            {/* Stats grid */}
            <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-4">
                Today's Route
              </p>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Assigned',  value: assigned,  color: 'text-white'       },
                  { label: 'Visited',   value: visited,   color: 'text-blue-400'    },
                  { label: 'Sold',      value: sold,      color: 'text-green-400'   },
                ].map((s) => (
                  <div key={s.label} className="bg-slate-700/50 rounded-xl p-3 text-center">
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-slate-400 text-xs mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Additional stats row */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="bg-slate-700/50 rounded-xl p-3 text-center">
                  <p className="text-amber-400 text-xl font-bold">{noSale}</p>
                  <p className="text-slate-400 text-xs mt-1">No Sale</p>
                </div>
                <div className="bg-slate-700/50 rounded-xl p-3 text-center">
                  <p className="text-red-400 text-xl font-bold">{remaining}</p>
                  <p className="text-slate-400 text-xs mt-1">Remaining</p>
                </div>
              </div>

              {/* Revenue target */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <p className="text-slate-400 text-xs">Revenue Today</p>
                    <p className="text-white font-bold text-lg">{fmtETB(totalRevenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 text-xs">Daily Target</p>
                    <p className="text-blue-400 font-semibold text-sm">{fmtETB(target)}</p>
                  </div>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all ${
                      progressPct >= 100 ? 'bg-green-500' :
                      progressPct >= 50  ? 'bg-blue-500'  : 'bg-amber-500'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <p className="text-slate-500 text-xs">{progressPct}% of daily target</p>
                  {activeRep.monthly_target > 0 && (
                    <p className="text-slate-500 text-xs">
                      Monthly: {fmtETB(activeRep.monthly_target)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPage('map')}
                className="bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-2xl p-5 text-left transition-all"
              >
                <div className="text-3xl mb-2">🗺</div>
                <p className="text-white font-semibold">Route Map</p>
                <p className="text-blue-200 text-xs mt-1">View on map</p>
              </button>
              <button
                onClick={() => setPage('list')}
                className="bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 rounded-2xl p-5 text-left transition-all"
              >
                <div className="text-3xl mb-2">📋</div>
                <p className="text-white font-semibold">Stop List</p>
                <p className="text-slate-400 text-xs mt-1">{assigned} stops today</p>
              </button>
            </div>
          </>
        ) : (
          /* No route assigned */
          <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 text-center">
            <div className="text-5xl mb-4">📭</div>
            <p className="text-white font-semibold mb-2">No route assigned today</p>
            <p className="text-slate-400 text-sm">
              Contact your manager to get a route assigned for today.
            </p>
          </div>
        )}

        {/* Stock card */}
        <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide">My Stock</p>
            <button
              onClick={() => setPage('stock')}
              className="text-blue-400 text-xs font-medium"
            >View all →</button>
          </div>
          {stockLoads.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-3">
                {[
                  { label: 'Loaded',    value: totalLoaded,    color: 'text-white'     },
                  { label: 'Sold',      value: totalSoldUnits, color: 'text-green-400' },
                  { label: 'Remaining', value: totalBalance,   color: 'text-amber-400' },
                ].map((s) => (
                  <div key={s.label} className="bg-slate-700/50 rounded-xl p-3 text-center">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-slate-400 text-xs mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
              {/* Per-product mini list */}
              <div className="space-y-2">
                {stockLoads.slice(0, 3).map((sl) => {
                  const prod = products.find((p) => p.id === sl.product_id)
                  if (!prod) return null
                  const soldUnits = (sl.current_balance + (sl.quantity_added || 0)) - sl.current_balance
                  const pct = sl.current_balance > 0
                    ? Math.round((1 - sl.current_balance / (sl.current_balance + soldUnits || 1)) * 100)
                    : 100
                  return (
                    <div key={sl.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-300 text-xs truncate">{prod.name}</p>
                        <div className="w-full bg-slate-700 rounded-full h-1.5 mt-1">
                          <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${100 - pct}%` }} />
                        </div>
                      </div>
                      <p className="text-slate-400 text-xs shrink-0">{sl.current_balance} left</p>
                    </div>
                  )
                })}
                {stockLoads.length > 3 && (
                  <p className="text-slate-500 text-xs text-center">+{stockLoads.length - 3} more products</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-slate-500 text-sm text-center py-4">No stock loaded for today</p>
          )}
        </div>
      </div>
    </div>
  )
}
