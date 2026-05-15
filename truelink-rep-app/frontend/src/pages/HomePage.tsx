import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import { fmtETB, dailyTarget, todayLabel, today, getCurrentPosition } from '../lib/utils'

export default function HomePage() {
  const { activeRep, todayStops, stockLoads, products, setPage, routePlanId, darkMode } = useRepStore()

  const [dayLog,      setDayLog]      = useState<{ start_time: string | null; end_time: string | null } | null>(null)
  const [startingDay, setStartingDay] = useState(false)
  const [endingDay,   setEndingDay]   = useState(false)

  useEffect(() => { if (activeRep) loadDayLog() }, [activeRep])

  const loadDayLog = async () => {
    if (!activeRep) return
    const { data } = await supabase.from('rep_day_logs')
      .select('start_time, end_time')
      .eq('sales_rep_id', activeRep.id)
      .eq('log_date', today())
      .maybeSingle()
    setDayLog(data)
  }

  const handleStartDay = async () => {
    if (!activeRep) return
    setStartingDay(true)
    let lat: number | null = null
    let lon: number | null = null
    try {
      const pos = await getCurrentPosition()
      lat = pos.coords.latitude
      lon = pos.coords.longitude
    } catch { /* GPS optional */ }

    const { data } = await supabase.from('rep_day_logs').upsert({
      sales_rep_id: activeRep.id,
      log_date:     today(),
      start_time:   new Date().toISOString(),
      start_lat:    lat,
      start_lon:    lon,
    }, { onConflict: 'sales_rep_id,log_date' }).select().single()

    if (data) setDayLog(data)
    setStartingDay(false)
  }

  const handleEndDay = async () => {
    if (!activeRep) return
    if (!confirm('End your day? This records your end time.')) return
    setEndingDay(true)
    let lat: number | null = null
    let lon: number | null = null
    try {
      const pos = await getCurrentPosition()
      lat = pos.coords.latitude
      lon = pos.coords.longitude
    } catch { /* GPS optional */ }

    const { data } = await supabase.from('rep_day_logs').upsert({
      sales_rep_id: activeRep.id,
      log_date:     today(),
      end_time:     new Date().toISOString(),
      end_lat:      lat,
      end_lon:      lon,
    }, { onConflict: 'sales_rep_id,log_date' }).select().single()

    if (data) setDayLog(data)
    setEndingDay(false)
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  const getDuration = (start: string, end: string) => {
    const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  if (!activeRep) return null

  const target    = dailyTarget(activeRep.monthly_target)
  const assigned  = todayStops.length
  const visited   = todayStops.filter((s) => s.visit && s.visit.visit_status !== 'not_visited').length
  const sold      = todayStops.filter((s) => s.visit?.visit_status === 'sold').length
  const noSale    = todayStops.filter((s) => s.visit?.visit_status === 'no_sale').length
  const remaining = assigned - visited

  // Exclude free goods from revenue
  const totalRevenue = todayStops.reduce((acc, s) =>
    acc + (s.sales || []).filter((r) => !r.is_free_goods).reduce((a, r) => a + r.total_price, 0), 0
  )
  const freeGoodsUnits = todayStops.reduce((acc, s) =>
    acc + (s.sales || []).filter((r) => r.is_free_goods).reduce((a, r) => a + r.quantity, 0), 0
  )
  const progressPct = target > 0 ? Math.min(100, Math.round(totalRevenue / target * 100)) : 0

  const totalBalance   = stockLoads.reduce((a, s) => a + s.current_balance, 0)
  const totalLoaded    = stockLoads.reduce((a, s) => a + s.current_balance + (s.quantity_added || 0), 0)
  const totalSoldUnits = totalLoaded - totalBalance
  const cashOnHand     = totalRevenue

  const initials = activeRep.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  const greeting = () => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  }

  const bg    = darkMode ? 'bg-slate-900'   : 'bg-slate-50'
  const card  = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
  const text  = darkMode ? 'text-white'     : 'text-slate-900'
  const sub   = darkMode ? 'text-slate-400' : 'text-slate-500'
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
          <button onClick={() => useRepStore.getState().setDarkMode(!darkMode)}
            className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30 active:scale-90">
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
        <p className="text-blue-200 text-xs">{todayLabel()}</p>
      </div>

      <div className="px-4 -mt-4 space-y-4">

        {/* ── Start / End Day ── */}
        <div className={`${card} border rounded-2xl p-4`}>
          {!dayLog?.start_time ? (
            <button onClick={handleStartDay} disabled={startingDay}
              className="w-full py-4 bg-green-600 hover:bg-green-700 active:scale-95 rounded-xl text-white font-bold text-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {startingDay ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : '🟢'}
              {startingDay ? 'Starting…' : 'Start Day'}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                  <p className={`${text} text-sm font-medium`}>Day started at {fmtTime(dayLog.start_time)}</p>
                </div>
                {dayLog.end_time && (
                  <span className={`${sub} text-xs`}>
                    {getDuration(dayLog.start_time, dayLog.end_time)} worked
                  </span>
                )}
              </div>
              {dayLog.end_time ? (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-slate-500 rounded-full" />
                  <p className={`${sub} text-sm`}>Day ended at {fmtTime(dayLog.end_time)}</p>
                </div>
              ) : (
                <button onClick={handleEndDay} disabled={endingDay}
                  className={`w-full py-3 border-2 border-red-500/50 rounded-xl text-red-400 font-medium text-sm hover:bg-red-500/10 active:scale-95 transition-all disabled:opacity-50`}>
                  {endingDay ? 'Ending…' : '🔴 End Day'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Route stats ── */}
        {routePlanId ? (
          <>
            <div className={`${card} border rounded-2xl p-5`}>
              <p className={`text-xs font-semibold ${sub} uppercase tracking-wide mb-4`}>Today's Route</p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Assigned', value: assigned,  color: text           },
                  { label: 'Visited',  value: visited,   color: 'text-blue-400'  },
                  { label: 'Sold',     value: sold,      color: 'text-green-400' },
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

              {/* Revenue */}
              <div>
                <div className="flex justify-between items-end mb-2">
                  <div>
                    <p className={`${sub} text-xs`}>Revenue Today</p>
                    <p className={`${text} font-bold text-lg`}>{fmtETB(totalRevenue)}</p>
                    {freeGoodsUnits > 0 && (
                      <p className="text-purple-400 text-xs">+ {freeGoodsUnits} units free goods</p>
                    )}
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
                className={`${card} border hover:opacity-90 active:scale-95 rounded-2xl p-5 text-left transition-all`}>
                <div className="text-3xl mb-2">📋</div>
                <p className={`${text} font-semibold`}>Stop List</p>
                <p className={`${sub} text-xs mt-1`}>{assigned} stops today</p>
              </button>
            </div>
          </>
        ) : (
          <div className={`${card} border rounded-2xl p-8 text-center`}>
            <div className="text-5xl mb-4">📭</div>
            <p className={`${text} font-semibold mb-2`}>No route assigned today</p>
            <p className={`${sub} text-sm`}>Contact your manager to get a route assigned.</p>
          </div>
        )}

        {/* ── Summary ── */}
        <div className={`${card} border rounded-2xl p-5`}>
          <div className="flex items-center justify-between mb-4">
            <p className={`text-xs font-semibold ${sub} uppercase tracking-wide`}>My Summary</p>
            <button onClick={() => setPage('stock')} className="text-blue-400 text-xs font-medium">View stock →</button>
          </div>
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
          <div className={`${inner} rounded-xl p-4 flex items-center justify-between`}>
            <div>
              <p className={`${sub} text-xs mb-0.5`}>Cash on Hand</p>
              <p className={`${text} font-bold text-xl`}>{fmtETB(cashOnHand)}</p>
            </div>
            <div className="text-3xl">💵</div>
          </div>
        </div>
      </div>
    </div>
  )
}
