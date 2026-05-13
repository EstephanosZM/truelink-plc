import { create } from 'zustand'
import { SalesRep, DayStop, StockLoad, Product, NonSaleReason, OutletVisit, SalesRecord } from '../types'

interface RepStore {
  isAuthenticated: boolean
  setAuthenticated: (v: boolean) => void

  activeRep: SalesRep | null
  setActiveRep: (r: SalesRep | null) => void
  allReps: SalesRep[]
  setAllReps: (r: SalesRep[]) => void

  todayStops: DayStop[]
  setTodayStops: (s: DayStop[]) => void
  routePlanId: string | null
  dayNumber: number | null
  setRouteInfo: (planId: string, day: number) => void

  stockLoads: StockLoad[]
  setStockLoads: (s: StockLoad[]) => void

  products: Product[]
  setProducts: (p: Product[]) => void

  reasons: NonSaleReason[]
  setReasons: (r: NonSaleReason[]) => void

  liveLocation: { lat: number; lon: number; accuracy: number } | null
  setLiveLocation: (l: { lat: number; lon: number; accuracy: number } | null) => void

  activeOutletId: string | null
  setActiveOutletId: (id: string | null) => void

  page: 'home' | 'map' | 'list' | 'sell' | 'nosale' | 'stock'
  setPage: (p: RepStore['page']) => void

  darkMode: boolean
  setDarkMode: (v: boolean) => void

  // Read-only from admin — set during bootstrap
  proximityRadius: number
  setProximityRadius: (r: number) => void

  // Last visited outlet for map animation start point
  lastVisitedPosition: { lat: number; lon: number } | null
  setLastVisitedPosition: (p: { lat: number; lon: number } | null) => void

  updateStopVisit: (outletId: string, visit: OutletVisit, sales?: SalesRecord[]) => void
}

const savedDarkMode = typeof window !== 'undefined'
  ? localStorage.getItem('darkMode') !== 'false'
  : true

export const useRepStore = create<RepStore>((set) => ({
  isAuthenticated: false,
  setAuthenticated: (v) => set({ isAuthenticated: v }),

  activeRep: null,
  setActiveRep: (r) => set({ activeRep: r }),
  allReps: [],
  setAllReps: (r) => set({ allReps: r }),

  todayStops: [],
  setTodayStops: (s) => set({ todayStops: s }),
  routePlanId: null,
  dayNumber: null,
  setRouteInfo: (planId, day) => set({ routePlanId: planId, dayNumber: day }),

  stockLoads: [],
  setStockLoads: (s) => set({ stockLoads: s }),

  products: [],
  setProducts: (p) => set({ products: p }),

  reasons: [],
  setReasons: (r) => set({ reasons: r }),

  liveLocation: null,
  setLiveLocation: (l) => set({ liveLocation: l }),

  activeOutletId: null,
  setActiveOutletId: (id) => set({ activeOutletId: id }),

  page: 'home',
  setPage: (p) => set({ page: p }),

  darkMode: savedDarkMode,
  setDarkMode: (v) => {
    localStorage.setItem('darkMode', String(v))
    set({ darkMode: v })
  },

  // Default 100m — overwritten from Supabase during bootstrap
  proximityRadius: 100,
  setProximityRadius: (r) => set({ proximityRadius: r }),

  lastVisitedPosition: null,
  setLastVisitedPosition: (p) => set({ lastVisitedPosition: p }),

  updateStopVisit: (outletId, visit, sales) =>
    set((s) => ({
      todayStops: s.todayStops.map((stop) =>
        stop.outlet_id === outletId
          ? { ...stop, visit, sales: sales || stop.sales }
          : stop
      ),
      lastVisitedPosition: s.todayStops.find((stop) => stop.outlet_id === outletId)
        ? {
            lat: s.todayStops.find((stop) => stop.outlet_id === outletId)!.outlet.latitude,
            lon: s.todayStops.find((stop) => stop.outlet_id === outletId)!.outlet.longitude,
          }
        : s.lastVisitedPosition,
    })),
}))
