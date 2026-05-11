import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { haversineDistance, getCurrentPosition } from '../lib/utils'
import { RoutePlan, Outlet, Product, SalesRecord } from '../types'

interface SaleRow { productId: string; quantity: number; unitPrice: number }

export default function SalesEntryPage() {
  const { territories, salesReps, products, proximitySettings } = useStore()

  const [territoryId, setTerritoryId] = useState('')
  const [plans,       setPlans]       = useState<RoutePlan[]>([])
  const [planId,      setPlanId]      = useState('')
  const [days,        setDays]        = useState<number[]>([])
  const [dayNum,      setDayNum]      = useState<number|''>('')
  const [dayOutlets,  setDayOutlets]  = useState<(Outlet & { sequence: number; sales_rep_id: string|null })[]>([])
  const [outletId,    setOutletId]    = useState('')
  const [saleRows,    setSaleRows]    = useState<SaleRow[]>([{ productId:'', quantity:1, unitPrice:0 }])
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [completed,   setCompleted]   = useState<SalesRecord[]>([])

  // Proximity
  const [proxState,   setProxState]   = useState<'idle'|'checking'|'ok'|'blocked'|'flagging'|'flagged'|'error'>('idle')
  const [proxDist,    setProxDist]    = useState<number|null>(null)
  const [flagReason,  setFlagReason]  = useState('')
  const [userCoords,  setUserCoords]  = useState<{lat:number;lon:number}|null>(null)

  useEffect(() => { if (territoryId) loadPlans() }, [territoryId])
  useEffect(() => { if (planId) loadDays() }, [planId])
  useEffect(() => { if (planId && dayNum) loadDayOutlets() }, [planId, dayNum])
  useEffect(() => {
    if (outletId) { setProxState('idle'); setProxDist(null); checkProximity() }
  }, [outletId])

  const loadPlans = async () => {
    const { data } = await supabase.from('route_plans').select('*')
      .eq('territory_id', territoryId).eq('status','saved').order('generated_at', { ascending:false })
    setPlans(data || [])
  }

  const loadDays = async () => {
    const { data } = await supabase.from('route_stops').select('day_number')
      .eq('route_plan_id', planId)
    const unique = [...new Set((data||[]).map((r: {day_number:number}) => r.day_number))].sort((a,b)=>a-b)
    setDays(unique)
  }

  const loadDayOutlets = async () => {
    const { data: stops } = await supabase.from('route_stops').select('*, outlets(*)')
      .eq('route_plan_id', planId).eq('day_number', dayNum).order('sequence')
    if (!stops) return
    setDayOutlets(stops.map((s: {sequence:number;sales_rep_id:string|null;outlets:Outlet}) => ({
      ...s.outlets, sequence: s.sequence, sales_rep_id: s.sales_rep_id
    })))
    // Load existing sales for this day
    const { data: existing } = await supabase.from('sales_records')
      .select('*').eq('route_plan_id', planId).eq('day_number', dayNum)
    setCompleted(existing || [])
  }

  const checkProximity = async () => {
    const outlet = dayOutlets.find((o) => o.id === outletId)
    if (!outlet) return
    setProxState('checking')
    try {
      const pos  = await getCurrentPosition()
      const lat  = pos.coords.latitude
      const lon  = pos.coords.longitude
      setUserCoords({ lat, lon })
      const dist = haversineDistance(lat, lon, outlet.latitude, outlet.longitude)
      setProxDist(Math.round(dist))
      const ps = proximitySettings.find((p) => p.territory_id === territoryId)
      const radius = ps?.radius_meters ?? 100
      if (dist <= radius) {
        setProxState('ok')
        await supabase.from('route_stops').update({
          checkin_lat: lat, checkin_lon: lon, checkin_distance_m: Math.round(dist),
          checkin_within_radius: true, visited: true, visited_at: new Date().toISOString()
        }).eq('route_plan_id', planId).eq('outlet_id', outletId)
      } else {
        setProxState('blocked')
      }
    } catch {
      setProxState('error')
    }
  }

  const submitFlag = async () => {
    if (!flagReason.trim()) return
    const outlet = dayOutlets.find((o) => o.id === outletId)
    if (!outlet || !userCoords) return
    await supabase.from('route_stops').update({
      checkin_lat: userCoords.lat, checkin_lon: userCoords.lon,
      checkin_distance_m: proxDist, checkin_within_radius: false,
      checkin_flagged: true, flag_reason: flagReason.trim(),
      visited: true, visited_at: new Date().toISOString()
    }).eq('route_plan_id', planId).eq('outlet_id', outletId)
    setProxState('flagged')
    setFlagReason('')
  }

  const addRow = () => setSaleRows([...saleRows, { productId:'', quantity:1, unitPrice:0 }])
  const removeRow = (i: number) => setSaleRows(saleRows.filter((_,idx) => idx !== i))
  const updateRow = (i: number, field: keyof SaleRow, val: string|number) => {
    const rows = [...saleRows]
    if (field === 'productId') {
      const prod = products.find((p) => p.id === val)
      rows[i] = { ...rows[i], productId: val as string, unitPrice: prod?.unit_price || 0 }
    } else {
      rows[i] = { ...rows[i], [field]: val }
    }
    setSaleRows(rows)
  }

  const grandTotal = saleRows.reduce((a, r) => a + r.quantity * r.unitPrice, 0)

  const saveSales = async () => {
    if (!outletId || !planId || !dayNum) return
    const outlet = dayOutlets.find((o) => o.id === outletId)
    if (!outlet) return
    const validRows = saleRows.filter((r) => r.productId && r.quantity > 0)
    if (!validRows.length) return
    setSaving(true)
    await supabase.from('sales_records').delete()
      .eq('route_plan_id', planId).eq('outlet_id', outletId).eq('day_number', dayNum)
    const records = validRows.map((r) => ({
      route_plan_id: planId, day_number: dayNum, outlet_id: outletId,
      sales_rep_id: outlet.sales_rep_id, product_id: r.productId,
      quantity: r.quantity, unit_price: r.unitPrice,
      total_price: r.quantity * r.unitPrice,
      sale_date: new Date().toISOString().split('T')[0], notes: notes.trim() || null,
    }))
    await supabase.from('sales_records').insert(records)
    await loadDayOutlets()
    setSaleRows([{ productId:'', quantity:1, unitPrice:0 }])
    setNotes(''); setOutletId(''); setProxState('idle'); setSaving(false)
  }

  const completedForOutlet = (oid: string) => completed.filter((r) => r.outlet_id === oid)
  const completedCount = dayOutlets.filter((o) => completedForOutlet(o.id).length > 0).length
  const progress = dayOutlets.length ? Math.round(completedCount / dayOutlets.length * 100) : 0

  const selectedOutlet = dayOutlets.find((o) => o.id === outletId)
  const ps = proximitySettings.find((p) => p.territory_id === territoryId)
  const radius = ps?.radius_meters ?? 100

  const canEnterSales = proxState === 'ok' || proxState === 'flagged'

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-slate-900">Sales Entry</h1>

        {/* Step 1 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Step 1 — Select Route</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Territory</label>
              <select value={territoryId} onChange={(e) => { setTerritoryId(e.target.value); setPlanId(''); setDayNum('') }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select territory</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Route Plan</label>
              <select value={planId} onChange={(e) => { setPlanId(e.target.value); setDayNum('') }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" disabled={!territoryId}>
                <option value="">Select plan</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{new Date(p.generated_at).toLocaleDateString()} — {p.n_days} days</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        {planId && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Step 2 — Select Day</p>
            <select value={dayNum} onChange={(e) => { setDayNum(e.target.value ? parseInt(e.target.value) : ''); setOutletId(''); setProxState('idle') }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select day</option>
              {days.map((d) => {
                const repId = dayOutlets[0]?.sales_rep_id
                const rep   = salesReps.find((r) => r.id === repId)
                return <option key={d} value={d}>Day {d}{rep ? ` — ${rep.name}` : ''} — {dayOutlets.length||'?'} stops</option>
              })}
            </select>
          </div>
        )}

        {/* Step 3 */}
        {dayNum !== '' && dayOutlets.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Step 3 — Select Outlet</p>
            <select value={outletId} onChange={(e) => { setOutletId(e.target.value); setSaleRows([{productId:'',quantity:1,unitPrice:0}]) }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select outlet</option>
              {dayOutlets.map((o) => {
                const done = completedForOutlet(o.id).length > 0
                return <option key={o.id} value={o.id}>{done ? '✓ ' : ''}{o.sequence}. {o.outlet_name}{o.land_mark ? ` — ${o.land_mark}` : ''}</option>
              })}
            </select>
          </div>
        )}

        {/* Proximity check */}
        {outletId && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Step 4 — Proximity Check</p>

            {proxState === 'checking' && (
              <div className="flex items-center gap-3 text-slate-600">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Getting your location…</span>
              </div>
            )}

            {proxState === 'ok' && (
              <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-lg text-sm">
                ✅ You are {proxDist}m from this outlet. Entry unlocked.
              </div>
            )}

            {proxState === 'flagged' && (
              <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-2 rounded-lg text-sm">
                ⚠ Flagged issue recorded. Entry allowed.
              </div>
            )}

            {proxState === 'error' && (
              <div className="bg-red-50 px-3 py-2 rounded-lg text-sm text-red-700">
                Could not get your location. Please enable location access in your browser settings.
                <button onClick={checkProximity} className="ml-3 text-red-600 underline">Try Again</button>
              </div>
            )}

            {proxState === 'blocked' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-amber-800">⚠ You are {proxDist}m from this outlet</p>
                <p className="text-xs text-amber-700">You must be within {radius}m to enter sales data.</p>
                {selectedOutlet && userCoords && (
                  <div className="text-xs text-slate-600 space-y-1">
                    <p>Your location: {userCoords.lat.toFixed(4)}, {userCoords.lon.toFixed(4)}</p>
                    <p>Outlet location: {selectedOutlet.latitude.toFixed(4)}, {selectedOutlet.longitude.toFixed(4)}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={checkProximity} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Try Again</button>
                  <button onClick={() => setProxState('flagging')} className="px-4 py-2 border border-amber-400 text-amber-700 rounded-lg text-sm hover:bg-amber-100">Flag as Issue</button>
                </div>
              </div>
            )}

            {proxState === 'flagging' && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700">Why can't you be at this outlet?</p>
                {['Outlet is closed','Wrong address in system','Road is blocked','Other'].map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input type="radio" value={r} checked={flagReason===r} onChange={() => setFlagReason(r)} className="accent-blue-600" />
                    {r}
                  </label>
                ))}
                {flagReason === 'Other' && (
                  <textarea value={flagReason === 'Other' ? '' : flagReason}
                    onChange={(e) => setFlagReason(e.target.value)} rows={2} placeholder="Describe the issue…"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                )}
                <div className="flex gap-2">
                  <button onClick={() => setProxState('blocked')} className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Back</button>
                  <button onClick={submitFlag} disabled={!flagReason.trim()} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 disabled:opacity-50">Submit Flag &amp; Continue</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 5 — products */}
        {canEnterSales && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Step 5 — Add Products Sold</p>
            <div className="space-y-2 mb-4">
              {saleRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select value={row.productId} onChange={(e) => updateRow(i,'productId',e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select product</option>
                    {products.filter((p) => p.status==='active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" min={1} value={row.quantity} onChange={(e) => updateRow(i,'quantity',parseInt(e.target.value)||1)}
                    className="w-16 px-2 py-2 border border-slate-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="number" min={0} step="0.01" value={row.unitPrice} onChange={(e) => updateRow(i,'unitPrice',parseFloat(e.target.value)||0)}
                    className="w-24 px-2 py-2 border border-slate-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-sm text-slate-700 w-24 text-right">ETB {(row.quantity*row.unitPrice).toFixed(2)}</span>
                  {saleRows.length > 1 && <button onClick={() => removeRow(i)} className="text-slate-400 hover:text-red-500 text-lg">×</button>}
                </div>
              ))}
            </div>
            <button onClick={addRow} className="text-sm text-blue-600 hover:text-blue-800 mb-4">+ Add Product</button>
            <div className="flex justify-end mb-4">
              <span className="text-base font-semibold text-slate-900">Total: ETB {grandTotal.toFixed(2)}</span>
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="Notes (optional)…"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-4" />
            <button onClick={saveSales} disabled={saving || !saleRows.some((r) => r.productId)}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Sales for this Outlet'}
            </button>
          </div>
        )}

        {/* Progress */}
        {dayOutlets.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700">Day {dayNum} Progress</p>
              <span className="text-sm text-slate-600">{completedCount} of {dayOutlets.length} outlets</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2 mb-4">
              <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width:`${progress}%` }} />
            </div>
            <div className="divide-y divide-slate-100">
              {dayOutlets.map((o) => {
                const recs = completedForOutlet(o.id)
                const total = recs.reduce((a, r) => a + r.total_price, 0)
                return (
                  <div key={o.id} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${recs.length ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {recs.length ? '✓' : o.sequence}
                      </span>
                      <span className="text-sm text-slate-900">{o.outlet_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {recs.length > 0 && <span className="text-sm text-slate-700">ETB {total.toFixed(2)}</span>}
                      {recs.length > 0 && (
                        <button onClick={() => { setOutletId(o.id); setSaleRows(recs.map((r) => ({ productId:r.product_id, quantity:r.quantity, unitPrice:r.unit_price }))); setProxState('ok') }}
                          className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
