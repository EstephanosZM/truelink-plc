import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import { haversineDistance, getCurrentPosition, fmtETB, today } from '../lib/utils'
import { CartItem } from '../types'

type ProxState = 'idle' | 'checking' | 'ok' | 'blocked' | 'flagging' | 'flagged' | 'error'
type View      = 'sheet' | 'sell' | 'nosale'

interface Props { onClose: () => void }

export default function OutletSheet({ onClose }: Props) {
  const { activeOutletId, todayStops, stockLoads, products, reasons,
          activeRep, routePlanId, dayNumber, setStockLoads, updateStopVisit } = useRepStore()

  const stop = todayStops.find((s) => s.outlet_id === activeOutletId)
  const outlet = stop?.outlet

  const [view,        setView]        = useState<View>('sheet')
  const [proxState,   setProxState]   = useState<ProxState>('idle')
  const [proxDist,    setProxDist]    = useState<number | null>(null)
  const [userCoords,  setUserCoords]  = useState<{ lat: number; lon: number } | null>(null)
  const [flagReason,  setFlagReason]  = useState('')
  const [cart,        setCart]        = useState<CartItem[]>([])
  const [noSaleId,    setNoSaleId]    = useState('')
  const [noSaleNotes, setNoSaleNotes] = useState('')
  const [saving,      setSaving]      = useState(false)

  const RADIUS = 100 // meters — could come from proximity_settings

  useEffect(() => {
    if (activeOutletId) checkProximity()
  }, [activeOutletId])

  // Build cart from available stock
  useEffect(() => {
    const items: CartItem[] = stockLoads
      .filter((sl) => sl.current_balance > 0)
      .map((sl) => {
        const prod = products.find((p) => p.id === sl.product_id)
        if (!prod) return null
        return { product: prod, quantity: 0, stock: sl.current_balance }
      })
      .filter(Boolean) as CartItem[]
    setCart(items)
  }, [stockLoads, products])

  const checkProximity = async () => {
    if (!outlet) return
    setProxState('checking')
    try {
      const pos  = await getCurrentPosition()
      const lat  = pos.coords.latitude
      const lon  = pos.coords.longitude
      setUserCoords({ lat, lon })
      const dist = Math.round(haversineDistance(lat, lon, outlet.latitude, outlet.longitude))
      setProxDist(dist)
      setProxState(dist <= RADIUS ? 'ok' : 'blocked')
    } catch {
      setProxState('error')
    }
  }

  const submitFlag = async () => {
    if (!flagReason.trim() || !outlet || !userCoords || !activeRep || !routePlanId || !dayNumber) return
    await supabase.from('outlet_visits').upsert({
      route_plan_id: routePlanId, day_number: dayNumber,
      outlet_id: outlet.id, sales_rep_id: activeRep.id,
      visit_date: today(), visit_status: 'not_visited',
      checkin_lat: userCoords.lat, checkin_lon: userCoords.lon,
      checkin_distance_m: proxDist, checkin_within_radius: false,
      checkin_flagged: true, flag_reason: flagReason.trim(),
    }, { onConflict: 'route_plan_id,day_number,outlet_id' })
    setProxState('flagged')
    setFlagReason('')
  }

  const canProceed = proxState === 'ok' || proxState === 'flagged'

  // Cart helpers
  const updateQty = (idx: number, delta: number) => {
    setCart((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      const newQty = Math.max(0, Math.min(item.stock, item.quantity + delta))
      return { ...item, quantity: newQty }
    }))
  }

  const cartTotal    = cart.reduce((a, i) => a + i.quantity * i.product.unit_price, 0)
  const cartHasItems = cart.some((i) => i.quantity > 0)

  const completeSale = async () => {
    if (!cartHasItems || !activeRep || !outlet || !routePlanId || !dayNumber) return
    setSaving(true)
    const saleDate = today()

    // Insert sales records
    const records = cart
      .filter((i) => i.quantity > 0)
      .map((i) => ({
        route_plan_id: routePlanId, day_number: dayNumber,
        outlet_id: outlet.id, sales_rep_id: activeRep.id,
        product_id: i.product.id, quantity: i.quantity,
        unit_price: i.product.unit_price,
        total_price: i.quantity * i.product.unit_price,
        sale_date: saleDate,
      }))

    const { data: inserted } = await supabase
      .from('sales_records').insert(records).select()

    // Deduct from stock balances
    for (const item of cart.filter((i) => i.quantity > 0)) {
      await supabase.from('stock_loads')
        .update({ current_balance: item.stock - item.quantity })
        .eq('sales_rep_id', activeRep.id)
        .eq('product_id', item.product.id)
        .eq('load_date', saleDate)
    }

    // Reload stock
    const { data: newStock } = await supabase.from('stock_loads')
      .select('*').eq('sales_rep_id', activeRep.id).eq('load_date', saleDate)
    if (newStock) setStockLoads(newStock)

    // Record visit
    const { data: visit } = await supabase.from('outlet_visits').upsert({
      route_plan_id: routePlanId, day_number: dayNumber,
      outlet_id: outlet.id, sales_rep_id: activeRep.id,
      visit_date: saleDate, visit_status: 'sold',
      checkin_lat: userCoords?.lat, checkin_lon: userCoords?.lon,
      checkin_distance_m: proxDist, checkin_within_radius: proxState === 'ok',
      checkin_flagged: proxState === 'flagged', visited_at: new Date().toISOString(),
    }, { onConflict: 'route_plan_id,day_number,outlet_id' }).select().single()

    if (visit && stop) updateStopVisit(outlet.id, visit, inserted || [])
    setSaving(false)
    onClose()
  }

  const submitNoSale = async () => {
    if (!noSaleId || !activeRep || !outlet || !routePlanId || !dayNumber) return
    setSaving(true)
    const saleDate = today()
    const { data: visit } = await supabase.from('outlet_visits').upsert({
      route_plan_id: routePlanId, day_number: dayNumber,
      outlet_id: outlet.id, sales_rep_id: activeRep.id,
      visit_date: saleDate, visit_status: 'no_sale',
      non_sale_reason_id: noSaleId,
      non_sale_notes: noSaleNotes.trim() || null,
      checkin_lat: userCoords?.lat, checkin_lon: userCoords?.lon,
      checkin_distance_m: proxDist, checkin_within_radius: proxState === 'ok',
      checkin_flagged: proxState === 'flagged', visited_at: new Date().toISOString(),
    }, { onConflict: 'route_plan_id,day_number,outlet_id' }).select().single()
    if (visit && stop) updateStopVisit(outlet.id, visit)
    setSaving(false)
    onClose()
  }

  if (!outlet || !stop) return null

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-slate-900 rounded-t-2xl border-t border-slate-700 max-h-[90vh] flex flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-700 rounded-full" />
        </div>

        <div className="overflow-y-auto flex-1">

          {/* ── Main sheet ── */}
          {view === 'sheet' && (
            <div className="px-5 pb-8">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-white font-bold text-lg truncate">{outlet.outlet_name}</h2>
                  {outlet.land_mark && <p className="text-slate-400 text-sm">📍 {outlet.land_mark}</p>}
                  {outlet.phone_number && <p className="text-slate-400 text-sm">📞 {outlet.phone_number}</p>}
                  <p className="text-slate-500 text-xs mt-1">Stop #{stop.sequence}</p>
                </div>
                <button onClick={onClose} className="text-slate-400 text-2xl ml-3 leading-none">×</button>
              </div>

              {/* Previous visit status */}
              {stop.visit && stop.visit.visit_status !== 'not_visited' && (
                <div className={`rounded-xl px-3 py-2 mb-4 text-sm font-medium ${
                  stop.visit.visit_status === 'sold'    ? 'bg-green-900/50 text-green-400' :
                  stop.visit.visit_status === 'no_sale' ? 'bg-amber-900/50 text-amber-400' :
                  'bg-slate-700 text-slate-400'
                }`}>
                  {stop.visit.visit_status === 'sold'    && `✅ Already sold — ETB ${(stop.sales||[]).reduce((a,r)=>a+r.total_price,0).toFixed(0)}`}
                  {stop.visit.visit_status === 'no_sale' && '🟡 No sale recorded'}
                  {stop.visit.visit_status === 'closed'  && '⚫ Marked as closed'}
                </div>
              )}

              {/* Proximity status */}
              <div className="mb-5">
                {proxState === 'checking' && (
                  <div className="flex items-center gap-2 text-slate-400 text-sm">
                    <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Getting your location…
                  </div>
                )}
                {proxState === 'ok' && (
                  <div className="bg-green-900/30 border border-green-800 rounded-xl px-3 py-2 text-green-400 text-sm">
                    ✅ You are {proxDist}m away — verified
                  </div>
                )}
                {proxState === 'flagged' && (
                  <div className="bg-amber-900/30 border border-amber-800 rounded-xl px-3 py-2 text-amber-400 text-sm">
                    ⚠ Issue flagged — entry allowed
                  </div>
                )}
                {proxState === 'error' && (
                  <div className="bg-red-900/30 border border-red-800 rounded-xl px-3 py-2">
                    <p className="text-red-400 text-sm mb-2">Location unavailable. Enable GPS to continue.</p>
                    <button onClick={checkProximity} className="text-blue-400 text-sm underline">Try again</button>
                  </div>
                )}
                {proxState === 'blocked' && (
                  <div className="bg-amber-900/30 border border-amber-800 rounded-xl p-3 space-y-2">
                    <p className="text-amber-400 text-sm font-medium">⚠ You are {proxDist}m away (max {RADIUS}m)</p>
                    <div className="flex gap-2">
                      <button onClick={checkProximity}
                        className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">
                        Try Again
                      </button>
                      <button onClick={() => setProxState('flagging')}
                        className="flex-1 py-2 border border-amber-600 text-amber-400 rounded-lg text-sm">
                        Flag Issue
                      </button>
                    </div>
                  </div>
                )}
                {proxState === 'flagging' && (
                  <div className="space-y-3">
                    <p className="text-white font-medium text-sm">Why can't you be at this outlet?</p>
                    {['Customer not available','Outlet closed','Road blocked','Wrong address in system'].map((r) => (
                      <label key={r} className="flex items-center gap-3 p-3 bg-slate-800 rounded-xl cursor-pointer">
                        <input type="radio" value={r} checked={flagReason===r} onChange={() => setFlagReason(r)}
                          className="accent-blue-600" />
                        <span className="text-slate-300 text-sm">{r}</span>
                      </label>
                    ))}
                    <div className="flex gap-2">
                      <button onClick={() => setProxState('blocked')}
                        className="flex-1 py-2 border border-slate-600 text-slate-400 rounded-lg text-sm">
                        Back
                      </button>
                      <button onClick={submitFlag} disabled={!flagReason}
                        className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                        Submit & Continue
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {canProceed && (
                <div className="space-y-3">
                  <button
                    onClick={() => setView('sell')}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-2xl text-white font-bold text-lg transition-all flex items-center justify-center gap-3"
                  >
                    <span className="text-2xl">🛒</span> Sell Products
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setView('nosale')}
                      className="py-3 bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 rounded-2xl text-white font-medium transition-all"
                    >
                      ✗ No Sale
                    </button>
                    <a
                      href={`https://maps.google.com/?daddr=${outlet.latitude},${outlet.longitude}`}
                      target="_blank" rel="noreferrer"
                      className="py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl text-white font-medium transition-all flex items-center justify-center"
                    >
                      🗺 Navigate
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Sell products (cart) ── */}
          {view === 'sell' && (
            <div className="px-5 pb-8">
              <div className="flex items-center gap-3 mb-5">
                <button onClick={() => setView('sheet')} className="text-slate-400 text-2xl">‹</button>
                <div>
                  <h2 className="text-white font-bold">Sell Products</h2>
                  <p className="text-slate-400 text-xs">{outlet.outlet_name}</p>
                </div>
              </div>

              {/* Product list */}
              <div className="space-y-3 mb-6">
                {cart.map((item, i) => (
                  <div key={item.product.id}
                    className={`bg-slate-800 rounded-2xl p-4 border ${item.stock === 0 ? 'border-slate-700 opacity-50' : 'border-slate-700'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-white font-medium text-sm">{item.product.name}</p>
                        <p className="text-slate-400 text-xs">
                          {fmtETB(item.product.unit_price)} · Stock: {item.stock}
                        </p>
                      </div>
                      {item.quantity > 0 && (
                        <p className="text-green-400 text-sm font-semibold shrink-0">
                          {fmtETB(item.quantity * item.product.unit_price)}
                        </p>
                      )}
                    </div>
                    {/* Counter */}
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => updateQty(i, -1)}
                        disabled={item.quantity === 0}
                        className="w-10 h-10 rounded-full bg-slate-700 text-white font-bold text-xl disabled:opacity-30 active:scale-90 transition-transform"
                      >−</button>
                      <span className="text-white font-bold text-xl w-8 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(i, 1)}
                        disabled={item.quantity >= item.stock || item.stock === 0}
                        className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold text-xl disabled:opacity-30 active:scale-90 transition-transform"
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Cart summary + complete */}
              <div className="sticky bottom-0 bg-slate-900 pt-4 pb-2">
                {cartHasItems && (
                  <div className="bg-slate-800 rounded-2xl p-4 mb-3 border border-slate-700">
                    <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">Cart</p>
                    {cart.filter((i) => i.quantity > 0).map((item) => (
                      <div key={item.product.id} className="flex justify-between text-sm mb-1">
                        <span className="text-slate-300">{item.product.name} × {item.quantity}</span>
                        <span className="text-white font-medium">{fmtETB(item.quantity * item.product.unit_price)}</span>
                      </div>
                    ))}
                    <div className="border-t border-slate-700 mt-2 pt-2 flex justify-between">
                      <span className="text-slate-300 font-semibold">Total</span>
                      <span className="text-green-400 font-bold text-lg">{fmtETB(cartTotal)}</span>
                    </div>
                  </div>
                )}
                <button
                  onClick={completeSale}
                  disabled={!cartHasItems || saving}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 active:scale-95 disabled:opacity-40 rounded-2xl text-white font-bold text-lg transition-all"
                >
                  {saving ? 'Saving…' : `✓ Complete Sale — ${fmtETB(cartTotal)}`}
                </button>
              </div>
            </div>
          )}

          {/* ── No sale ── */}
          {view === 'nosale' && (
            <div className="px-5 pb-8">
              <div className="flex items-center gap-3 mb-5">
                <button onClick={() => setView('sheet')} className="text-slate-400 text-2xl">‹</button>
                <div>
                  <h2 className="text-white font-bold">No Sale</h2>
                  <p className="text-slate-400 text-xs">{outlet.outlet_name}</p>
                </div>
              </div>

              <p className="text-slate-400 text-sm mb-4">Select a reason:</p>
              <div className="space-y-2 mb-5">
                {reasons.filter((r) => r.is_active).map((r) => (
                  <label key={r.id}
                    className={`flex items-center gap-3 p-4 rounded-2xl cursor-pointer border transition-colors ${
                      noSaleId === r.id
                        ? 'bg-blue-900/40 border-blue-600'
                        : 'bg-slate-800 border-slate-700'
                    }`}>
                    <input type="radio" value={r.id} checked={noSaleId===r.id}
                      onChange={() => setNoSaleId(r.id)} className="accent-blue-600" />
                    <span className="text-white text-sm">{r.reason}</span>
                  </label>
                ))}
              </div>

              <textarea
                value={noSaleNotes} onChange={(e) => setNoSaleNotes(e.target.value)}
                placeholder="Additional notes (optional)…" rows={3}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-5"
              />

              <button
                onClick={submitNoSale}
                disabled={!noSaleId || saving}
                className="w-full py-4 bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-40 rounded-2xl text-white font-bold text-lg transition-all"
              >
                {saving ? 'Saving…' : 'Submit No Sale'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
