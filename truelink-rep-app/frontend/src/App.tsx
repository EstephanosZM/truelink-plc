import { useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { useRepStore } from './store/useRepStore'
import { today } from './lib/utils'
import LoginPage from './pages/LoginPage'
import HomePage  from './pages/HomePage'
import MapPage   from './pages/MapPage'
import ListPage  from './pages/ListPage'
import StockPage from './pages/StockPage'
import BottomNav from './components/BottomNav'
import { DayStop } from './types'

export default function App() {
  const {
    isAuthenticated, setAuthenticated,
    activeRep, setAllReps,
    setTodayStops, setRouteInfo,
    setStockLoads, setProducts,
    setReasons, setLiveLocation,
    setProximityRadius,
    page, darkMode,
  } = useRepStore()

  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { setAuthenticated(true); loadReps() }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) { setAuthenticated(true); loadReps() }
      else setAuthenticated(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadReps = async () => {
    const { data } = await supabase.from('sales_representatives').select('*').order('name')
    if (data) setAllReps(data)
  }

  useEffect(() => {
    if (!activeRep) return
    bootstrapRepData()
    startGPSTracking()
    return () => stopGPSTracking()
  }, [activeRep])

  const bootstrapRepData = async () => {
    if (!activeRep) return
    const todayStr = today()

    // Load products
    const { data: prods } = await supabase.from('products').select('*').eq('status', 'active')
    if (prods) setProducts(prods)

    // Load non-sale reasons
    const { data: rsns } = await supabase
      .from('non_sale_reasons').select('*').eq('is_active', true).order('reason')
    if (rsns) setReasons(rsns)

    // Load stock for today
    const { data: stock } = await supabase.from('stock_loads')
      .select('*').eq('sales_rep_id', activeRep.id).eq('load_date', todayStr)
    if (stock) setStockLoads(stock)

    // ── Load proximity radius from admin settings ──────────
    // Use the rep's territory if set, otherwise fallback to 100m
    if (activeRep.territory_id) {
      const { data: ps } = await supabase
        .from('proximity_settings')
        .select('radius_meters')
        .eq('territory_id', activeRep.territory_id)
        .single()
      if (ps?.radius_meters) {
        setProximityRadius(ps.radius_meters)
      }
    }

    // ── Find today's route ─────────────────────────────────
    const { data: stops } = await supabase
      .from('route_stops')
      .select(`*, route_plans!inner(id, territory_id, generated_at, n_days, status)`)
      .eq('sales_rep_id', activeRep.id)
      .eq('route_date', todayStr)
      .eq('route_plans.status', 'saved')
      .order('sequence')

    if (!stops || stops.length === 0) {
      console.log('No route assigned for today:', todayStr)
      return
    }

    // Use the most recently generated plan
    const sorted = stops.sort((
      a: { route_plans: { generated_at: string } },
      b: { route_plans: { generated_at: string } }
    ) => new Date(b.route_plans.generated_at).getTime() - new Date(a.route_plans.generated_at).getTime())

    const planId = sorted[0].route_plan_id
    const dayNum = sorted[0].day_number
    setRouteInfo(planId, dayNum)

    const outletIds = sorted.map((s: { outlet_id: string }) => s.outlet_id)
    const { data: outlets } = await supabase.from('outlets').select('*').in('id', outletIds)

    const { data: visits } = await supabase.from('outlet_visits')
      .select('*').eq('route_plan_id', planId).eq('day_number', dayNum).eq('sales_rep_id', activeRep.id)

    const { data: sales } = await supabase.from('sales_records')
      .select('*').eq('route_plan_id', planId).eq('day_number', dayNum).eq('sales_rep_id', activeRep.id)

    const dayStops: DayStop[] = sorted
      .filter((s: { route_plan_id: string; day_number: number }) =>
        s.route_plan_id === planId && s.day_number === dayNum)
      .map((s: {
        id: string; route_plan_id: string; day_number: number
        outlet_id: string; sequence: number; sales_rep_id: string | null
      }) => ({
        ...s,
        outlet: (outlets || []).find((o: { id: string }) => o.id === s.outlet_id)!,
        visit:  (visits  || []).find((v: { outlet_id: string }) => v.outlet_id === s.outlet_id),
        sales:  (sales   || []).filter((r: { outlet_id: string }) => r.outlet_id === s.outlet_id),
      }))
      .filter((s: DayStop) => s.outlet)
      .sort((a: DayStop, b: DayStop) => a.sequence - b.sequence)

    setTodayStops(dayStops)
  }

  const startGPSTracking = () => {
    if (!navigator.geolocation) return
    const ping = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude
          const lon = pos.coords.longitude
          const acc = pos.coords.accuracy
          setLiveLocation({ lat, lon, accuracy: acc })
          if (activeRep) {
            await supabase.from('rep_locations').insert({
              sales_rep_id: activeRep.id,
              latitude: lat, longitude: lon, accuracy_m: acc,
            })
          }
        },
        (err) => console.warn('GPS error:', err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      )
    }
    ping()
    gpsIntervalRef.current = setInterval(ping, 10000)
  }

  const stopGPSTracking = () => {
    if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current)
  }

  if (!isAuthenticated || !activeRep) return <LoginPage />

  const bg = darkMode ? 'bg-slate-900' : 'bg-slate-50'

  return (
    <div className={`h-screen flex flex-col relative overflow-hidden ${bg}`}>
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {page === 'home'  && <HomePage />}
        {page === 'map'   && <MapPage />}
        {page === 'list'  && <ListPage />}
        {page === 'stock' && <StockPage />}
      </div>
      <BottomNav />
    </div>
  )
}
