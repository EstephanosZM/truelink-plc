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

// Fetch road geometry between two points
async function getSegmentGeometry(
  from: { lat: number; lon: number },
  to:   { lat: number; lon: number }
): Promise<L.LatLngTuple[]> {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`
  const url    = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`
  try {
    const res  = await fetch(url)
    const data = await res.json()
    if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates.map(
        ([lon, lat]: [number, number]) => [lat, lon] as L.LatLngTuple
      )
    }
  } catch { /* fallback below */ }
  return [[from.lat, from.lon], [to.lat, to.lon]]
}

// Animate a polyline drawing itself segment by segment
function animatePolyline(
  map: L.Map,
  points: L.LatLngTuple[],
  color: string,
  onDone?: () => void
): () => void {
  let cancelled  = false
  let frameId: number
  const drawn: L.LatLngTuple[] = [points[0]]

  // Background ghost line (full route, faint)
  const ghost = L.polyline(points, {
    color,
    weight:    3,
    opacity:   0.15,
    dashArray: '6,6',
  }).addTo(map)

  // Animated foreground line
  const line = L.polyline([points[0]], {
    color,
    weight:  4,
    opacity: 0.95,
  }).addTo(map)

  // Moving dot at the head of the line
  const dot = L.circleMarker(points[0], {
    radius:      7,
    color:       'white',
    fillColor:   color,
    fillOpacity: 1,
    weight:      2,
  }).addTo(map)

  let pointIndex = 1
  const SPEED    = 0.008  // fraction of segment per frame (adjust for speed)

  let segProgress = 0

  const step = () => {
    if (cancelled) return
    if (pointIndex >= points.length) {
      dot.remove()
      if (onDone) onDone()
      return
    }

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
      // Interpolate between from and to
      const lat = from[0] + (to[0] - from[0]) * segProgress
      const lon = from[1] + (to[1] - from[1]) * segProgress
      const current: L.LatLngTuple = [lat, lon]
      line.setLatLngs([...drawn, current])
      dot.setLatLng(current)
    }

    frameId = requestAnimationFrame(step)
  }

  frameId = requestAnimationFrame(step)

  // Return cancel function
  return () => {
    cancelled = true
    cancelAnimationFrame(frameId)
    ghost.remove()
    line.remove()
    dot.remove()
  }
}

const numberedIcon = (n: number, color: string, isNext = false) => L.divIcon({
  className: '',
  html: `<div style="
    width:${isNext ? 32 : 26}px;
    height:${isNext ? 32 : 26}px;
    border-radius:50%;
    background:${color};
    color:white;
    display:flex;align-items:center;justify-content:center;
    font-weight:700;
    font-size:${isNext ? 12 : 10}px;
    border:${isNext ? 3 : 2}px solid white;
    box-shadow:0 ${isNext ? 3 : 1}px ${isNext ? 8 : 4}px rgba(0,0,0,${isNext ? 0.5 : 0.35});
    transition:all 0.3s;
    ${isNext ? `animation: pulse-ring 1.5s infinite;` : ''}
  ">${n}</div>
  <style>
    @keyframes pulse-ring {
      0%   { box-shadow: 0 0 0 0 ${color}88; }
      70%  { box-shadow: 0 0 0 8px ${color}00; }
      100% { box-shadow: 0 0 0 0 ${color}00; }
    }
  </style>`,
  iconSize:    [isNext ? 32 : 26, isNext ? 32 : 26],
  iconAnchor:  [isNext ? 16 : 13, isNext ? 16 : 13],
  popupAnchor: [0, -13],
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
  const mapRef        = useRef<L.Map | null>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const layersRef     = useRef<L.LayerGroup | null>(null)
  const cancelAnimRef = useRef<(() => void) | null>(null)

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

    // Cancel any running animation
    if (cancelAnimRef.current) { cancelAnimRef.current(); cancelAnimRef.current = null }
    layers.clearLayers()

    // Warehouse
    if (settings && (settings.warehouse_lat !== 0 || settings.warehouse_lon !== 0)) {
      L.marker([settings.warehouse_lat, settings.warehouse_lon], { icon: warehouseIcon() })
        .bindPopup(`<b>🏭 ${settings.warehouse_name}</b>`)
        .addTo(layers)
    }

    // No routes — outlet dots only
    if (dayRoutes.length === 0) {
      outlets.forEach((o) => {
        L.marker([o.latitude, o.longitude], { icon: dotIcon('#64748b') })
          .bindPopup(`
            <b>${o.outlet_name}</b>
            ${o.land_mark    ? `<br>📍 ${o.land_mark}`    : ''}
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

    // Non-active days — static dashed lines
    dayRoutes
      .filter((dr) => !activeDay || dr.day !== activeDay)
      .forEach((dr) => {
        const color = getDayColor(dr.day)
        if (dr.stops.length > 0 && settings) {
          const pts = [
            [settings.warehouse_lat, settings.warehouse_lon] as L.LatLngTuple,
            ...dr.stops.map((s): L.LatLngTuple => [s.lat, s.lon]),
            [settings.warehouse_lat, settings.warehouse_lon] as L.LatLngTuple,
          ]
          L.polyline(pts, { color, weight: 1.5, opacity: 0.2, dashArray: '5,5' }).addTo(layers)
        }
        dr.stops.forEach((stop) => {
          L.marker([stop.lat, stop.lon], { icon: dotIcon(color), opacity: 0.3 }).addTo(layers)
        })
      })

    // Active day — animated road route
    if (activeDay) {
      const dr = dayRoutes.find((d) => d.day === activeDay)
      if (!dr || !settings) return

      const color = getDayColor(dr.day)

      // Place stop markers immediately (before animation)
      dr.stops.forEach((stop, i) => {
        const outlet  = outlets.find((o) => o.id === stop.id)
        const repName = useStore.getState().salesReps.find((r) => r.id === dr.salesRepId)?.name
        const isFirst = i === 0

        L.marker([stop.lat, stop.lon], {
          icon:    numberedIcon(stop.sequence, color, isFirst),
          zIndexOffset: isFirst ? 1000 : 0,
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

      // Fit map first
      const bounds = L.latLngBounds(dr.stops.map((s) => [s.lat, s.lon] as L.LatLngTuple))
      map.fitBounds(bounds, { padding: [60, 60] })

      // Fetch all road segments then animate
      const fetchAndAnimate = async () => {
        const wh = { lat: settings.warehouse_lat, lon: settings.warehouse_lon }
        const waypoints = [wh, ...dr.stops.map((s) => ({ lat: s.lat, lon: s.lon })), wh]

        // Fetch all segments in parallel
        const segmentPromises = waypoints.slice(0, -1).map((from, i) =>
          getSegmentGeometry(from, waypoints[i + 1])
        )
        const segments = await Promise.all(segmentPromises)

        // Stitch all segments into one point array
        const allPoints: L.LatLngTuple[] = []
        segments.forEach((seg, i) => {
          if (i === 0) allPoints.push(...seg)
          else { seg.shift(); allPoints.push(...seg) } // avoid duplicate junction
        })

        if (cancelAnimRef.current) return // component unmounted or day changed

        // Animate the full stitched route
        cancelAnimRef.current = animatePolyline(map, allPoints, color)
      }

      fetchAndAnimate()
    }

    // Draw territory polygons
    if (mode === 'draw') {
      dayRoutes.forEach((dr) => {
        if (dr.stops.length < 3) return
        const color = getDayColor(dr.day)
        L.polygon(dr.stops.map((s) => [s.lat, s.lon] as L.LatLngTuple), {
          color, fillColor: color, fillOpacity: 0.12, weight: 2,
          opacity: !activeDay || activeDay === dr.day ? 0.7 : 0.2,
        }).bindTooltip(`Day ${dr.day}`).addTo(layers)
      })
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

  // Cleanup animation on unmount
  useEffect(() => {
    return () => { if (cancelAnimRef.current) cancelAnimRef.current() }
  }, [])

  return <div ref={containerRef} className="flex-1 h-full" />
}
