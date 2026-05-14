import { create } from 'zustand'
import { Territory, Outlet, RoutePlan, Settings, SalesRep, Brand, Flavor, Product, DayRoute, ProximitySetting } from '../types'

interface AppState {
  isAuthenticated: boolean
  setAuthenticated: (v: boolean) => void

  settings: Settings | null
  setSettings: (s: Settings) => void

  territories: Territory[]
  setTerritories: (t: Territory[]) => void
  addTerritory: (t: Territory) => void

  proximitySettings: ProximitySetting[]
  setProximitySettings: (p: ProximitySetting[]) => void

  activeTerritoryId: string | null
  setActiveTerritoryId: (id: string | null) => void

  outlets: Outlet[]
  setOutlets: (o: Outlet[]) => void

  salesReps: SalesRep[]
  setSalesReps: (r: SalesRep[]) => void

  routePlan: RoutePlan | null
  setRoutePlan: (rp: RoutePlan | null) => void

  dayRoutes: DayRoute[]
  setDayRoutes: (dr: DayRoute[]) => void
  updateDayRoute: (day: number, stops: DayRoute['stops']) => void

  activeDay: number | null
  setActiveDay: (d: number | null) => void

  selectedOutletId: string | null
  setSelectedOutletId: (id: string | null) => void

  mode: 'view' | 'route' | 'draw'
  setMode: (m: 'view' | 'route' | 'draw') => void

  searchQuery: string
  routingMethod:    'nearest_neighbour' | 'two_opt' | 'ortools'
  setRoutingMethod: (m: 'nearest_neighbour' | 'two_opt' | 'ortools') => void
  setSearchQuery: (q: string) => void

  brands: Brand[]
  setBrands: (b: Brand[]) => void
  flavors: Flavor[]
  setFlavors: (f: Flavor[]) => void
  products: Product[]
  setProducts: (p: Product[]) => void

  loading: Record<string, boolean>
  setLoading: (key: string, v: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  isAuthenticated: false,
  setAuthenticated: (v) => set({ isAuthenticated: v }),

  settings: null,
  setSettings: (s) => set({ settings: s }),

  territories: [],
  setTerritories: (t) => set({ territories: t }),
  addTerritory: (t) => set((s) => ({ territories: [...s.territories, t] })),
  
  dayNames:    null,
setDayNames: (n) => set({ dayNames: n }),

  proximitySettings: [],
  setProximitySettings: (p) => set({ proximitySettings: p }),

  activeTerritoryId: null,
  setActiveTerritoryId: (id) => set({ activeTerritoryId: id, dayRoutes: [], routePlan: null, activeDay: null, selectedOutletId: null }),

  outlets: [],
  setOutlets: (o) => set({ outlets: o }),

  salesReps: [],
  setSalesReps: (r) => set({ salesReps: r }),

  routePlan: null,
  setRoutePlan: (rp) => set({ routePlan: rp }),

  dayRoutes: [],
  setDayRoutes: (dr) => set({ dayRoutes: dr, activeDay: dr.length > 0 ? dr[0].day : null }),
  updateDayRoute: (day, stops) => set((s) => ({
    dayRoutes: s.dayRoutes.map((d) => d.day === day ? { ...d, stops } : d)
  })),

  activeDay: null,
  setActiveDay: (d) => set({ activeDay: d }),

  selectedOutletId: null,
  setSelectedOutletId: (id) => set({ selectedOutletId: id }),

  mode: 'view',
  setMode: (m) => set({ mode: m }),

  searchQuery: '',
  routingMethod: (localStorage.getItem('routingMethod') as 'nearest_neighbour'|'two_opt'|'ortools') || 'nearest_neighbour',
  setRoutingMethod: (m) => { localStorage.setItem('routingMethod', m); set({ routingMethod: m }) },
  setSearchQuery: (q) => set({ searchQuery: q }),

  brands: [],
  setBrands: (b) => set({ brands: b }),
  flavors: [],
  setFlavors: (f) => set({ flavors: f }),
  products: [],
  setProducts: (p) => set({ products: p }),

  loading: {},
  setLoading: (key, v) => set((s) => ({ loading: { ...s.loading, [key]: v } })),
  dayNames:    Record<number, string> | null
setDayNames: (n: Record<number, string>) => void
}))
