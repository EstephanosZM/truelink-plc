import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { api } from '../lib/api'
import { getDayColor, convexHull } from '../lib/utils'

type RoutingMethod = 'nearest_neighbour' | 'two_opt' | 'ortools'

const METHOD_INFO: Record<RoutingMethod, { label: string; desc: string; badge: string; color: string }> = {
  nearest_neighbour: {
    label: 'Nearest Neighbour',
    desc:  'Fast. Always picks the closest next outlet by road.',
    badge: 'Fast',
    color: 'bg-blue-100 text-blue-700',
  },
  two_opt: {
    label: '2-Opt',
    desc:  'Nearest neighbour + reversal pass. Removes crossovers. 10–20% shorter routes.',
    badge: 'Better',
    color: 'bg-green-100 text-green-700',
  },
  ortools: {
    label: 'OR-Tools',
    desc:  'Google solver. Finds near-optimal route. Best quality, takes 15–30s.',
    badge: 'Best',
    color: 'bg-purple-100 text-purple-700',
  },
}

function getDateOptions(): { value: string; label: string }[] {
  const options = []
  const today   = new Date()
  for (let i = 0; i <= 5; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const value = d.toISOString().split('T')[0]
    const label = i === 0 ? `Today — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : i === 1 ? `Tomorrow — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    options.push({ value, label })
  }
  return options
}

interface DayAssignment { salesRepId: string; routeDate: string }

export default function Sidebar() {
  const {
    activeTerritoryId, outlets, dayRoutes, routePlan,
    activeDay, setActiveDay, mode, setMode,
    setDayRoutes, setRoutePlan, updateDayRoute,
    selectedOutletId, setSelectedOutletId,
    settings, salesReps, setLoading, loading,
    searchQuery, setSearchQuery,
  } = useStore()

  const [nDays,       setNDays]       = useState(10)
  const [minOut,      setMinOut]      = useState(1)
  const [maxOut,      setMaxOut]      = useState<number | ''>('')
  const [method,      setMethod]      = useState<RoutingMethod>('nearest_neighbour')
  const [showMethod,  setShowMethod]  = useState(false)
  const [ortoolsOk,   setOrtoolsOk]  = useState<boolean | null>(null)
  const [error,       setError]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [movingTo,    setMovingTo]    = useState<number | null>(null)
  const [assignments, setAssignments] = useState<Record<number, DayAssignment>>({})
  const [editingDay,  setEditingDay]  = useState<number | null>(null)

  // Save name modal
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [routeName,     setRouteName]     = useState('')

  // History
  const [showHistory,  setShowHistory]  = useState(false)
  const [history,      setHistory]      = useState<{
    id: string; route_name: string | null; generated_at: string; n_days: number; status: string; method?: string
  }[]>([])
  const [loadingHist,  setLoadingHist]  = useState(false)

  const isOptimizing = loading['optimize']
  const dateOptions  = getDateOptions()
  const today        = dateOptions[0].value

  // Check if OR-Tools is available on the server
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL || 'https://truelink-api-nox3.onrender.com'}/health`)
      .then((r) => r.json())
      .then((d) => setOrtoolsOk(d.ortools_available === true))
      .catch(() => setOrtoolsOk(false))
  }, [])

  useEffect(() => {
    const defaults: Record<number, DayAssignment> = {}
    dayRoutes.forEach((dr) => {
      defaults[dr.day] = { salesRepId: dr.salesRepId || '', routeDate: today }
    })
    setAssignments(defaults)
  }, [dayRoutes.length])

  const setAssignment = (day: number, field: keyof DayAssignment, value: string) =>
    setAssignments((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }))

  // ── Create route ──────────────────────────────────────────
  const handleCreateRoute = async () => {
    if (!activeTerritoryId || !settings) return
    if (settings.warehouse_lat === 0 && settings.warehouse_lon === 0)
      return setError('Set warehouse coordinates in Settings first')
    const max = maxOut === '' ? 9999 : maxOut
    if (minOut > max) return setError('Min cannot exceed max outlets')
    setError(''); setLoading('optimize', true)
    try {
      const result = await api.optimize({
        outlets:   outlets.map((o) => ({ id: o.id, lat: o.latitude, lon: o.longitude, name: o.outlet_name })),
        warehouse: { lat: settings.warehouse_lat, lon: settings.warehouse_lon },
        n_days: nDays, min_outlets: minOut, max_outlets: max,
        method,
      })
      setDayRoutes(result.days.map((d) => ({ ...d, salesRepId: null })))
      setMode('route')
      const { data: plan } = await supabase.from('route_plans').insert({
        territory_id: activeTerritoryId, n_days: nDays,
        min_outlets: minOut, max_outlets: max, status: 'draft',
        route_method: method,
      }).select().single()
      if (plan) setRoutePlan(plan)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Optimization failed')
    }
    setLoading('optimize', false)
  }

  // ── Save ──────────────────────────────────────────────────
  const handleSaveClick = () => {
    if (!routePlan || !dayRoutes.length) return
    const missing = dayRoutes.find((dr) => !assignments[dr.day]?.routeDate)
    if (missing) return setError(`Please set a work date for Day ${missing.day}`)
    const def = `Route ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    setRouteName(routePlan.route_name || def)
    setShowSaveModal(true)
  }

  const handleSave = async () => {
    if (!routePlan || !dayRoutes.length) return
    setSaving(true); setShowSaveModal(false)
    await supabase.from('route_stops').delete().eq('route_plan_id', routePlan.id)
    const stops = dayRoutes.flatMap((dr) => {
      const assign = assignments[dr.day] || {}
      return dr.stops.map((s) => ({
        route_plan_id: routePlan.id, day_number: dr.day,
        outlet_id: s.id, sequence: s.sequence,
        sales_rep_id: assign.salesRepId || null,
        route_date:   assign.routeDate  || today,
      }))
    })
    const { error: insertError } = await supabase.from('route_stops').insert(stops)
    if (insertError) { setError(`Save failed: ${insertError.message}`); setSaving(false); return }
    await supabase.from('route_plans')
      .update({ status: 'saved', route_name: routeName.trim() || null, route_method: method })
      .eq('id', routePlan.id)
    setRoutePlan({ ...routePlan, status: 'saved' })
    setEditingDay(null); setSaving(false)
  }

  const handleSaveDayEdit = async (day: number) => {
    if (!routePlan) return
    const assign = assignments[day]
    if (!assign?.routeDate) return setError(`Please set a work date for Day ${day}`)
    setSaving(true)
    await supabase.from('route_stops').update({
      sales_rep_id: assign.salesRepId || null,
      route_date:   assign.routeDate,
    }).eq('route_plan_id', routePlan.id).eq('day_number', day)
    setEditingDay(null); setSaving(false)
  }

  const handleDraw = async () => {
    if (!routePlan) return
    setMode('draw')
    const polygons = dayRoutes.filter((dr) => dr.stops.length >= 3).map((dr) => {
      const hull = convexHull(dr.stops.map((s) => [s.lat, s.lon] as [number, number]))
      return {
        route_plan_id: routePlan.id, day_number: dr.day,
        geojson: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...hull, hull[0]].map(([lat, lon]) => [lon, lat])] },
          properties: {},
        },
      }
    })
    await supabase.from('territory_polygons').delete().eq('route_plan_id', routePlan.id)
    if (polygons.length) await supabase.from('territory_polygons').insert(polygons)
  }

  const handleMoveOutlet = async (toDay: number) => {
    if (!selectedOutletId || !settings) return
    const fromDR = dayRoutes.find((dr) => dr.stops.some((s) => s.id === selectedOutletId))
    if (!fromDR || fromDR.day === toDay) return
    setMovingTo(toDay)
    const fromStops = fromDR.stops.filter((s) => s.id !== selectedOutletId)
    const movedStop = fromDR.stops.find((s) => s.id === selectedOutletId)!
    const toStops   = [...(dayRoutes.find((d) => d.day === toDay)?.stops || []), movedStop]
    const toOut     = (stops: typeof fromStops) => stops.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, name: s.name }))
    try {
      const result = await api.reoptimize({
        days: [
          { day: fromDR.day, outlets: toOut(fromStops) },
          { day: toDay,      outlets: toOut(toStops)  },
        ],
        warehouse: { lat: settings.warehouse_lat, lon: settings.warehouse_lon },
        method,
      })
      result.days.forEach((d) => updateDayRoute(d.day, d.stops))
      setSelectedOutletId(null)
    } catch (err) { console.error(err) }
    setMovingTo(null)
  }

  // ── History ───────────────────────────────────────────────
  const openHistory = async () => {
    if (!activeTerritoryId) return
    setLoadingHist(true); setShowHistory(true)
    const { data } = await supabase
      .from('route_plans')
      .select('id, route_name, generated_at, n_days, status, route_method')
      .eq('territory_id', activeTerritoryId)
      .eq('status', 'saved')
      .order('generated_at', { ascending: false })
      .limit(20)
    setHistory(data || [])
    setLoadingHist(false)
  }

  const loadHistoryPlan = async (planId: string) => {
    setShowHistory(false); setLoading('history', true)
    const { data: stops, error } = await supabase
      .from('route_stops')
      .select('*, outlets(id, outlet_name, latitude, longitude)')
      .eq('route_plan_id', planId).order('sequence')
    if (error) console.error(error)
    if (!stops || stops.length === 0) {
      setError('No stops found. Please regenerate and save.')
      setLoading('history', false); return
    }
    const { data: plan } = await supabase.from('route_plans').select('*').eq('id', planId).single()
    if (plan) setRoutePlan(plan)

    const dayMap: Record<number, typeof stops> = {}
    stops.forEach((s: { day_number: number }) => {
      if (!dayMap[s.day_number]) dayMap[s.day_number] = []
      dayMap[s.day_number].push(s)
    })

    const savedAssignments: Record<number, DayAssignment> = {}
    Object.entries(dayMap).forEach(([day, dayStops]) => {
      const first = dayStops[0] as { sales_rep_id: string | null; route_date: string | null }
      savedAssignments[parseInt(day)] = {
        salesRepId: first.sales_rep_id || '',
        routeDate:  first.route_date   || today,
      }
    })
    setAssignments(savedAssignments)

    setDayRoutes(Object.entries(dayMap).map(([day, dayStops]) => ({
      day: parseInt(day),
      salesRepId: (dayStops[0] as { sales_rep_id: string | null }).sales_rep_id || null,
      stops: dayStops.map((s: {
        outlet_id: string; sequence: number
        outlets: { outlet_name: string; latitude: number; longitude: number }
      }) => ({
        id: s.outlet_id, sequence: s.sequence,
        name: s.outlets?.outlet_name || '',
        lat:  s.outlets?.latitude    || 0,
        lon:  s.outlets?.longitude   || 0,
      })),
    })).sort((a, b) => a.day - b.day))

    setMode('route'); setLoading('history', false)
  }

  const deleteHistoryPlan = async (planId: string) => {
    if (!confirm('Delete this route plan?')) return
    await supabase.from('route_plans').delete().eq('id', planId)
    setHistory(history.filter((h) => h.id !== planId))
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getRepName   = (id: string) => salesReps.find((r) => r.id === id)?.name || '—'
  const selectedOut  = outlets.find((o) => o.id === selectedOutletId)
  const selectedDay  = dayRoutes.find((dr) => dr.stops.some((s) => s.id === selectedOutletId))
  const filteredRoutes = searchQuery
    ? dayRoutes.map((dr) => ({
        ...dr, stops: dr.stops.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase())),
      })).filter((dr) => dr.stops.length > 0)
    : dayRoutes

  const totalOutlets = dayRoutes.reduce((a, d) => a + d.stops.length, 0)
  const avgPerDay    = dayRoutes.length ? Math.round(totalOutlets / dayRoutes.length) : 0
  const maxDay       = dayRoutes.reduce((a, d) => d.stops.length > a.stops.length ? d : a, dayRoutes[0] || { day: 0, stops: [], salesRepId: null })
  const minDay       = dayRoutes.reduce((a, d) => d.stops.length < a.stops.length ? d : a, dayRoutes[0] || { day: 0, stops: [], salesRepId: null })

  return (
    <>
      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={(e) => e.target === e.currentTarget && setShowSaveModal(false)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 w-full max-w-sm">
            <h2 className="font-semibold text-slate-900 mb-1">Name this route</h2>
            <p className="text-xs text-slate-500 mb-4">
              Method used: <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${METHOD_INFO[method].color}`}>{METHOD_INFO[method].badge}</span>
            </p>
            <input autoFocus value={routeName} onChange={(e) => setRouteName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="e.g. S-1 Week 1 May 2026"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setShowSaveModal(false)}
                className="flex-1 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col h-full shrink-0 overflow-hidden">
        {/* Controls */}
        <div className="p-4 border-b border-slate-200 space-y-3">
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 Search outlets…"
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Days</label>
              <input type="number" min={1} value={nDays} onChange={(e) => setNDays(parseInt(e.target.value)||1)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Min/day</label>
              <input type="number" min={1} value={minOut} onChange={(e) => setMinOut(parseInt(e.target.value)||1)}
                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Max outlets/day</label>
            <input type="number" min={1} value={maxOut} placeholder="No limit"
              onChange={(e) => setMaxOut(e.target.value ? parseInt(e.target.value) : '')}
              className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Method selector */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-slate-500">Routing Method</label>
              <button onClick={() => setShowMethod(!showMethod)}
                className="text-xs text-blue-600 hover:text-blue-800">
                {showMethod ? 'Hide' : 'Change'}
              </button>
            </div>

            {/* Current method badge */}
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${
              method === 'nearest_neighbour' ? 'border-blue-200 bg-blue-50' :
              method === 'two_opt'           ? 'border-green-200 bg-green-50' :
              'border-purple-200 bg-purple-50'
            }`}>
              <div>
                <p className={`text-xs font-semibold ${
                  method === 'nearest_neighbour' ? 'text-blue-700' :
                  method === 'two_opt'           ? 'text-green-700' : 'text-purple-700'
                }`}>{METHOD_INFO[method].label}</p>
                <p className="text-xs text-slate-500 leading-tight mt-0.5">{METHOD_INFO[method].desc}</p>
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ml-2 ${METHOD_INFO[method].color}`}>
                {METHOD_INFO[method].badge}
              </span>
            </div>

            {/* Method picker */}
            {showMethod && (
              <div className="mt-2 space-y-1.5">
                {(Object.keys(METHOD_INFO) as RoutingMethod[]).map((m) => {
                  const isOrtools    = m === 'ortools'
                  const unavailable  = isOrtools && ortoolsOk === false
                  return (
                    <button key={m}
                      onClick={() => { if (!unavailable) { setMethod(m); setShowMethod(false) } }}
                      disabled={unavailable}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                        method === m
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-slate-900">{METHOD_INFO[m].label}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${METHOD_INFO[m].color}`}>
                          {METHOD_INFO[m].badge}
                        </span>
                      </div>
                      <p className="text-slate-500 leading-tight">{METHOD_INFO[m].desc}</p>
                      {unavailable && (
                        <p className="text-amber-600 mt-0.5">Not available on this server</p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-md">{error}</p>}

          <button onClick={handleCreateRoute}
            disabled={!activeTerritoryId || !outlets.length || isOptimizing}
            className={`w-full py-2 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors ${
              method === 'two_opt'  ? 'bg-green-600 hover:bg-green-700' :
              method === 'ortools' ? 'bg-purple-600 hover:bg-purple-700' :
              'bg-blue-600 hover:bg-blue-700'
            }`}>
            {isOptimizing
              ? `⏳ ${method === 'ortools' ? 'Solving (may take 30s)…' : 'Optimizing…'}`
              : `🔀 Create Route — ${METHOD_INFO[method].badge}`}
          </button>

          <div className="grid grid-cols-3 gap-2">
            {dayRoutes.length > 0 && (
              <>
                <button onClick={handleSaveClick} disabled={saving}
                  className="py-2 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 text-slate-700 disabled:opacity-40">
                  {saving ? '…' : '💾 Save'}
                </button>
                <button onClick={handleDraw}
                  className="py-2 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 text-slate-700">
                  ✏ Draw
                </button>
              </>
            )}
            <button onClick={openHistory} disabled={!activeTerritoryId}
              className={`py-2 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 text-slate-700 disabled:opacity-40 ${dayRoutes.length > 0 ? '' : 'col-span-3'}`}>
              📂 History
            </button>
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className="border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between px-4 py-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Saved Routes</p>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
            </div>
            {loadingHist && <p className="text-xs text-slate-400 px-4 pb-3">Loading…</p>}
            {!loadingHist && history.length === 0 && (
              <p className="text-xs text-slate-400 px-4 pb-3">No saved routes for this territory</p>
            )}
            <div className="max-h-64 overflow-y-auto">
              {history.map((h) => {
                const m = (h.method || 'nearest_neighbour') as RoutingMethod
                return (
                  <div key={h.id} className="px-4 py-3 border-t border-slate-200 hover:bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {h.route_name || 'Unnamed route'}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{formatDate(h.generated_at)}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <p className="text-xs text-slate-400">{h.n_days} days</p>
                          {METHOD_INFO[m] && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${METHOD_INFO[m].color}`}>
                              {METHOD_INFO[m].badge}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <button onClick={() => loadHistoryPlan(h.id)} disabled={loading['history']}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40">Load</button>
                        <button onClick={() => deleteHistoryPlan(h.id)}
                          className="text-xs text-red-500 hover:text-red-700">Delete</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Metrics */}
          {dayRoutes.length > 0 && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 space-y-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Route Metrics</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'Total outlets', value: totalOutlets },
                  { label: 'Avg per day',   value: avgPerDay   },
                  { label: `Most (Day ${maxDay.day})`, value: maxDay.stops.length },
                  { label: `Least (Day ${minDay.day})`, value: minDay.stops.length },
                ].map((m) => (
                  <div key={m.label} className="bg-white rounded-lg p-2 border border-slate-200">
                    <p className="text-slate-500">{m.label}</p>
                    <p className="font-semibold text-slate-900">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Move outlet */}
          {selectedOutletId && selectedOut && (
            <div className="p-4 border-b border-slate-200 bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Move Outlet</span>
                <button onClick={() => setSelectedOutletId(null)} className="text-blue-400 hover:text-blue-600 text-lg">×</button>
              </div>
              <p className="text-sm font-medium text-slate-900 truncate">{selectedOut.outlet_name}</p>
              {selectedOut.land_mark && <p className="text-xs text-slate-500 mb-2">{selectedOut.land_mark}</p>}
              <p className="text-xs text-slate-600 mb-2">Currently: <span className="font-medium">Day {selectedDay?.day}</span></p>
              <div className="grid grid-cols-4 gap-1">
                {dayRoutes.map((dr) => dr.day !== selectedDay?.day && (
                  <button key={dr.day} onClick={() => handleMoveOutlet(dr.day)}
                    disabled={movingTo !== null}
                    className="py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: getDayColor(dr.day) }}>
                    {movingTo === dr.day ? '…' : `D${dr.day}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Day list */}
          {filteredRoutes.length > 0 ? filteredRoutes.map((dr) => {
            const assign  = assignments[dr.day] || { salesRepId: '', routeDate: today }
            const isEdit  = editingDay === dr.day
            const isSaved = routePlan?.status === 'saved' && !isEdit
            return (
              <div key={dr.day}>
                <button
                  onClick={() => setActiveDay(activeDay === dr.day ? null : dr.day)}
                  className={`w-full flex items-center justify-between px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${activeDay === dr.day ? 'bg-slate-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getDayColor(dr.day) }} />
                    <span className="text-sm font-medium text-slate-900">Day {dr.day}</span>
                    {assign.salesRepId && (
                      <span className="text-xs text-slate-500 truncate max-w-16">
                        {getRepName(assign.salesRepId).split(' ')[0]}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{dr.stops.length}</span>
                    <span className="text-slate-400 text-xs">{activeDay === dr.day ? '▲' : '▼'}</span>
                  </div>
                </button>

                {activeDay === dr.day && (
                  <div className="bg-slate-50 border-b border-slate-200">
                    <div className="px-4 py-3 border-b border-slate-200 space-y-2">
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Sales Rep</label>
                        {isSaved ? (
                          <p className="text-sm font-medium text-slate-900">
                            {assign.salesRepId ? getRepName(assign.salesRepId) : <span className="text-slate-400">Not assigned</span>}
                          </p>
                        ) : (
                          <select value={assign.salesRepId} onChange={(e) => setAssignment(dr.day, 'salesRepId', e.target.value)}
                            className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="">Select rep…</option>
                            {salesReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Work Date</label>
                        {isSaved ? (
                          <p className="text-sm font-medium text-slate-900">
                            {assign.routeDate
                              ? new Date(assign.routeDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                              : <span className="text-slate-400">Not set</span>}
                          </p>
                        ) : (
                          <select value={assign.routeDate} onChange={(e) => setAssignment(dr.day, 'routeDate', e.target.value)}
                            className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                            <option value="">Select date…</option>
                            {dateOptions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                          </select>
                        )}
                      </div>
                      {routePlan?.status === 'saved' && (
                        <div className="flex gap-2 pt-1">
                          {isEdit ? (
                            <>
                              <button onClick={() => setEditingDay(null)}
                                className="flex-1 py-1.5 border border-slate-300 rounded-lg text-xs hover:bg-slate-100 text-slate-600">
                                Cancel
                              </button>
                              <button onClick={() => handleSaveDayEdit(dr.day)} disabled={saving}
                                className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                                {saving ? '…' : 'Save Changes'}
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setEditingDay(dr.day)}
                              className="w-full py-1.5 border border-blue-300 text-blue-600 rounded-lg text-xs hover:bg-blue-50 font-medium">
                              ✏ Edit Rep / Date
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {dr.stops.map((stop) => (
                      <button key={stop.id} onClick={() => setSelectedOutletId(stop.id)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white transition-colors text-left ${selectedOutletId === stop.id ? 'bg-white' : ''}`}>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0"
                          style={{ backgroundColor: getDayColor(dr.day), fontSize: '10px', fontWeight: 600 }}>
                          {stop.sequence}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-900 truncate">{stop.name}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {outlets.find((o) => o.id === stop.id)?.land_mark || ''}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          }) : (
            <div className="p-6 text-center text-slate-400">
              <p className="text-3xl mb-3">🗺</p>
              <p className="text-sm">
                {!activeTerritoryId ? 'Select a territory to begin'
                  : outlets.length === 0 ? 'Upload a CSV to load outlets'
                  : 'Set parameters and click Create Route'}
              </p>
              {outlets.length > 0 && <p className="text-xs mt-2 text-slate-500">{outlets.length} outlets loaded</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50">
          <p className="text-xs text-slate-500">
            {outlets.length > 0
              ? `${outlets.length} outlets · ${dayRoutes.length > 0 ? `${dayRoutes.length} days` : 'no routes'} · ${routePlan?.status || 'unsaved'}`
              : 'No data loaded'}
          </p>
        </div>
      </aside>
    </>
  )
}
