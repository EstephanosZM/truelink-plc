import { useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { useRepStore } from './store/useRepStore'
import { today } from './lib/utils'
import LoginPage    from './pages/LoginPage'
import HomePage     from './pages/HomePage'
import MapPage      from './pages/MapPage'
import ListPage     from './pages/ListPage'
import StockPage    from './pages/StockPage'
import ReportPage   from './pages/ReportPage'
import WalkInPOS    from './pages/WalkInPOS'
import BottomNav    from './components/BottomNav'
import WalkInNav    from './components/WalkInNav'
import { DayStop }  from './types'

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

  const gpsRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    const { data } = await supabase
      .from('sales_representatives')
      .select('*')
      .order('name')
    if (data) setAllReps(data)
  }

  useEffect(() => {
    if (!activeRep) return
    bootstrapRepData()
    // Only track GPS for field reps
    if (!(activeRep as typeof activeRep & { is_walkin_rep?: boolean }).is_walkin_rep) {
      startGPS()
      return () => stopGPS()
    }
  }, [activeRep])

  const bootstrapRepData = async () => {
    if (!activeRep) return
    const todayStr = today()

    const [prods, rsns, stock] = await Promise.all([
      supabase.from('products').select('*').eq('status', 'active'),
      supabase.from('non_sale_reasons').select('*').eq('is_active', true).order('reason'),
      supabase.from('stock_loads').select('*').eq('sales_rep_id', activeRep.id).eq('load_date', todayStr),
    ])
    if (prods.data) setProducts(prods.data)
    if (rsns.data)  setReasons(rsns.data)
    if (stock.data) setStockLoads(stock.data)

    // Walk-in reps don't need route loading
    if ((activeRep as typeof activeRep & { is_walkin_rep?: boolean }).is_walkin_rep) return

    // Proximity radius
    if ((activeRep as typeof activeRep & { territory_id?: string }).territory_id) {
      const { data: ps } = await supabase
        .from('proximity_settings')
        .select('radius_meters')
        .eq('territory_id', (activeRep as typeof activeRep & { territory_id?: string }).territory_id)
        .maybeSingle()
      if (ps?.radius_meters) setProximityRadius(ps.radius_meters)
    }

    // Load today's route
    const { data: stops } = await supabase
      .from('route_stops')
      .select('*, route_plans!inner(id, territory_id, generated_at, n_days, status)')
      .eq('sales_rep_id', activeRep.id)
      .eq('route_date', todayStr)
      .eq('route_plans.status', 'saved')
      .order('sequence')

    if (!stops?.length) return

    const sorted   = stops.sort((
      a: { route_plans: { generated_at: string } },
      b: { route_plans: { generated_at: string } }
    ) => new Date(b.route_plans.generated_at).getTime() - new Date(a.route_plans.generated_at).getTime())

    const planId   = sorted[0].route_plan_id
    const dayNum   = sorted[0].day_number
    setRouteInfo(planId, dayNum)

    const outletIds = sorted.map((s: { outlet_id: string }) => s.outlet_id)
    const [outRes, visRes, salesRes] = await Promise.all([
      supabase.from('outlets').select('*').in('id', outletIds),
      supabase.from('outlet_visits').select('*').eq('route_plan_id', planId).eq('day_number', dayNum).eq('sales_rep_id', activeRep.id),
      supabase.from('sales_records').select('*').eq('route_plan_id', planId).eq('day_number', dayNum).eq('sales_rep_id', activeRep.id),
    ])

    const dayStops: DayStop[] = sorted
      .filter((s: { route_plan_id: string; day_number: number }) =>
        s.route_plan_id === planId && s.day_number === dayNum)
      .map((s: { id: string; route_plan_id: string; day_number: number; outlet_id: string; sequence: number; sales_rep_id: string | null }) => ({
        ...s,
        outlet: (outRes.data || []).find((o: { id: string }) => o.id === s.outlet_id)!,
        visit:  (visRes.data  || []).find((v: { outlet_id: string }) => v.outlet_id === s.outlet_id),
        sales:  (salesRes.data || []).filter((r: { outlet_id: string }) => r.outlet_id === s.outlet_id),
      }))
      .filter((s: DayStop) => s.outlet)
      .sort((a: DayStop, b: DayStop) => a.sequence - b.sequence)

    setTodayStops(dayStops)
  }

  const startGPS = () => {
    if (!navigator.geolocation) return
    const ping = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude
          const lon = pos.coords.longitude
          setLiveLocation({ lat, lon, accuracy: pos.coords.accuracy })
          if (activeRep) {
            await supabase.from('rep_locations').insert({
              sales_rep_id: activeRep.id, latitude: lat, longitude: lon, accuracy_m: pos.coords.accuracy,
            })
          }
        },
        (err) => console.warn('GPS:', err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      )
    }
    ping()
    gpsRef.current = setInterval(ping, 10000)
  }

  const stopGPS = () => { if (gpsRef.current) clearInterval(gpsRef.current) }

  if (!isAuthenticated || !activeRep) return <LoginPage />

  const isWalkIn = (activeRep as typeof activeRep & { is_walkin_rep?: boolean }).is_walkin_rep
  const bg = darkMode ? 'bg-slate-900' : 'bg-slate-50'

  // Walk-in rep gets POS + simple nav
  if (isWalkIn) {
    return (
      <div className={`h-screen flex flex-col relative overflow-hidden ${bg}`}>
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {page === 'pos'   && <WalkInPOS />}
          {page === 'stock' && <StockPage />}
        </div>
        <WalkInNav />
      </div>
    )
  }

  // Regular field rep
  return (
    <div className={`h-screen flex flex-col relative overflow-hidden ${bg}`}>
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {page === 'home'    && <HomePage />}
        {page === 'map'     && <MapPage />}
        {page === 'list'    && <ListPage />}
        {page === 'stock'   && <StockPage />}
        {page === 'reports' && <ReportPage />}
      </div>
      <BottomNav />
    </div>
  )
}
