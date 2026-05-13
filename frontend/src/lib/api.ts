const API_BASE = 'https://truelink-api-nox3.onrender.com'

type RoutingMethod = 'nearest_neighbour' | 'two_opt' | 'ortools'

interface Outlet   { id: string; lat: number; lon: number; name: string }
interface Warehouse { lat: number; lon: number }

export const api = {
  async optimize(params: {
    outlets:      Outlet[]
    warehouse:    Warehouse
    n_days:       number
    min_outlets:  number
    max_outlets:  number
    method?:      RoutingMethod
  }) {
    const res = await fetch(`${API_BASE}/optimize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...params, method: params.method || 'nearest_neighbour' }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(err.detail || err.message || 'Optimization failed')
    }
    return res.json()
  },

  async reoptimize(params: {
    days:      { day: number; outlets: Outlet[] }[]
    warehouse: Warehouse
    method?:   RoutingMethod
  }) {
    const res = await fetch(`${API_BASE}/reoptimize`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...params, method: params.method || 'nearest_neighbour' }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(err.detail || err.message || 'Reoptimization failed')
    }
    return res.json()
  },

  async health() {
    const res = await fetch(`${API_BASE}/health`)
    return res.json()
  },
}
