import { useEffect, useRef } from 'react'
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

// Fetch road geometry from OSRM for a list of waypoints
async function getRoadGeometry(
  waypoints: { lat: number; lon: number }[]
): Promise<L.LatLngTuple[]> {
  if (waypoints.length < 2) return waypoints.map((w) => [w.lat, w.lon])

  // OSRM allows max ~100 waypoints per request
  // For large routes split into chunks and stitch
  const CHUNK = 25
  const allPoints: L.LatLngTuple[] = []

  for (let i = 0; i < waypoints.length - 1; i += CHUNK - 1) {
    const chunk = waypoints.slice(i, i + CHUNK)
    const coords = chunk.map((w) => `${w.lon},${w.lat}`).join(';')
    const url = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`

    try {
      const res  = await fetch(url)
      const data = await res.json()
      if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
        const pts = data.routes[0].geometry.coordinates.map(
          ([lon, lat]: [number, number]) => [lat, lon] as L.LatLngTuple
        )
        // Avoid duplicating junction point between chunks
        if (allPoints.length > 0 && pts.length > 0) pts.shift()
        allPoints.push(...pts)
      } else {
        // Fallback: straight line for this chunk
        chunk.forEach((w) => allPoints.push([w.lat, w.lon]))
      }
    } catch {
      // Fallback: straight line
      chunk.forEach((w) => allPoints.push([w.lat, w.lon]))
    }
  }

  return allPoints.length > 0
    ? allPoints
    : waypoints.map((w) => [w.lat, w.lon])
}

const numberedIcon = (n: number, color: string) => L.divIcon({
  className: '',
  html: `<div style="
    width:26px;height:26px;border-radius:50%;
    background:${color};color:white;
    display:flex;align-items:center;justify-content:center;
    font-weight:700;font-size:10px;
    border:2px solid white;
    box-shadow:0 1px 4px rgba(0,0,0,.35)
  ">${n}</div>`,
  iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -13],
})

const dotIcon = (color: string) => L.divIcon({
  className: '',
  html: `<div style="
    width:10px;height:10px;border-radius:50%;
    background:${color};border:2px solid white;
    box-shadow:0 1px 3px rgba(0,0,0,.3)
  "></div>`,
  iconSize: [10, 10], iconAnchor: [5, 5], popupAnchor: [0, -5],
})

const warehouseIcon = () => L.divIcon({
  className: '',
  html: `<div style="
    width:36px;height:36px;border-radius:8px;
    background:#1e293b;color:white;
    display:flex;align-items:center;justify-content:center;
    font-size:18px;border:2px solid white;
    box-shadow:0 2px 6px rgba(0,0,0,.4)
  ">🏭</div>`,
  iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18],
})

export default function MapView() {
  const mapRef       = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const layersRef    = useRef<L.LayerGroup | null>(null)

  const { outlets, dayRoutes, activeDay, settings, setSelectedOutletId, mode } = useStore()

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: [9.03, 38.74], zoom: 12 })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(map)
    layersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Redraw when state changes
  useEffect(() => {
    const map    = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) return

    layers.clearLayers()

    // Warehouse marker
    if (settings && (settings.warehouse_lat !== 0 || settings.warehouse_lon !== 0)) {
      L.marker([settings.warehouse_lat, settings.warehouse_lon], { icon: warehouseIcon() })
        .bindPopup(`<b>🏭 ${settings.warehouse_name}</b>`)
        .addTo(layers)
    }

    // No routes — show all outlet dots
    if (dayRoutes.length === 0) {
      outlets.forEach((o) => {
        L.marker([o.latitude, o.longitude], { icon: dotIcon('#64748b') })
          .bindPopup(`
            <b>${o.outlet_name}</b>
            ${o.land_mark ? `<br>📍 ${o.land_mark}` : ''}
            ${o.phone_number ? `<br>📞 ${o.phone_number}` : ''}
          `)
          .addTo(layers)
      })
      if (outlets.length > 0) {
        map.fitBounds(
          L.latLngBounds(outlets.map((o) => [o.latitude, o.longitude] as L.LatLngTuple)),
          { padding: [40, 40] }
        )
      }
      return
    }

    // Draw routes
    const daysToShow = activeDay
      ? dayRoutes.filter((d) => d.day === activeDay)
      : dayRoutes

    daysToShow.forEach(async (dr) => {
      const color   = getDayColor(dr.day)
      const isAct   = !activeDay || activeDay === dr.day
      const opacity = isAct ? 1 : 0.2

      // Build waypoints: warehouse → stops → warehouse
      if (dr.stops.length > 0 && settings) {
        const wh = { lat: settings.warehouse_lat, lon: settings.warehouse_lon }
        const waypoints = [
          wh,
          ...dr.stops.map((s) => ({ lat: s.lat, lon: s.lon })),
          wh,
        ]

        if (isAct && activeDay) {
          // Active day — fetch real road geometry from OSRM
          const roadPts = await getRoadGeometry(waypoints)
          L.polyline(roadPts, {
            color,
            weight:    4,
            opacity:   0.9,
          }).addTo(layers)
        } else {
          // Non-active days — straight dashed line (saves OSRM calls)
          const straightPts = waypoints.map((w): L.LatLngTuple => [w.lat, w.lon])
          L.polyline(straightPts, {
            color,
            weight:    2,
            opacity:   0.25,
            dashArray: '6,4',
          }).addTo(layers)
        }
      }

      // Stop markers
      dr.stops.forEach((stop) => {
        const outlet = outlets.find((o) => o.id === stop.id)
        const repName = useStore.getState().salesReps.find(
          (r) => r.id === dr.salesRepId
        )?.name

        L.marker([stop.lat, stop.lon], {
          icon:    isAct && activeDay ? numberedIcon(stop.sequence, color) : dotIcon(color),
          opacity,
        })
          .bindPopup(`
            <div style="min-width:160px">
              <div style="font-weight:600;margin-bottom:4px">${stop.name}</div>
              ${outlet?.land_mark    ? `<div style="color:#64748b;font-size:12px">📍 ${outlet.land_mark}</div>`    : ''}
              ${outlet?.phone_number ? `<div style="color:#64748b;font-size:12px">📞 ${outlet.phone_number}</div>` : ''}
              <div style="color:#64748b;font-size:12px;margin-top:4px">
                Day ${dr.day} · Stop #${stop.sequence}${repName ? ` · ${repName}` : ''}
              </div>
              <button
                onclick="window.__selectOutlet('${stop.id}')"
                style="margin-top:8px;width:100%;padding:4px 0;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px"
              >Move to another day</button>
            </div>
          `)
          .addTo(layers)
      })
    })

    // Draw territory polygons
    if (mode === 'draw') {
      dayRoutes.forEach((dr) => {
        if (dr.stops.length < 3) return
        const color = getDayColor(dr.day)
        L.polygon(dr.stops.map((s) => [s.lat, s.lon] as L.LatLngTuple), {
          color,
          fillColor:   color,
          fillOpacity: 0.12,
          weight:      2,
          opacity:     !activeDay || activeDay === dr.day ? 0.7 : 0.2,
        })
          .bindTooltip(`Day ${dr.day}`)
          .addTo(layers)
      })
    }

    // Fit map to active day
    if (activeDay) {
      const act = dayRoutes.find((d) => d.day === activeDay)
      if (act?.stops.length) {
        map.fitBounds(
          L.latLngBounds(act.stops.map((s) => [s.lat, s.lon] as L.LatLngTuple)),
          { padding: [60, 60] }
        )
      }
    }
  }, [outlets, dayRoutes, activeDay, settings, mode])

  // Expose outlet select to popup button
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__selectOutlet =
      (id: string) => setSelectedOutletId(id)
    return () => {
      delete (window as unknown as Record<string, unknown>).__selectOutlet
    }
  }, [setSelectedOutletId])

  return <div ref={containerRef} className="flex-1 h-full" />
}
