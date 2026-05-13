import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import OutletSheet from '../components/OutletSheet'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const OSRM = 'https://router.project-osrm.org'

async function getRoadPolyline(
  waypoints: { lat: number; lon: number }[]
): Promise<L.LatLngTuple[]> {
  if (waypoints.length < 2) return waypoints.map((w) => [w.lat, w.lon] as L.LatLngTuple)
  const CHUNK = 25
  const allPts: L.LatLngTuple[] = []
  for (let i = 0; i < waypoints.length - 1; i += CHUNK - 1) {
    const chunk  = waypoints.slice(i, Math.min(i + CHUNK, waypoints.length))
    const coords = chunk.map((w) => `${w.lon},${w.lat}`).join(';')
    try {
      const res  = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`)
      const data = await res.json()
      if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
        const pts = data.routes[0].geometry.coordinates.map(
          ([lon, lat]: [number, number]) => [lat, lon] as L.LatLngTuple
        )
        if (allPts.length > 0) pts.shift()
        allPts.push(...pts)
      } else {
        chunk.forEach((w) => allPts.push([w.lat, w.lon]))
      }
    } catch {
      chunk.forEach((w) => allPts.push([w.lat, w.lon]))
    }
  }
  return allPts.length > 0 ? allPts : waypoints.map((w) => [w.lat, w.lon] as L.LatLngTuple)
}

// Animate dot travelling along road polyline
function animateRoute(
  map: L.Map,
  points: L.LatLngTuple[],
  color: string,
): () => void {
  if (points.length < 2) return () => {}
  let cancelled = false
  let frameId:   number

  const ghost = L.polyline(points, { color, weight: 3, opacity: 0.15, dashArray: '6,6' }).addTo(map)
  const line  = L.polyline([points[0]], { color, weight: 4, opacity: 0.9 }).addTo(map)
  const dot   = L.circleMarker(points[0], {
    radius: 8, color: 'white', fillColor: color, fillOpacity: 1, weight: 2.5,
  }).addTo(map)

  const drawn: L.LatLngTuple[] = [points[0]]
  let ptIdx = 1
  let seg   = 0
  const SPEED = 0.03   // fast animation

  const step = () => {
    if (cancelled) return
    if (ptIdx >= points.length) { dot.remove(); return }
    const from = points[ptIdx - 1]
    const to   = points[ptIdx]
    seg += SPEED
    if (seg >= 1) {
      seg = 0; drawn.push(to)
      line.setLatLngs(drawn); dot.setLatLng(to); ptIdx++
    } else {
      const lat = from[0] + (to[0] - from[0]) * seg
      const lon = from[1] + (to[1] - from[1]) * seg
      line.setLatLngs([...drawn, [lat, lon]]); dot.setLatLng([lat, lon])
    }
    frameId = requestAnimationFrame(step)
  }
  frameId = requestAnimationFrame(step)

  return () => {
    cancelled = true; cancelAnimationFrame(frameId)
    ghost.remove(); line.remove(); dot.remove()
  }
}

const statusColor = (status?: string) => {
  if (status === 'sold')    return '#22c55e'
  if (status === 'no_sale') return '#f59e0b'
  if (status === 'closed')  return '#6b7280'
  return '#ef4444'
}

const DAY_COLORS = [
  '#e6194b','#3cb44b','#4363d8','#f58231','#911eb4',
  '#42d4f4','#f032e6','#bfef45','#469990','#dcbeff',
]
const getDayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length]

export default function MapPage() {
  const {
    todayStops, liveLocation, routePlanId, dayNumber,
    setActiveOutletId, darkMode, lastVisitedPosition,
  } = useRepStore()

  const mapRef         = useRef<L.Map | null>(null)
  const containerRef   = useRef<HTMLDivElement>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const roadLayerRef   = useRef<L.LayerGroup | null>(null)
  const polyLayerRef   = useRef<L.LayerGroup | null>(null)
  const liveLayerRef   = useRef<L.LayerGroup | null>(null)
  const cancelAnimRef  = useRef<(() => void) | null>(null)

  const [showSheet,    setShowSheet]    = useState(false)
  const [showPolygon,  setShowPolygon]  = useState(true)
  const [loadingRoads, setLoadingRoads] = useState(false)

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: [9.03, 38.74], zoom: 13, zoomControl: false })
    L.tileLayer(
      darkMode
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }
    ).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    roadLayerRef.current   = L.layerGroup().addTo(map)
    polyLayerRef.current   = L.layerGroup().addTo(map)
    liveLayerRef.current   = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Load territory polygon
  useEffect(() => {
    const poly = polyLayerRef.current
    if (!poly || !routePlanId || !dayNumber) return
    poly.clearLayers()
    if (!showPolygon) return
    const load = async () => {
      const { data } = await supabase
        .from('territory_polygons')
        .select('geojson')
        .eq('route_plan_id', routePlanId)
        .eq('day_number', dayNumber)
        .single()
      if (!data?.geojson) return
      const color = getDayColor(dayNumber)
      L.geoJSON(data.geojson as GeoJSON.Feature, {
        style: { color, fillColor: color, fillOpacity: 0.12, weight: 2.5, opacity: 0.8, dashArray: '8,4' },
      })
        .bindTooltip(`Day ${dayNumber} Territory`, { sticky: true })
        .addTo(poly!)
    }
    load()
  }, [routePlanId, dayNumber, showPolygon])

  // Draw markers + road lines + animate
  const drawAll = useCallback(async () => {
    const map     = mapRef.current
    const markers = markerLayerRef.current
    const roads   = roadLayerRef.current
    if (!map || !markers || !roads) return

    if (cancelAnimRef.current) { cancelAnimRef.current(); cancelAnimRef.current = null }
    markers.clearLayers()
    roads.clearLayers()
    if (todayStops.length === 0) return

    const color = getDayColor(dayNumber || 1)

    // Place markers
    todayStops.forEach((stop) => {
      const sc        = statusColor(stop.visit?.visit_status)
      const isPending = !stop.visit || stop.visit.visit_status === 'not_visited'
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:${sc};color:white;
          display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:11px;
          border:2px solid white;
          box-shadow:0 2px 6px rgba(0,0,0,.4);
          ${isPending ? 'animation:ps 2s infinite;' : ''}
        ">${stop.sequence}</div>
        <style>@keyframes ps{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}</style>`,
        iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
      })
      L.marker([stop.outlet.latitude, stop.outlet.longitude], { icon })
        .on('click', () => { setActiveOutletId(stop.outlet_id); setShowSheet(true) })
        .addTo(markers)
    })

    // Fit to pending stops
    const pending = todayStops.filter((s) => !s.visit || s.visit.visit_status === 'not_visited')
    const fitSet  = pending.length > 0 ? pending : todayStops
    map.fitBounds(
      L.latLngBounds(fitSet.map((s) => [s.outlet.latitude, s.outlet.longitude] as L.LatLngTuple)),
      { padding: [50, 50] }
    )

    // Build full route waypoints
    const allWaypts = todayStops.map((s) => ({ lat: s.outlet.latitude, lon: s.outlet.longitude }))

    // Find start index: last visited outlet, or 0
    const lastIdx = lastVisitedPosition
      ? todayStops.findIndex((s) =>
          s.outlet.latitude  === lastVisitedPosition.lat &&
          s.outlet.longitude === lastVisitedPosition.lon
        )
      : -1
    const remainingWaypts = lastIdx >= 0 ? allWaypts.slice(lastIdx) : allWaypts

    // Draw static road line for completed portion (grey)
    if (lastIdx > 0) {
      setLoadingRoads(true)
      const completedWaypts = allWaypts.slice(0, lastIdx + 1)
      const completedRoad   = await getRoadPolyline(completedWaypts)
      L.polyline(completedRoad, { color: '#6b7280', weight: 3, opacity: 0.4 }).addTo(roads)
      setLoadingRoads(false)
    }

    // Fetch road geometry for remaining stops then animate
    if (remainingWaypts.length >= 2) {
      setLoadingRoads(true)
      const roadPts = await getRoadPolyline(remainingWaypts)
      setLoadingRoads(false)
      if (!cancelAnimRef.current && roadPts.length > 1) {
        cancelAnimRef.current = animateRoute(map, roadPts, color)
      }
    }
  }, [todayStops, dayNumber, lastVisitedPosition])

  useEffect(() => { drawAll() }, [drawAll])

  // Live location dot
  useEffect(() => {
    const liveLayer = liveLayerRef.current
    const map       = mapRef.current
    if (!map || !liveLayer || !liveLocation) return
    liveLayer.clearLayers()
    L.circleMarker([liveLocation.lat, liveLocation.lon], {
      radius: 18, color: '#3b82f6', fillColor: 'transparent', opacity: 0.3, weight: 2,
    }).addTo(liveLayer)
    L.circleMarker([liveLocation.lat, liveLocation.lon], {
      radius: 9, color: '#3b82f6', fillColor: '#60a5fa', fillOpacity: 1, weight: 3,
    }).bindTooltip('You are here').addTo(liveLayer)
  }, [liveLocation])

  useEffect(() => { return () => { if (cancelAnimRef.current) cancelAnimRef.current() } }, [])

  const soldCount    = todayStops.filter((s) => s.visit?.visit_status === 'sold').length
  const noSaleCount  = todayStops.filter((s) => s.visit?.visit_status === 'no_sale').length
  const pendingCount = todayStops.filter((s) => !s.visit || s.visit.visit_status === 'not_visited').length

  return (
    <div className="flex-1 relative">
      <div ref={containerRef} className="w-full h-full" />

      {/* Legend */}
      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur rounded-xl px-3 py-2 space-y-1 z-10">
        {[
          { emoji: '✅', label: 'Sold',    count: soldCount,    color: 'text-green-400' },
          { emoji: '🟡', label: 'No sale', count: noSaleCount,  color: 'text-amber-400' },
          { emoji: '🔴', label: 'Pending', count: pendingCount, color: 'text-red-400'   },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-2">
            <span className="text-xs">{l.emoji}</span>
            <span className="text-slate-400 text-xs">{l.label}</span>
            <span className={`text-xs font-bold ml-2 ${l.color}`}>{l.count}</span>
          </div>
        ))}
        {loadingRoads && (
          <div className="flex items-center gap-1.5 pt-1">
            <div className="w-2.5 h-2.5 border border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-xs">Loading roads…</span>
          </div>
        )}
      </div>

      {/* Polygon toggle */}
      <button
        onClick={() => setShowPolygon(!showPolygon)}
        className={`absolute top-4 right-16 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium backdrop-blur transition-colors ${
          showPolygon ? 'bg-blue-600/90 text-white' : 'bg-slate-900/90 text-slate-400'
        }`}
      >
        ⬡ Territory
      </button>

      {/* Live indicator */}
      {liveLocation && (
        <div className="absolute top-4 right-4 bg-blue-600/90 backdrop-blur rounded-xl px-3 py-1.5 z-10 flex items-center gap-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-white text-xs font-medium">Live</span>
        </div>
      )}

      {showSheet && <OutletSheet onClose={() => setShowSheet(false)} />}
    </div>
  )
}
