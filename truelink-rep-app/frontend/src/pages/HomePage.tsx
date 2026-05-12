import { useRepStore } from '../store/useRepStore'
import { fmtETB, dailyTarget, todayLabel } from '../lib/utils'

export default function HomePage() {
  const { activeRep, todayStops, stockLoads, products, setPage,
          routePlanId, darkMode, setDarkMode } = useRepStore()

  if (!activeRep) return null

  const target     = dailyTarget(activeRep.monthly_target)
  const assigned   = todayStops.length
  const visited    = todayStops.filter((s) => s.visit && s.visit.visit_status !== 'not_visited').length
  const sold       = todayStops.filter((s) => s.visit?.visit_status === 'sold').length
  const noSale     = todayStops.filter((s) => s.visit?.visit_status === 'no_sale').length
  const remaining  = assigned - visited

  const totalRevenue = todayStops.reduce((acc, s) =>
    acc + (s.sales || []).reduce((a, r) => a + r.total_price, 0), 0
  )

  const progressPct = target > 0 ? Math.min(100, Math.round(totalRevenue / target * 100)) : 0

  // Stock
  const totalBalance   = stockLoads.reduce((a, s) => a + s.current_balance, 0)
  const totalLoaded    = stockLoads.reduce((a, s) => a + s.current_balance + (s.quantity_added || 0), 0)
  const totalSoldUnits = totalLoaded - totalBalance

  // Cash on hand = total sales revenue
  const cashOnHand = totalRevenue

  const initials = activeRep.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const card = darkMode
    ? 'bg-slate-800 border-slate-700'
    : 'bg-white border-slate-200'
  const text = darkMode ? 'text-white' : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'
  const bg   = darkMode ? 'bg-slate-900' : 'bg-slate-50'
  const inner = darkMode ? 'bg-slate-700/50' : 'bg-slate-100'

  return (
    <div className={`flex-1 overflow-y-auto pb-24 ${bg}`}>
      {/* Header */}
      <div className="bg-gradient-to-b from-blue-700 to-blue-600 px-5 pt-12 pb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <span className="text-white font-bold">{initials}</span>
            </div>
            <div>
              <p className="text-blue-200 text-sm">{greeting()},</p>
              <p className="text-white font-bold text-lg">{activeRep.name} 👋</p>
            </div>
          </div>
          {/* Dark/light toggle */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors active:scale-90"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
        <p className="text-blue-200 text-xs">{todayLabel()}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4">
        {/* Today's route */}
        {routePlanId ? (
          <>
            {/* Stop stats */}
            <div className={`${card} rounded-2xl p-5 border`}>
              <p className={`text-xs font-semibold ${sub} uppercase tracking-wide mb-4`}>Today's Route</p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Assigned', value: assigned, color: text      },
                  { label: 'Visited',  value: visited,  color: 'text-blue-400'  },
                  { label: 'Sold',     value: sold,     color: 'text-green-400' },
                ].map((s) => (
                  <div key={s.label} className={`${inner} rounded-xl p-3 text-center`}>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className={`${sub} text-xs mt-1`}>{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className={`${inner} rounded-xl p-3 text-center`}>
                  <p className="text-amber-400 text-xl font-bold">{noSale}</p>
                  <p className={`${sub} text-xs mt-1`}>No Sale</p>
                </div>
                <div className={`${inner} rounded-xl p-3 text-center`}>
                  <p className="text-red-400 text-xl font-bold">{remaining}</p>
                  <p className={`${sub} text-xs mt-1`}>Remaining</p>
                </div>
              </div>

              {/* Revenue progress */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <p className={`${sub} text-xs`}>Revenue Today</p>
                    <p className={`${text} font-bold text-lg`}>{fmtETB(totalRevenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`${sub} text-xs`}>Daily Target</p>
                    <p className="text-blue-400 font-semibold text-sm">{fmtETB(target)}</p>
                  </div>
                </div>
                <div className={`w-full ${inner} rounded-full h-2.5`}>
                  <div className={`h-2.5 rounded-full transition-all ${
                    progressPct >= 100 ? 'bg-green-500' :
                    progressPct >= 50  ? 'bg-blue-500'  : 'bg-amber-500'
                  }`} style={{ width: `${progressPct}%` }} />
                </div>
                <p className={`${sub} text-xs mt-1`}>{progressPct}% of daily target</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setPage('map')}
                className="bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-2xl p-5 text-left transition-all">
                <div className="text-3xl mb-2">🗺</div>
                <p className="text-white font-semibold">Route Map</p>
                <p className="text-blue-200 text-xs mt-1">View on map</p>
              </button>
              <button onClick={() => setPage('list')}
                className={`${card} hover:opacity-90 active:scale-95 border rounded-2xl p-5 text-left transition-all`}>
                <div className="text-3xl mb-2">📋</div>
                <p className={`${text} font-semibold`}>Stop List</p>
                <p className={`${sub} text-xs mt-1`}>{assigned} stops today</p>
              </button>
            </div>
          </>
        ) : (
          <div className={`${card} rounded-2xl p-8 border text-center`}>
            <div className="text-5xl mb-4">📭</div>
            <p className={`${text} font-semibold mb-2`}>No route assigned today</p>
            <p className={`${sub} text-sm`}>Contact your manager to get a route assigned.</p>
          </div>
        )}

        {/* Stock + Cash summary */}
        <div className={`${card} rounded-2xl p-5 border`}>
          <div className="flex items-center justify-between mb-4">
            <p className={`text-xs font-semibold ${sub} uppercase tracking-wide`}>My Summary</p>
            <button onClick={() => setPage('stock')} className="text-blue-400 text-xs font-medium">
              View stock →
            </button>
          </div>

          {/* Stock row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Loaded',    value: totalLoaded,    color: text           },
              { label: 'Sold',      value: totalSoldUnits, color: 'text-green-400' },
              { label: 'Remaining', value: totalBalance,   color: 'text-amber-400' },
            ].map((s) => (
              <div key={s.label} className={`${inner} rounded-xl p-3 text-center`}>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className={`${sub} text-xs mt-1`}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Cash on hand */}
          <div className={`${inner} rounded-xl p-4 flex items-center justify-between`}>
            <div>
              <p className={`${sub} text-xs mb-0.5`}>Cash on Hand</p>
              <p className={`${text} font-bold text-xl`}>{fmtETB(cashOnHand)}</p>
            </div>
            <div className="text-3xl">💵</div>
          </div>

          {stockLoads.length === 0 && (
            <p className={`${sub} text-sm text-center py-2`}>No stock loaded for today</p>
          )}
        </div>

        {/* Per product mini list */}
        {stockLoads.length > 0 && (
          <div className={`${card} rounded-2xl p-5 border`}>
            <p className={`text-xs font-semibold ${sub} uppercase tracking-wide mb-3`}>Stock Breakdown</p>
            <div className="space-y-3">
              {stockLoads.map((sl) => {
                const prod    = products.find((p) => p.id === sl.product_id)
                if (!prod) return null
                const loaded  = sl.current_balance + (sl.quantity_added || 0)
                const soldU   = loaded - sl.current_balance
                const pct     = loaded > 0 ? Math.round(soldU / loaded * 100) : 0
                return (
                  <div key={sl.id} className="flex items-center gap-3">
                    {(prod as typeof prod & { image_url?: string }).image_url ? (
                      <img src={(prod as typeof prod & { image_url?: string }).image_url!}
                        alt={prod.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className={`w-10 h-10 ${inner} rounded-lg flex items-center justify-center shrink-0`}>
                        <span className="text-lg">📦</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`${text} text-xs font-medium truncate`}>{prod.name}</p>
                      <div className={`w-full ${inner} rounded-full h-1.5 mt-1`}>
                        <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`${sub} text-xs`}>{sl.current_balance} left</p>
                      <p className="text-green-400 text-xs">{soldU} sold</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
