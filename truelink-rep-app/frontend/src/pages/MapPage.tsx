import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { useRepStore } from '../store/useRepStore'
import OutletSheet from '../components/OutletSheet'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const statusColor = (status?: string) => {
  if (status === 'sold')    return '#22c55e'
  if (status === 'no_sale') return '#f59e0b'
  if (status === 'closed')  return '#6b7280'
  return '#ef4444'
}

const statusEmoji = (status?: string) => {
  if (status === 'sold')    return '✅'
  if (status === 'no_sale') return '🟡'
  if (status === 'closed')  return '⚫'
  return '🔴'
}

export default function MapPage() {
  const { todayStops, liveLocation, setActiveOutletId, setPage } = useRepStore()
  const mapRef       = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const layersRef    = useRef<L.LayerGroup | null>(null)
  const liveRef      = useRef<L.CircleMarker | null>(null)
  const [showSheet, setShowSheet] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: [9.03, 38.74], zoom: 13, zoomControl: false })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    layersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Draw stops
  useEffect(() => {
    const map = mapRef.current; const layers = layersRef.current
    if (!map || !layers) return
    layers.clearLayers()

    if (todayStops.length > 0) {
      // Route polyline
      const pts = todayStops.map((s): L.LatLngTuple => [s.outlet.latitude, s.outlet.longitude])
      L.polyline(pts, { color: '#3b82f6', weight: 2, opacity: 0.5, dashArray: '6,4' }).addTo(layers)

      todayStops.forEach((stop) => {
        const color = statusColor(stop.visit?.visit_status)
        const icon  = L.divIcon({
          className: '',
          html: `<div style="
            width:32px;height:32px;border-radius:50%;
            background:${color};color:white;
            display:flex;align-items:center;justify-content:center;
            font-weight:700;font-size:11px;
            border:2px solid white;
            box-shadow:0 2px 6px rgba(0,0,0,.4)
          ">${stop.sequence}</div>`,
          iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -16],
        })
        L.marker([stop.outlet.latitude, stop.outlet.longitude], { icon })
          .on('click', () => {
            setActiveOutletId(stop.outlet_id)
            setShowSheet(true)
          })
          .addTo(layers)
      })

      // Fit map
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] })
    }
  }, [todayStops])

  // Live location dot
  useEffect(() => {
    const map = mapRef.current
    if (!map || !liveLocation) return
    if (liveRef.current) liveRef.current.remove()
    const dot = L.circleMarker([liveLocation.lat, liveLocation.lon], {
      radius: 10, color: '#3b82f6', fillColor: '#60a5fa',
      fillOpacity: 1, weight: 3,
    }).addTo(map)
    // Pulsing ring
    L.circleMarker([liveLocation.lat, liveLocation.lon], {
      radius: 20, color: '#3b82f6', fillColor: 'transparent',
      opacity: 0.4, weight: 2,
    }).addTo(map)
    liveRef.current = dot
  }, [liveLocation])

  // Legend counts
  const soldCount    = todayStops.filter((s) => s.visit?.visit_status === 'sold').length
  const noSaleCount  = todayStops.filter((s) => s.visit?.visit_status === 'no_sale').length
  const pendingCount = todayStops.filter((s) => !s.visit || s.visit.visit_status === 'not_visited').length

  return (
    <div className="flex-1 relative">
      <div ref={containerRef} className="w-full h-full" />

      {/* Legend overlay */}
      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur rounded-xl px-3 py-2 space-y-1 z-10">
        {[
          { emoji: '✅', label: 'Sold',       count: soldCount,    color: 'text-green-400' },
          { emoji: '🟡', label: 'No sale',    count: noSaleCount,  color: 'text-amber-400' },
          { emoji: '🔴', label: 'Pending',    count: pendingCount, color: 'text-red-400'   },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-2">
            <span className="text-xs">{l.emoji}</span>
            <span className="text-slate-400 text-xs">{l.label}</span>
            <span className={`text-xs font-bold ml-auto ${l.color}`}>{l.count}</span>
          </div>
        ))}
      </div>

      {/* Live location indicator */}
      {liveLocation && (
        <div className="absolute top-4 right-4 bg-blue-600/90 backdrop-blur rounded-xl px-3 py-1.5 z-10 flex items-center gap-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <span className="text-white text-xs font-medium">Live</span>
        </div>
      )}

      {showSheet && (
        <OutletSheet onClose={() => setShowSheet(false)} />
      )}
    </div>
  )
}
