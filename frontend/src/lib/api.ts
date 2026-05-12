// ── Replace with your FastAPI URL if different ────────────────────────────────
const API_BASE = 'https://truelink-api-nox3.onrender.com'
// ─────────────────────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json()
}

export interface OptimizePayload {
  outlets:     { id: string; lat: number; lon: number; name: string }[]
  warehouse:   { lat: number; lon: number }
  n_days:      number
  min_outlets: number
  max_outlets: number
}

export interface ReoptimizePayload {
  days:      { day: number; outlets: { id: string; lat: number; lon: number; name: string }[] }[]
  warehouse: { lat: number; lon: number }
}

export interface StopResult { id: string; sequence: number; name: string; lat: number; lon: number }
export interface DayResult  { day: number; stops: StopResult[] }

export const api = {
  optimize:   (p: OptimizePayload)   => post<{ days: DayResult[] }>('/optimize', p),
  reoptimize: (p: ReoptimizePayload) => post<{ days: DayResult[] }>('/reoptimize', p),
}
