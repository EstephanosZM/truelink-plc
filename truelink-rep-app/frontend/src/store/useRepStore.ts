import { create } from 'zustand'
import { SalesRep, DayStop, StockLoad, Product, NonSaleReason, OutletVisit, SalesRecord } from '../types'

interface RepStore {
  // Auth
  isAuthenticated: boolean
  setAuthenticated: (v: boolean) => void

  // Selected rep (shared login)
  activeRep: SalesRep | null
  setActiveRep: (r: SalesRep | null) => void
  allReps: SalesRep[]
  setAllReps: (r: SalesRep[]) => void

  // Today's route
  todayStops: DayStop[]
  setTodayStops: (s: DayStop[]) => void
  routePlanId: string | null
  dayNumber: number | null
  setRouteInfo: (planId: string, day: number) => void

  // Stock
  stockLoads: StockLoad[]
  setStockLoads: (s: StockLoad[]) => void

  // Products
  products: Product[]
  setProducts: (p: Product[]) => void

  // Non-sale reasons
  reasons: NonSaleReason[]
  setReasons: (r: NonSaleReason[]) => void

  // Live location
  liveLocation: { lat: number; lon: number; accuracy: number } | null
  setLiveLocation: (l: { lat: number; lon: number; accuracy: number } | null) => void

  // Active outlet (for selling/no-sale flow)
  activeOutletId: string | null
  setActiveOutletId: (id: string | null) => void

  // Navigation
  page: 'home' | 'map' | 'list' | 'sell' | 'nosale' | 'stock'
  setPage: (p: RepStore['page']) => void

  // Update a stop's visit after action
  updateStopVisit: (outletId: string, visit: OutletVisit, sales?: SalesRecord[]) => void
}

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

  updateStopVisit: (outletId, visit, sales) =>
    set((s) => ({
      todayStops: s.todayStops.map((stop) =>
        stop.outlet_id === outletId
          ? { ...stop, visit, sales: sales || stop.sales }
          : stop
      ),
    })),
}))
