import { useEffect, useRef, useCallback } from 'react'
import L from 'leaflet'
import { useStore } from '../store/useStore'
import { getDayColor } from '../lib/utils'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const OSRM = 'https://router.project-osrm.org'

async function getRoadPolyline(waypoints: { lat: number; lon: number }[]): Promise<L.LatLngTuple[]> {
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
      } else { chunk.forEach((w) => allPts.push([w.lat, w.lon])) }
    } catch { chunk.forEach((w) => allPts.push([w.lat, w.lon])) }
  }
  return allPts.length > 0 ? allPts : waypoints.map((w) => [w.lat, w.lon] as L.LatLngTuple)
}

const numberedIcon = (n: number, color: string) => L.divIcon({
  className: '',
  html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)">${n}</div>`,
  iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -13],
})

const dotIcon = (color: string, opacity = 1) => L.divIcon({
  className: '',
  html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3);opacity:${opacity}"></div>`,
  iconSize: [10, 10], iconAnchor: [5, 5], popupAnchor: [0, -5],
})

const warehouseIcon = () => L.divIcon({
  className: '',
  html: `<div style="width:36px;height:36px;border-radius:8px;background:#1e293b;color:white;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)">🏭</div>`,
  iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18],
})

export default function MapView() {
  const mapRef         = useRef<L.Map | null>(null)
  const containerRef   = useRef<HTMLDivElement>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const roadLayerRef   = useRef<L.LayerGroup | null>(null)
  const polyLayerRef   = useRef<L.LayerGroup | null>(null)
  const drawnRoadDayRef = useRef<number | null>(null)

  const { outlets, dayRoutes, activeDay, settings, setSelectedOutletId, mode, routePlan } = useStore()

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: [9.03, 38.74], zoom: 12 })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    roadLayerRef.current   = L.layerGroup().addTo(map)
    polyLayerRef.current   = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Draw territory polygon for active day
  const drawPolygon = useCallback(async () => {
    const polyLayer = polyLayerRef.current
    if (!polyLayer) return
    polyLayer.clearLayers()

    if (!activeDay || !routePlan?.id) return

    // Try saved polygon from territory_polygons table first
    const { data } = await (async () => {
      try {
        const { supabase } = await import('../lib/supabase')
        return supabase
          .from('territory_polygons')
          .select('geojson')
          .eq('route_plan_id', routePlan.id)
          .eq('day_number', activeDay)
          .single()
      } catch { return { data: null } }
    })()

    const color = getDayColor(activeDay)

    if (data?.geojson) {
      // Draw saved polygon from DB
      L.geoJSON(data.geojson as GeoJSON.Feature, {
        style: {
          color, fillColor: color, fillOpacity: 0.12,
          weight: 2.5, opacity: 0.8, dashArray: '8,4',
        },
      })
        .bindTooltip(`Day ${activeDay} Territory`, { sticky: true })
        .addTo(polyLayer)
    } else {
      // Fallback: draw convex hull of stops live
      const dr = dayRoutes.find((d) => d.day === activeDay)
      if (!dr || dr.stops.length < 3) return
      const { convexHull } = await import('../lib/utils')
      const hull = convexHull(dr.stops.map((s) => [s.lat, s.lon] as [number, number]))
      if (hull.length < 3) return
      L.polygon(hull.map(([lat, lon]) => [lat, lon] as L.LatLngTuple), {
        color, fillColor: color, fillOpacity: 0.1,
        weight: 2, opacity: 0.6, dashArray: '8,4',
      })
        .bindTooltip(`Day ${activeDay} Area`, { sticky: true })
        .addTo(polyLayer)
    }
  }, [activeDay, routePlan, dayRoutes])

  // Draw road for active day only
  const drawRoadForActiveDay = useCallback(async () => {
    const roadLayer = roadLayerRef.current
    const map       = mapRef.current
    if (!roadLayer || !map || !settings) return
    roadLayer.clearLayers()
    drawnRoadDayRef.current = null
    if (!activeDay) return

    const dr = dayRoutes.find((d) => d.day === activeDay)
    if (!dr || dr.stops.length < 1) return

    const color  = getDayColor(dr.day)
    const wh     = { lat: settings.warehouse_lat, lon: settings.warehouse_lon }
    const waypts = [wh, ...dr.stops.map((s) => ({ lat: s.lat, lon: s.lon })), wh]

    // Placeholder while loading
    const ph = L.polyline(waypts.map((w): L.LatLngTuple => [w.lat, w.lon]), {
      color, weight: 2, opacity: 0.25, dashArray: '6,4',
    }).addTo(roadLayer)

    const roadPts = await getRoadPolyline(waypts)
    ph.remove()
    L.polyline(roadPts, { color, weight: 4, opacity: 0.9 }).addTo(roadLayer)
    drawnRoadDayRef.current = activeDay
  }, [activeDay, dayRoutes, settings])

  // Redraw markers whenever routes/outlets change
  useEffect(() => {
    const map    = mapRef.current
    const layers = markerLayerRef.current
    if (!map || !layers) return
    layers.clearLayers()

    if (settings && (settings.warehouse_lat !== 0 || settings.warehouse_lon !== 0)) {
      L.marker([settings.warehouse_lat, settings.warehouse_lon], { icon: warehouseIcon() })
        .bindPopup(`<b>🏭 ${settings.warehouse_name}</b>`).addTo(layers)
    }

    if (dayRoutes.length === 0) {
      outlets.forEach((o) => {
        L.marker([o.latitude, o.longitude], { icon: dotIcon('#64748b') })
          .bindPopup(`<b>${o.outlet_name}</b>${o.land_mark ? `<br>📍 ${o.land_mark}` : ''}`)
          .addTo(layers)
      })
      if (outlets.length > 0) {
        map.fitBounds(L.latLngBounds(outlets.map((o) => [o.latitude, o.longitude] as L.LatLngTuple)), { padding: [40, 40] })
      }
      return
    }

    dayRoutes.forEach((dr) => {
      const color = getDayColor(dr.day)
      const isAct = !activeDay || activeDay === dr.day
      dr.stops.forEach((stop) => {
        const outlet  = outlets.find((o) => o.id === stop.id)
        const repName = useStore.getState().salesReps.find((r) => r.id === dr.salesRepId)?.name
        L.marker([stop.lat, stop.lon], {
          icon:         isAct && activeDay ? numberedIcon(stop.sequence, color) : dotIcon(color, isAct ? 1 : 0.25),
          zIndexOffset: isAct ? 100 : 0,
        })
          .bindPopup(`
            <div style="min-width:160px">
              <div style="font-weight:600;margin-bottom:4px">${stop.name}</div>
              ${outlet?.land_mark    ? `<div style="color:#64748b;font-size:12px">📍 ${outlet.land_mark}</div>`    : ''}
              ${outlet?.phone_number ? `<div style="color:#64748b;font-size:12px">📞 ${outlet.phone_number}</div>` : ''}
              <div style="color:#64748b;font-size:12px;margin-top:4px">Day ${dr.day} · Stop #${stop.sequence}${repName ? ` · ${repName}` : ''}</div>
              <button onclick="window.__selectOutlet('${stop.id}')"
                style="margin-top:8px;width:100%;padding:4px 0;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">
                Move to another day
              </button>
            </div>
          `)
          .addTo(layers)
      })
    })

    // Fit to active day
    if (activeDay) {
      const act = dayRoutes.find((d) => d.day === activeDay)
      if (act?.stops.length) {
        map.fitBounds(L.latLngBounds(act.stops.map((s) => [s.lat, s.lon] as L.LatLngTuple)), { padding: [60, 60] })
      }
    }
  }, [outlets, dayRoutes, activeDay, settings, mode])

  // Draw road + polygon when active day changes
  useEffect(() => {
    if (activeDay !== drawnRoadDayRef.current) {
      drawRoadForActiveDay()
    }
    drawPolygon()
  }, [activeDay, drawRoadForActiveDay, drawPolygon])

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__selectOutlet = (id: string) => setSelectedOutletId(id)
    return () => { delete (window as unknown as Record<string, unknown>).__selectOutlet }
  }, [setSelectedOutletId])

  return <div ref={containerRef} className="flex-1 h-full" />
}
