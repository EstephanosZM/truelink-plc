import { useEffect, useRef, useState } from 'react'
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

async function getSegmentGeometry(
  from: { lat: number; lon: number },
  to:   { lat: number; lon: number }
): Promise<L.LatLngTuple[]> {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`
  try {
    const res  = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`)
    const data = await res.json()
    if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates.map(
        ([lon, lat]: [number, number]) => [lat, lon] as L.LatLngTuple
      )
    }
  } catch { /* fallback */ }
  return [[from.lat, from.lon], [to.lat, to.lon]]
}

function animateRoute(
  map: L.Map,
  points: L.LatLngTuple[],
  color: string
): () => void {
  let cancelled = false
  let frameId: number

  const ghost = L.polyline(points, {
    color, weight: 3, opacity: 0.15, dashArray: '6,6',
  }).addTo(map)

  const line = L.polyline([points[0]], {
    color, weight: 4, opacity: 0.95,
  }).addTo(map)

  const dot = L.circleMarker(points[0], {
    radius: 7, color: 'white', fillColor: color,
    fillOpacity: 1, weight: 2,
  }).addTo(map)

  const drawn: L.LatLngTuple[] = [points[0]]
  let pointIndex = 1
  let segProgress = 0
  const SPEED = 0.006

  const step = () => {
    if (cancelled) return
    if (pointIndex >= points.length) { dot.remove(); return }

    const from = points[pointIndex - 1]
    const to   = points[pointIndex]
    segProgress += SPEED

    if (segProgress >= 1) {
      segProgress = 0
      drawn.push(to)
      line.setLatLngs(drawn)
      dot.setLatLng(to)
      pointIndex++
    } else {
      const lat = from[0] + (to[0] - from[0]) * segProgress
      const lon = from[1] + (to[1] - from[1]) * segProgress
      line.setLatLngs([...drawn, [lat, lon]])
      dot.setLatLng([lat, lon])
    }
    frameId = requestAnimationFrame(step)
  }
  frameId = requestAnimationFrame(step)

  return () => {
    cancelled = true
    cancelAnimationFrame(frameId)
    ghost.remove()
    line.remove()
    dot.remove()
  }
}

const statusColor = (status?: string) => {
  if (status === 'sold')    return '#22c55e'
  if (status === 'no_sale') return '#f59e0b'
  if (status === 'closed')  return '#6b7280'
  return '#ef4444'
}

// Day colors matching the manager app
const DAY_COLORS = [
  '#e6194b','#3cb44b','#4363d8','#f58231','#911eb4',
  '#42d4f4','#f032e6','#bfef45','#469990','#dcbeff',
]
const getDayColor = (day: number) => DAY_COLORS[(day - 1) % DAY_COLORS.length]

export default function MapPage() {
  const {
    todayStops, liveLocation, routePlanId, dayNumber,
    setActiveOutletId, activeRep,
  } = useRepStore()

  const mapRef        = useRef<L.Map | null>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const layersRef     = useRef<L.LayerGroup | null>(null)
  const polyLayerRef  = useRef<L.LayerGroup | null>(null)
  const liveRef       = useRef<L.CircleMarker | null>(null)
  const cancelAnimRef = useRef<(() => void) | null>(null)

  const [showSheet,      setShowSheet]      = useState(false)
  const [showPolygons,   setShowPolygons]   = useState(true)
  const [loadingPolygon, setLoadingPolygon] = useState(false)

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [9.03, 38.74], zoom: 13, zoomControl: false,
    })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    layersRef.current  = L.layerGroup().addTo(map)
    polyLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Load and draw territory polygon
  useEffect(() => {
    const map       = mapRef.current
    const polyLayer = polyLayerRef.current
    if (!map || !polyLayer || !routePlanId || !dayNumber) return

    polyLayer.clearLayers()
    if (!showPolygons) return

    const loadPolygon = async () => {
      setLoadingPolygon(true)
      const { data } = await supabase
        .from('territory_polygons')
        .select('geojson, day_number')
        .eq('route_plan_id', routePlanId)
        .eq('day_number', dayNumber)
        .single()

      setLoadingPolygon(false)
      if (!data?.geojson) return

      const color = getDayColor(dayNumber)

      // Draw filled polygon
      L.geoJSON(data.geojson as GeoJSON.Feature, {
        style: {
          color:       color,
          fillColor:   color,
          fillOpacity: 0.12,
          weight:      2.5,
          opacity:     0.8,
          dashArray:   '8,4',
        },
      })
        .bindTooltip(`Day ${dayNumber} Territory`, { permanent: false })
        .addTo(polyLayer)

      // Also draw a brighter border so it's visible on dark map
      L.geoJSON(data.geojson as GeoJSON.Feature, {
        style: {
          color:       color,
          fillColor:   'transparent',
          fillOpacity: 0,
          weight:      3,
          opacity:     0.6,
        },
      }).addTo(polyLayer)
    }

    loadPolygon()
  }, [routePlanId, dayNumber, showPolygons])

  // Draw stops and animate route
  useEffect(() => {
    const map    = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) return

    if (cancelAnimRef.current) { cancelAnimRef.current(); cancelAnimRef.current = null }
    layers.clearLayers()

    if (todayStops.length === 0) return

    const color = getDayColor(dayNumber || 1)

    // Place markers
    todayStops.forEach((stop, i) => {
      const sc   = statusColor(stop.visit?.visit_status)
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:${i === 0 ? 32 : 26}px;
          height:${i === 0 ? 32 : 26}px;
          border-radius:50%;
          background:${sc};
          color:white;
          display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:${i === 0 ? 12 : 10}px;
          border:2px solid white;
          box-shadow:0 2px 6px rgba(0,0,0,.4);
          ${!stop.visit || stop.visit.visit_status === 'not_visited'
            ? `animation:pulse-stop 2s infinite;` : ''}
        ">${stop.sequence}</div>
        <style>
          @keyframes pulse-stop {
            0%,100% { transform:scale(1); }
            50%      { transform:scale(1.15); }
          }
        </style>`,
        iconSize:    [i === 0 ? 32 : 26, i === 0 ? 32 : 26],
        iconAnchor:  [i === 0 ? 16 : 13, i === 0 ? 16 : 13],
        popupAnchor: [0, -16],
      })

      L.marker([stop.outlet.latitude, stop.outlet.longitude], { icon })
        .on('click', () => { setActiveOutletId(stop.outlet_id); setShowSheet(true) })
        .addTo(layers)
    })

    // Fit map to stops + polygon area
    const bounds = L.latLngBounds(
      todayStops.map((s) => [s.outlet.latitude, s.outlet.longitude] as L.LatLngTuple)
    )
    map.fitBounds(bounds, { padding: [50, 50] })

    // Animate route along roads
    const fetchAndAnimate = async () => {
      const waypoints = todayStops.map((s) => ({
        lat: s.outlet.latitude, lon: s.outlet.longitude,
      }))

      // Add warehouse-like start/end if we have settings
      const allWaypoints = waypoints

      const segPromises = allWaypoints.slice(0, -1).map((from, i) =>
        getSegmentGeometry(from, allWaypoints[i + 1])
      )
      const segments = await Promise.all(segPromises)

      const allPoints: L.LatLngTuple[] = []
      segments.forEach((seg, i) => {
        if (i === 0) allPoints.push(...seg)
        else { seg.shift(); allPoints.push(...seg) }
      })

      if (!cancelAnimRef.current && allPoints.length > 1) {
        cancelAnimRef.current = animateRoute(map, allPoints, color)
      }
    }

    fetchAndAnimate()
  }, [todayStops, dayNumber])

  // Live location dot
  useEffect(() => {
    const map = mapRef.current
    if (!map || !liveLocation) return
    if (liveRef.current) liveRef.current.remove()

    // Outer pulse ring
    L.circleMarker([liveLocation.lat, liveLocation.lon], {
      radius: 18, color: '#3b82f6', fillColor: 'transparent',
      opacity: 0.3, weight: 2,
    }).addTo(map)

    // Inner dot
    liveRef.current = L.circleMarker([liveLocation.lat, liveLocation.lon], {
      radius: 9, color: '#3b82f6', fillColor: '#60a5fa',
      fillOpacity: 1, weight: 3,
    }).bindTooltip('You are here', { permanent: false }).addTo(map)
  }, [liveLocation])

  // Cleanup
  useEffect(() => {
    return () => { if (cancelAnimRef.current) cancelAnimRef.current() }
  }, [])

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
            <span className={`text-xs font-bold ml-auto ${l.color}`}>{l.count}</span>
          </div>
        ))}
      </div>

      {/* Territory toggle */}
      <div className="absolute top-4 right-16 z-10">
        <button
          onClick={() => setShowPolygons(!showPolygons)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium backdrop-blur transition-colors ${
            showPolygons
              ? 'bg-blue-600/90 text-white'
              : 'bg-slate-900/90 text-slate-400'
          }`}
        >
          {loadingPolygon ? (
            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <span>⬡</span>
          )}
          Territory
        </button>
      </div>

      {/* Live indicator */}
      {liveLocation && (
        <div className="absolute top-4 right-4 bg-blue-600/90 backdrop-blur rounded-xl px-3 py-1.5 z-10 flex items-center gap-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-white text-xs font-medium">Live</span>
        </div>
      )}

      {/* No polygon warning */}
      {showPolygons && !loadingPolygon && routePlanId && (
        <div className="absolute bottom-24 left-4 right-4 z-10">
          {/* Only show if we know there's no polygon — handled by supabase returning null */}
        </div>
      )}

      {showSheet && <OutletSheet onClose={() => setShowSheet(false)} />}
    </div>
  )
}
