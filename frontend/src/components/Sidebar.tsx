import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { api } from '../lib/api'
import { getDayColor, convexHull } from '../lib/utils'

const METHOD_BADGE: Record<string, { label: string; color: string }> = {
  nearest_neighbour: { label: 'Fast',   color: 'bg-blue-100 text-blue-700'   },
  two_opt:           { label: 'Better', color: 'bg-green-100 text-green-700' },
  ortools:           { label: 'Best',   color: 'bg-purple-100 text-purple-700' },
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

interface Stop {
  id: string; sequence: number; name: string; lat: number; lon: number
}

export default function Sidebar() {
  const {
    activeTerritoryId, outlets, dayRoutes, routePlan,
    activeDay, setActiveDay, mode, setMode,
    setDayRoutes, setRoutePlan, updateDayRoute,
    selectedOutletId, setSelectedOutletId,
    settings, salesReps, setLoading, loading,
    searchQuery, setSearchQuery,
    routingMethod,
  } = useStore()

  const [nDays,       setNDays]       = useState(10)
  const [minOut,      setMinOut]      = useState(1)
  const [maxOut,      setMaxOut]      = useState<number | ''>('')
  const [error,       setError]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [movingTo,    setMovingTo]    = useState<number | null>(null)
  const [assignments, setAssignments] = useState<Record<number, DayAssignment>>({})
  const [editingDay,  setEditingDay]  = useState<number | null>(null)

  // Drag-to-reorder state
  const [dragIdx,    setDragIdx]    = useState<number | null>(null)
  const [dragDay,    setDragDay]    = useState<number | null>(null)
  const [dragOver,   setDragOver]   = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLButtonElement | null>(null)

  const [showSaveModal, setShowSaveModal] = useState(false)
  const [routeName,     setRouteName]     = useState('')
  const [showHistory,   setShowHistory]   = useState(false)
  const [history,       setHistory]       = useState<{
    id: string; route_name: string | null; generated_at: string
    n_days: number; status: string; route_method?: string
  }[]>([])
  const [loadingHist, setLoadingHist] = useState(false)

  const isOptimizing = loading['optimize']
  const dateOptions  = getDateOptions()
  const today        = dateOptions[0].value
  const mb           = METHOD_BADGE[routingMethod] || METHOD_BADGE.nearest_neighbour

  const syncAssignments = (routes: typeof dayRoutes) => {
    const defaults: Record<number, DayAssignment> = {}
    routes.forEach((dr) => {
      defaults[dr.day] = assignments[dr.day] || { salesRepId: dr.salesRepId || '', routeDate: today }
    })
    setAssignments(defaults)
  }

  const setAssignment = (day: number, field: keyof DayAssignment, value: string) =>
    setAssignments((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }))

  // ── Drag handlers for reordering within a day ─────────────────────────────
  const handleDragStart = (e: React.DragEvent, day: number, idx: number) => {
    setDragIdx(idx); setDragDay(day)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(idx)
  }

  const handleDrop = (e: React.DragEvent, day: number, dropIdx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragDay !== day || dragIdx === dropIdx) {
      setDragIdx(null); setDragDay(null); setDragOver(null); return
    }

    const dr        = dayRoutes.find((d) => d.day === day)
    if (!dr) return
    const newStops  = [...dr.stops]
    const [moved]   = newStops.splice(dragIdx, 1)
    newStops.splice(dropIdx, 0, moved)

    // Re-number sequences
    const resequenced = newStops.map((s, i) => ({ ...s, sequence: i + 1 }))

    // Update store
    const updated = dayRoutes.map((d) =>
      d.day === day ? { ...d, stops: resequenced } : d
    )
    setDayRoutes(updated)

    setDragIdx(null); setDragDay(null); setDragOver(null)
  }

  const handleDragEnd = () => {
    setDragIdx(null); setDragDay(null); setDragOver(null)
  }

  // Move stop up or down within a day (for touch / non-drag fallback)
  const moveStopInDay = (day: number, idx: number, direction: 'up' | 'down') => {
    const dr = dayRoutes.find((d) => d.day === day)
    if (!dr) return
    const newStops = [...dr.stops]
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= newStops.length) return
    ;[newStops[idx], newStops[targetIdx]] = [newStops[targetIdx], newStops[idx]]
    const resequenced = newStops.map((s, i) => ({ ...s, sequence: i + 1 }))
    setDayRoutes(dayRoutes.map((d) => d.day === day ? { ...d, stops: resequenced } : d))
  }

  // ── Route creation ────────────────────────────────────────
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
        n_days: nDays, min_outlets: minOut, max_outlets: max, method: routingMethod,
      })
      const newRoutes = result.days.map((d) => ({ ...d, salesRepId: null }))
      setDayRoutes(newRoutes)
      syncAssignments(newRoutes)
      setMode('route')
      const { data: plan } = await supabase.from('route_plans').insert({
        territory_id: activeTerritoryId, n_days: nDays,
        min_outlets: minOut, max_outlets: max, status: 'draft', route_method: routingMethod,
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
    if (missing) return setError(`Set a work date for Day ${missing.day}`)
    setRouteName(routePlan.route_name ||
      `Route ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)
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
    const { error: ie } = await supabase.from('route_stops').insert(stops)
    if (ie) { setError(`Save failed: ${ie.message}`); setSaving(false); return }
    await supabase.from('route_plans')
      .update({ status: 'saved', route_name: routeName.trim() || null, route_method: routingMethod })
      .eq('id', routePlan.id)
    setRoutePlan({ ...routePlan, status: 'saved' })
    setEditingDay(null); setSaving(false)
  }

  const handleSaveDayEdit = async (day: number) => {
    if (!routePlan) return
    const assign = assignments[day]
    if (!assign?.routeDate) return setError(`Set a work date for Day ${day}`)
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
    const toOut     = (s: typeof fromStops) => s.map((x) => ({ id: x.id, lat: x.lat, lon: x.lon, name: x.name }))
    try {
      const result = await api.reoptimize({
        days: [
          { day: fromDR.day, outlets: toOut(fromStops) },
          { day: toDay,      outlets: toOut(toStops) },
        ],
        warehouse: { lat: settings.warehouse_lat, lon: settings.warehouse_lon },
        method: routingMethod,
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
      .eq('territory_id', activeTerritoryId).eq('status', 'saved')
      .order('generated_at', { ascending: false }).limit(20)
    setHistory(data || [])
    setLoadingHist(false)
  }

  const loadHistoryPlan = async (planId: string) => {
    setShowHistory(false); setLoading('history', true)
    const { data: stops, error } = await supabase
      .from('route_stops').select('*, outlets(id, outlet_name, latitude, longitude)')
      .eq('route_plan_id', planId).order('sequence')
    if (error) console.error(error)
    if (!stops?.length) {
      setError('No stops found. Regenerate and save.'); setLoading('history', false); return
    }
    const { data: plan } = await supabase.from('route_plans').select('*').eq('id', planId).single()
    if (plan) setRoutePlan(plan)

    const dayMap: Record<number, typeof stops> = {}
    stops.forEach((s: { day_number: number }) => {
      if (!dayMap[s.day_number]) dayMap[s.day_number] = []
      dayMap[s.day_number].push(s)
    })

    const saved: Record<number, DayAssignment> = {}
    Object.entries(dayMap).forEach(([day, ds]) => {
      const f = ds[0] as { sales_rep_id: string | null; route_date: string | null }
      saved[parseInt(day)] = { salesRepId: f.sales_rep_id || '', routeDate: f.route_date || today }
    })
    setAssignments(saved)

    const newRoutes = Object.entries(dayMap).map(([day, ds]) => ({
      day: parseInt(day),
      salesRepId: (ds[0] as { sales_rep_id: string | null }).sales_rep_id || null,
      stops: ds.map((s: {
        outlet_id: string; sequence: number
        outlets: { outlet_name: string; latitude: number; longitude: number }
      }) => ({
        id: s.outlet_id, sequence: s.sequence,
        name: s.outlets?.outlet_name || '',
        lat:  s.outlets?.latitude    || 0,
        lon:  s.outlets?.longitude   || 0,
      })),
    })).sort((a, b) => a.day - b.day)

    setDayRoutes(newRoutes)
    setMode('route'); setLoading('history', false)
  }

  const deleteHistoryPlan = async (planId: string) => {
    if (!confirm('Delete this route plan?')) return
    await supabase.from('route_plans').delete().eq('id', planId)
    setHistory(history.filter((h) => h.id !== planId))
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  const getRepName = (id: string) => salesReps.find((r) => r.id === id)?.name || '—'
  const selOut     = outlets.find((o) => o.id === selectedOutletId)
  const selDay     = dayRoutes.find((dr) => dr.stops.some((s) => s.id === selectedOutletId))

  const filteredRoutes = searchQuery
    ? dayRoutes.map((dr) => ({
        ...dr, stops: dr.stops.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase())),
      })).filter((dr) => dr.stops.length > 0)
    : dayRoutes

  const totalOutlets = dayRoutes.reduce((a, d) => a + d.stops.length, 0)
  const avgPerDay    = dayRoutes.length ? Math.round(totalOutlets / dayRoutes.length) : 0
  const maxDayR      = dayRoutes.reduce((a, d) => d.stops.length > a.stops.length ? d : a, dayRoutes[0] || { day:0, stops:[], salesRepId: null })
  const minDayR      = dayRoutes.reduce((a, d) => d.stops.length < a.stops.length ? d : a, dayRoutes[0] || { day:0, stops:[], salesRepId: null })

  return (
    <>
      {/* Save modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={(e) => e.target === e.currentTarget && setShowSaveModal(false)}>
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 w-full max-w-sm">
            <h2 className="font-semibold text-slate-900 mb-1">Name this route</h2>
            <p className="text-xs text-slate-500 mb-4">
              Method: <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${mb.color}`}>{mb.label}</span>
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

          {/* Method badge */}
          <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${
            routingMethod === 'two_opt'  ? 'border-green-200 bg-green-50'   :
            routingMethod === 'ortools'  ? 'border-purple-200 bg-purple-50' : 'border-blue-200 bg-blue-50'
          }`}>
            <p className={`text-xs font-medium ${
              routingMethod === 'two_opt'  ? 'text-green-700'  :
              routingMethod === 'ortools'  ? 'text-purple-700' : 'text-blue-700'
            }`}>
              {routingMethod === 'nearest_neighbour' ? 'Nearest Neighbour' :
               routingMethod === 'two_opt'           ? '2-Opt' : 'OR-Tools'}
            </p>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${mb.color}`}>{mb.label}</span>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded-md">{error}</p>}

          <button onClick={handleCreateRoute}
            disabled={!activeTerritoryId || !outlets.length || isOptimizing}
            className={`w-full py-2 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors ${
              routingMethod === 'two_opt'  ? 'bg-green-600 hover:bg-green-700'   :
              routingMethod === 'ortools'  ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}>
            {isOptimizing
              ? `⏳ ${routingMethod === 'ortools' ? 'Solving (up to 30s)…' : 'Optimizing…'}`
              : '🔀 Create Route'}
          </button>

          <div className="grid grid-cols-3 gap-2">
            {dayRoutes.length > 0 && (
              <>
                <button onClick={handleSaveClick} disabled={saving}
                  className="py-2 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 text-slate-700 disabled:opacity-40">
                  {saving ? '…' : '💾 Save'}
                </button>
                <button onClick={handleDraw}
                  className="py-2 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 text-slate-700">✏ Draw</button>
              </>
            )}
            <button onClick={openHistory} disabled={!activeTerritoryId}
              className={`py-2 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 text-slate-700 disabled:opacity-40 ${dayRoutes.length > 0 ? '' : 'col-span-3'}`}>
              📂 History
            </button>
          </div>
        </div>

        {/* History */}
        {showHistory && (
          <div className="border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between px-4 py-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Saved Routes</p>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
            </div>
            {loadingHist && <p className="text-xs text-slate-400 px-4 pb-3">Loading…</p>}
            {!loadingHist && !history.length && <p className="text-xs text-slate-400 px-4 pb-3">No saved routes</p>}
            <div className="max-h-64 overflow-y-auto">
              {history.map((h) => {
                const hm  = (h.route_method || 'nearest_neighbour')
                const hmb = METHOD_BADGE[hm] || METHOD_BADGE.nearest_neighbour
                return (
                  <div key={h.id} className="px-4 py-3 border-t border-slate-200 hover:bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 truncate">{h.route_name || 'Unnamed'}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{formatDate(h.generated_at)}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <p className="text-xs text-slate-400">{h.n_days} days</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${hmb.color}`}>{hmb.label}</span>
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

        <div className="flex-1 overflow-y-auto">
          {/* Metrics */}
          {dayRoutes.length > 0 && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 space-y-2">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Route Metrics</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'Total outlets', value: totalOutlets },
                  { label: 'Avg per day',   value: avgPerDay   },
                  { label: `Most (Day ${maxDayR.day})`,  value: maxDayR.stops.length },
                  { label: `Least (Day ${minDayR.day})`, value: minDayR.stops.length },
                ].map((m) => (
                  <div key={m.label} className="bg-white rounded-lg p-2 border border-slate-200">
                    <p className="text-slate-500">{m.label}</p>
                    <p className="font-semibold text-slate-900">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Move outlet to another day */}
          {selectedOutletId && selOut && (
            <div className="p-4 border-b border-slate-200 bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Move to Another Day</span>
                <button onClick={() => setSelectedOutletId(null)} className="text-blue-400 hover:text-blue-600 text-lg">×</button>
              </div>
              <p className="text-sm font-medium text-slate-900 truncate">{selOut.outlet_name}</p>
              {selOut.land_mark && <p className="text-xs text-slate-500 mb-2">{selOut.land_mark}</p>}
              <p className="text-xs text-slate-600 mb-2">Currently: <span className="font-medium">Day {selDay?.day}</span></p>
              <div className="grid grid-cols-4 gap-1">
                {dayRoutes.map((dr) => dr.day !== selDay?.day && (
                  <button key={dr.day} onClick={() => handleMoveOutlet(dr.day)} disabled={movingTo !== null}
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
            const isActive = activeDay === dr.day

            return (
              <div key={dr.day}>
                <button onClick={() => setActiveDay(isActive ? null : dr.day)}
                  className={`w-full flex items-center justify-between px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${isActive ? 'bg-slate-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getDayColor(dr.day) }} />
                    <span className="text-sm font-medium text-slate-900">Day {dr.day}</span>
                    {assign.salesRepId && (
                      <span className="text-xs text-slate-500 truncate max-w-16">{getRepName(assign.salesRepId).split(' ')[0]}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{dr.stops.length}</span>
                    <span className="text-slate-400 text-xs">{isActive ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isActive && (
                  <div className="bg-slate-50 border-b border-slate-200">
                    {/* Assignment */}
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
                                className="flex-1 py-1.5 border border-slate-300 rounded-lg text-xs hover:bg-slate-100 text-slate-600">Cancel</button>
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

                    {/* Reorder hint */}
                    <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100">
                      <p className="text-xs text-amber-700">
                        ↕ Drag to reorder · ▲▼ arrows to move
                      </p>
                    </div>

                    {/* Stop list with drag-to-reorder */}
                    {dr.stops.map((stop, idx) => {
                      const isDragging  = dragDay === dr.day && dragIdx === idx
                      const isDragOver  = dragDay === dr.day && dragOver === idx
                      return (
                        <div
                          key={stop.id}
                          className={`relative transition-all ${isDragOver ? 'border-t-2 border-blue-500' : ''}`}
                        >
                          <button
                            ref={dragNodeRef}
                            draggable
                            onDragStart={(e) => handleDragStart(e, dr.day, idx)}
                            onDragOver={(e)  => handleDragOver(e, idx)}
                            onDrop={(e)      => handleDrop(e, dr.day, idx)}
                            onDragEnd={handleDragEnd}
                            onClick={() => setSelectedOutletId(stop.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white transition-colors text-left ${
                              selectedOutletId === stop.id ? 'bg-white' : ''
                            } ${isDragging ? 'opacity-40' : ''}`}
                          >
                            {/* Drag handle */}
                            <span className="text-slate-300 cursor-grab active:cursor-grabbing text-sm shrink-0 select-none">⠿</span>

                            {/* Sequence badge */}
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0"
                              style={{ backgroundColor: getDayColor(dr.day), fontSize: '10px', fontWeight: 600 }}>
                              {stop.sequence}
                            </span>

                            {/* Name */}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-900 truncate">{stop.name}</p>
                              <p className="text-xs text-slate-400 truncate">
                                {outlets.find((o) => o.id === stop.id)?.land_mark || ''}
                              </p>
                            </div>

                            {/* Up/Down arrows */}
                            <div className="flex flex-col gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => moveStopInDay(dr.day, idx, 'up')}
                                disabled={idx === 0}
                                className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20 text-xs leading-none"
                                title="Move up"
                              >▲</button>
                              <button
                                onClick={() => moveStopInDay(dr.day, idx, 'down')}
                                disabled={idx === dr.stops.length - 1}
                                className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20 text-xs leading-none"
                                title="Move down"
                              >▼</button>
                            </div>
                          </button>
                        </div>
                      )
                    })}
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
