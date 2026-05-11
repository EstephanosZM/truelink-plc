import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { supabase } from '../lib/supabase'

interface RepLocation {
  sales_rep_id: string
  latitude: number
  longitude: number
  recorded_at: string
  sales_representatives: { name: string }
}

export default function LiveMapPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const layersRef    = useRef<L.LayerGroup | null>(null)
  const [locations,  setLocations]  = useState<RepLocation[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: [9.03, 38.74], zoom: 12 })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19
    }).addTo(map)
    layersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  const fetchLocations = async () => {
    // Get most recent location per rep
    const { data } = await supabase
      .from('rep_locations')
      .select('sales_rep_id, latitude, longitude, recorded_at, sales_representatives(name)')
      .order('recorded_at', { ascending: false })
      .limit(50)

    if (!data) return

    // Dedupe — keep only latest per rep
    const seen = new Set<string>()
    const latest = data.filter((l: RepLocation) => {
      if (seen.has(l.sales_rep_id)) return false
      seen.add(l.sales_rep_id)
      return true
    })

    setLocations(latest)
    setLastUpdate(new Date())
    drawMarkers(latest)
  }

  const drawMarkers = (locs: RepLocation[]) => {
    const layers = layersRef.current
    if (!layers) return
    layers.clearLayers()

    locs.forEach((loc, i) => {
      const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4']
      const color  = colors[i % colors.length]
      const name   = loc.sales_representatives?.name || 'Rep'
      const mins   = Math.round((Date.now() - new Date(loc.recorded_at).getTime()) / 60000)
      const ago    = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins/60)}h ago`
      const isRecent = mins < 5

      const icon = L.divIcon({
        className: '',
        html: `
          <div style="position:relative">
            ${isRecent ? `<div style="position:absolute;top:-4px;left:-4px;width:32px;height:32px;border-radius:50%;background:${color};opacity:0.3;animation:pulse 2s infinite"></div>` : ''}
            <div style="
              width:24px;height:24px;border-radius:50%;
              background:${color};color:white;
              display:flex;align-items:center;justify-content:center;
              font-weight:700;font-size:10px;
              border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);
              position:relative;z-index:1
            ">${name.charAt(0).toUpperCase()}</div>
          </div>
        `,
        iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12],
      })

      L.marker([loc.latitude, loc.longitude], { icon })
        .bindPopup(`
          <div style="min-width:140px">
            <div style="font-weight:600;margin-bottom:4px">${name}</div>
            <div style="color:#64748b;font-size:12px">Last seen: ${ago}</div>
            <div style="color:#64748b;font-size:11px;margin-top:2px">
              ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}
            </div>
          </div>
        `)
        .addTo(layers!)
    })
  }

  useEffect(() => {
    fetchLocations()
    const interval = setInterval(fetchLocations, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex-1 flex flex-col">
      {/* Header bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-sm font-medium text-slate-700">Live Rep Locations</span>
          <span className="text-xs text-slate-400">Auto-refreshes every 30s</span>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchLocations}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Rep list sidebar + map */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 bg-white border-r border-slate-200 overflow-y-auto shrink-0">
          <div className="p-3 space-y-1">
            {locations.map((loc, i) => {
              const colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4']
              const color  = colors[i % colors.length]
              const name   = loc.sales_representatives?.name || 'Rep'
              const mins   = Math.round((Date.now() - new Date(loc.recorded_at).getTime()) / 60000)
              const isRecent = mins < 5
              return (
                <button key={loc.sales_rep_id}
                  onClick={() => mapRef.current?.setView([loc.latitude, loc.longitude], 15)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 text-left transition-colors">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white text-sm font-bold"
                    style={{ backgroundColor: color }}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{name}</p>
                    <p className={`text-xs ${isRecent ? 'text-green-600' : 'text-slate-400'}`}>
                      {isRecent ? '🟢 Active' : `${mins}m ago`}
                    </p>
                  </div>
                </button>
              )
            })}
            {locations.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8">No reps active</p>
            )}
          </div>
        </div>

        {/* Map */}
        <div ref={containerRef} className="flex-1" />
      </div>
    </div>
  )
}
