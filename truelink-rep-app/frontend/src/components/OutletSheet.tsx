import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import { haversineDistance, getCurrentPosition, fmtETB, today } from '../lib/utils'
import { CartItem } from '../types'

type ProxState = 'idle' | 'checking' | 'ok' | 'blocked' | 'flagging' | 'flagged' | 'error'
type View      = 'sheet' | 'sell' | 'nosale'
type SaleType  = 'paid' | 'free'

const FREE_GOODS_REASONS = ['Promotion / Campaign', 'Damaged goods replacement', 'Sample', 'Goodwill / Loyalty', 'Other']

interface Props {
  onClose:    () => void
  // When set, this is a walk-in sale — outlet was just created, skip proximity
  walkInOutlet?: {
    id: string; outlet_name: string; latitude: number; longitude: number
    land_mark: string | null; phone_number: string | null
  }
}

export default function OutletSheet({ onClose, walkInOutlet }: Props) {
  const {
    activeOutletId, todayStops, stockLoads, products, reasons,
    activeRep, routePlanId, dayNumber,
    setStockLoads, updateStopVisit,
    proximityRadius, darkMode,
  } = useRepStore()

  const stop    = walkInOutlet ? null : todayStops.find((s) => s.outlet_id === activeOutletId)
  const outlet  = walkInOutlet || stop?.outlet

  const [view,          setView]          = useState<View>(walkInOutlet ? 'sell' : 'sheet')
  const [proxState,     setProxState]     = useState<ProxState>(walkInOutlet ? 'ok' : 'idle')
  const [proxDist,      setProxDist]      = useState<number | null>(null)
  const [userCoords,    setUserCoords]    = useState<{ lat: number; lon: number } | null>(null)
  const [flagReason,    setFlagReason]    = useState('')
  const [cart,          setCart]          = useState<CartItem[]>([])
  const [noSaleId,      setNoSaleId]      = useState('')
  const [noSaleNotes,   setNoSaleNotes]   = useState('')
  const [saving,        setSaving]        = useState(false)

  // Free goods
  const [saleType,      setSaleType]      = useState<SaleType>('paid')
  const [freeReason,    setFreeReason]    = useState('')

  useEffect(() => {
    if (!walkInOutlet && activeOutletId) checkProximity()
    if (walkInOutlet) getCurrentPosition().then((p) => setUserCoords({ lat: p.coords.latitude, lon: p.coords.longitude })).catch(() => {})
  }, [activeOutletId, walkInOutlet])

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
      setProxState(dist <= proximityRadius ? 'ok' : 'blocked')
    } catch { setProxState('error') }
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
    setProxState('flagged'); setFlagReason('')
  }

  const canProceed = proxState === 'ok' || proxState === 'flagged' || !!walkInOutlet

  const updateQty = (idx: number, delta: number) => {
    setCart((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      return { ...item, quantity: Math.max(0, Math.min(item.stock, item.quantity + delta)) }
    }))
  }

  const isFreeGoods  = saleType === 'free'
  const cartTotal    = isFreeGoods ? 0 : cart.reduce((a, i) => a + i.quantity * i.product.unit_price, 0)
  const cartHasItems = cart.some((i) => i.quantity > 0)

  // Auto-end day on last sale
  const maybeEndDay = async () => {
    if (!activeRep) return
    const remaining = todayStops.filter((s) => !s.visit || s.visit.visit_status === 'not_visited').length
    if (remaining <= 1) {
      // Last stop — auto-log end time
      const { data: existing } = await supabase.from('rep_day_logs')
        .select('end_time').eq('sales_rep_id', activeRep.id).eq('log_date', today()).maybeSingle()
      if (existing && !existing.end_time) {
        await supabase.from('rep_day_logs').update({
          end_time: new Date().toISOString(),
        }).eq('sales_rep_id', activeRep.id).eq('log_date', today())
      }
    }
  }

  const completeSale = async () => {
    if (!cartHasItems || !activeRep || !outlet) return
    if (isFreeGoods && !freeReason) return
    const outletId    = outlet.id
    const saleDate    = today()
    setSaving(true)

    const records = cart.filter((i) => i.quantity > 0).map((i) => ({
      route_plan_id:     routePlanId || null,
      day_number:        dayNumber   || null,
      outlet_id:         outletId,
      sales_rep_id:      activeRep.id,
      product_id:        i.product.id,
      quantity:          i.quantity,
      unit_price:        isFreeGoods ? 0 : i.product.unit_price,
      total_price:       isFreeGoods ? 0 : i.quantity * i.product.unit_price,
      sale_date:         saleDate,
      is_free_goods:     isFreeGoods,
      free_goods_reason: isFreeGoods ? freeReason : null,
    }))

    const { data: inserted } = await supabase.from('sales_records').insert(records).select()

    // Deduct stock regardless of free goods
    for (const item of cart.filter((i) => i.quantity > 0)) {
      await supabase.from('stock_loads')
        .update({ current_balance: item.stock - item.quantity })
        .eq('sales_rep_id', activeRep.id)
        .eq('product_id', item.product.id)
        .eq('load_date', saleDate)
    }

    const { data: newStock } = await supabase.from('stock_loads')
      .select('*').eq('sales_rep_id', activeRep.id).eq('load_date', saleDate)
    if (newStock) setStockLoads(newStock)

    // Record visit for route stops (not walk-ins)
    if (!walkInOutlet && routePlanId && dayNumber) {
      const { data: visit } = await supabase.from('outlet_visits').upsert({
        route_plan_id: routePlanId, day_number: dayNumber,
        outlet_id: outletId, sales_rep_id: activeRep.id,
        visit_date: saleDate, visit_status: 'sold',
        checkin_lat: userCoords?.lat, checkin_lon: userCoords?.lon,
        checkin_distance_m: proxDist, checkin_within_radius: proxState === 'ok',
        checkin_flagged: proxState === 'flagged', visited_at: new Date().toISOString(),
      }, { onConflict: 'route_plan_id,day_number,outlet_id' }).select().single()
      if (visit && stop) updateStopVisit(outletId, visit, inserted || [])
    }

    await maybeEndDay()
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
      non_sale_reason_id: noSaleId, non_sale_notes: noSaleNotes.trim() || null,
      checkin_lat: userCoords?.lat, checkin_lon: userCoords?.lon,
      checkin_distance_m: proxDist, checkin_within_radius: proxState === 'ok',
      checkin_flagged: proxState === 'flagged', visited_at: new Date().toISOString(),
    }, { onConflict: 'route_plan_id,day_number,outlet_id' }).select().single()
    if (visit && stop) updateStopVisit(outlet.id, visit)
    await maybeEndDay()
    setSaving(false)
    onClose()
  }

  if (!outlet) return null

  const bg   = darkMode ? 'bg-slate-900' : 'bg-white'
  const card = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'
  const text = darkMode ? 'text-white'   : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'
  const inp  = darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative ${bg} rounded-t-2xl max-h-[92vh] flex flex-col`}>
        <div className="flex justify-center pt-3 pb-1">
          <div className={`w-10 h-1 ${darkMode ? 'bg-slate-700' : 'bg-slate-300'} rounded-full`} />
        </div>

        <div className="overflow-y-auto flex-1">

          {/* ── Sheet ── */}
          {view === 'sheet' && (
            <div className="px-5 pb-8">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h2 className={`${text} font-bold text-lg truncate`}>{outlet.outlet_name}</h2>
                  {outlet.land_mark    && <p className={`${sub} text-sm`}>📍 {outlet.land_mark}</p>}
                  {outlet.phone_number && <p className={`${sub} text-sm`}>📞 {outlet.phone_number}</p>}
                  {stop && <p className={`${sub} text-xs mt-1`}>Stop #{stop.sequence}</p>}
                </div>
                <button onClick={onClose} className={`${sub} text-2xl ml-3`}>×</button>
              </div>

              {stop?.visit && stop.visit.visit_status !== 'not_visited' && (
                <div className={`rounded-xl px-3 py-2 mb-4 text-sm font-medium ${
                  stop.visit.visit_status === 'sold'    ? 'bg-green-900/50 text-green-400' :
                  stop.visit.visit_status === 'no_sale' ? 'bg-amber-900/50 text-amber-400' :
                  'bg-slate-700 text-slate-400'
                }`}>
                  {stop.visit.visit_status === 'sold'    && `✅ Sold — ${fmtETB((stop.sales||[]).filter((r) => !r.is_free_goods).reduce((a,r)=>a+r.total_price,0))}`}
                  {stop.visit.visit_status === 'no_sale' && '🟡 No sale recorded'}
                  {stop.visit.visit_status === 'closed'  && '⚫ Marked as closed'}
                </div>
              )}

              {/* Proximity */}
              <div className="mb-5">
                {proxState === 'checking' && (
                  <div className={`flex items-center gap-2 ${sub} text-sm`}>
                    <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />Getting location…
                  </div>
                )}
                {proxState === 'ok' && (
                  <div className="bg-green-900/30 border border-green-800 rounded-xl px-3 py-2 text-green-400 text-sm">
                    ✅ {proxDist}m away — within {proximityRadius}m radius
                  </div>
                )}
                {proxState === 'flagged' && (
                  <div className="bg-amber-900/30 border border-amber-800 rounded-xl px-3 py-2 text-amber-400 text-sm">⚠ Issue flagged — entry allowed</div>
                )}
                {proxState === 'error' && (
                  <div className="bg-red-900/30 border border-red-800 rounded-xl p-3">
                    <p className="text-red-400 text-sm mb-2">Location unavailable. Enable GPS.</p>
                    <button onClick={checkProximity} className="text-blue-400 text-sm underline">Try again</button>
                  </div>
                )}
                {proxState === 'blocked' && (
                  <div className="bg-amber-900/30 border border-amber-800 rounded-xl p-3 space-y-2">
                    <p className="text-amber-400 text-sm font-medium">⚠ You are {proxDist}m away (max {proximityRadius}m)</p>
                    <div className="flex gap-2">
                      <button onClick={checkProximity} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium">Try Again</button>
                      <button onClick={() => setProxState('flagging')} className="flex-1 py-2 border border-amber-600 text-amber-400 rounded-lg text-sm">Flag Issue</button>
                    </div>
                  </div>
                )}
                {proxState === 'flagging' && (
                  <div className="space-y-3">
                    <p className={`${text} font-medium text-sm`}>Why can't you be at this outlet?</p>
                    {['Customer not available','Outlet closed','Road blocked','Wrong address in system'].map((r) => (
                      <label key={r} className={`flex items-center gap-3 p-3 ${card} border rounded-xl cursor-pointer`}>
                        <input type="radio" value={r} checked={flagReason===r} onChange={() => setFlagReason(r)} className="accent-blue-600" />
                        <span className={`${text} text-sm`}>{r}</span>
                      </label>
                    ))}
                    <div className="flex gap-2">
                      <button onClick={() => setProxState('blocked')} className={`flex-1 py-2 border border-slate-600 ${sub} rounded-lg text-sm`}>Back</button>
                      <button onClick={submitFlag} disabled={!flagReason} className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">Submit & Continue</button>
                    </div>
                  </div>
                )}
              </div>

              {canProceed && (
                <div className="space-y-3">
                  <button onClick={() => setView('sell')}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-2xl text-white font-bold text-lg transition-all flex items-center justify-center gap-3">
                    <span className="text-2xl">🛒</span> Sell Products
                  </button>
                  {!walkInOutlet && (
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => setView('nosale')}
                        className={`py-3 ${card} border hover:opacity-80 active:scale-95 rounded-2xl ${text} font-medium`}>✗ No Sale</button>
                      <a href={`https://maps.google.com/?daddr=${outlet.latitude},${outlet.longitude}`}
                        target="_blank" rel="noreferrer"
                        className={`py-3 ${card} border hover:opacity-80 rounded-2xl ${text} font-medium flex items-center justify-center`}>🗺 Navigate</a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Sell ── */}
          {view === 'sell' && (
            <div className="px-5 pb-8">
              <div className="flex items-center gap-3 mb-4">
                {!walkInOutlet && <button onClick={() => setView('sheet')} className={`${sub} text-2xl`}>‹</button>}
                <div className="flex-1">
                  <h2 className={`${text} font-bold`}>Sell Products</h2>
                  <p className={`${sub} text-xs`}>{outlet.outlet_name}</p>
                </div>
                <button onClick={onClose} className={`${sub} text-2xl`}>×</button>
              </div>

              {/* ── Paid / Free Goods toggle ── */}
              <div className={`${card} border rounded-2xl p-1 flex gap-1 mb-5`}>
                <button onClick={() => setSaleType('paid')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    saleType === 'paid' ? 'bg-blue-600 text-white' : `${sub}`
                  }`}>
                  💳 Paid Sale
                </button>
                <button onClick={() => setSaleType('free')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    saleType === 'free' ? 'bg-purple-600 text-white' : `${sub}`
                  }`}>
                  🎁 Free Goods
                </button>
              </div>

              {/* Free goods reason */}
              {isFreeGoods && (
                <div className="mb-5">
                  <p className={`${text} text-sm font-medium mb-2`}>Reason for free goods *</p>
                  <div className="space-y-2">
                    {FREE_GOODS_REASONS.map((r) => (
                      <label key={r} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        freeReason === r ? 'border-purple-500 bg-purple-900/20' : `${card} border`
                      }`}>
                        <input type="radio" value={r} checked={freeReason===r} onChange={() => setFreeReason(r)} className="accent-purple-600" />
                        <span className={`${text} text-sm`}>{r}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Products */}
              <div className="space-y-3 mb-6">
                {cart.map((item, i) => (
                  <div key={item.product.id}
                    className={`${card} border rounded-2xl p-4 ${item.stock === 0 ? 'opacity-40' : ''}`}>
                    <div className="flex items-center gap-3 mb-3">
                      {(item.product as typeof item.product & { image_url?: string }).image_url ? (
                        <img src={(item.product as typeof item.product & { image_url?: string }).image_url!}
                          alt={item.product.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className={`w-12 h-12 rounded-xl ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} flex items-center justify-center shrink-0`}>
                          <span className="text-xl">📦</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`${text} font-medium text-sm truncate`}>{item.product.name}</p>
                        <p className={`${sub} text-xs`}>
                          {isFreeGoods ? 'Free' : fmtETB(item.product.unit_price)} · {item.stock} left
                        </p>
                      </div>
                      {item.quantity > 0 && !isFreeGoods && (
                        <p className="text-green-400 font-semibold text-sm shrink-0">
                          {fmtETB(item.quantity * item.product.unit_price)}
                        </p>
                      )}
                      {item.quantity > 0 && isFreeGoods && (
                        <p className="text-purple-400 font-semibold text-sm shrink-0">
                          {item.quantity} × Free
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => updateQty(i, -1)} disabled={item.quantity === 0}
                        className={`w-11 h-11 rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} ${text} font-bold text-xl disabled:opacity-30 active:scale-90`}>−</button>
                      <span className={`${text} font-bold text-xl w-8 text-center`}>{item.quantity}</span>
                      <button onClick={() => updateQty(i, 1)} disabled={item.quantity >= item.stock || item.stock === 0}
                        className={`w-11 h-11 rounded-full ${isFreeGoods ? 'bg-purple-600' : 'bg-blue-600'} text-white font-bold text-xl disabled:opacity-30 active:scale-90`}>+</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Cart summary */}
              <div className="sticky bottom-0 pt-4 pb-2" style={{ background: darkMode ? '#0f172a' : '#fff' }}>
                {cartHasItems && (
                  <div className={`${card} border rounded-2xl p-4 mb-3`}>
                    <p className={`${sub} text-xs font-semibold uppercase tracking-wide mb-2`}>
                      {isFreeGoods ? '🎁 Free Goods' : '🛒 Cart'}
                    </p>
                    {cart.filter((i) => i.quantity > 0).map((item) => (
                      <div key={item.product.id} className="flex justify-between text-sm mb-1">
                        <span className={sub}>{item.product.name} × {item.quantity}</span>
                        <span className={`${isFreeGoods ? 'text-purple-400' : text} font-medium`}>
                          {isFreeGoods ? 'Free' : fmtETB(item.quantity * item.product.unit_price)}
                        </span>
                      </div>
                    ))}
                    {!isFreeGoods && (
                      <div className={`border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} mt-2 pt-2 flex justify-between`}>
                        <span className={`${text} font-semibold`}>Total</span>
                        <span className="text-green-400 font-bold text-lg">{fmtETB(cartTotal)}</span>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={completeSale}
                  disabled={!cartHasItems || saving || (isFreeGoods && !freeReason)}
                  className={`w-full py-4 active:scale-95 disabled:opacity-40 rounded-2xl text-white font-bold text-lg transition-all ${
                    isFreeGoods ? 'bg-purple-600 hover:bg-purple-700' : 'bg-green-600 hover:bg-green-700'
                  }`}>
                  {saving ? 'Saving…'
                    : isFreeGoods ? `✓ Complete — Free Goods`
                    : `✓ Complete Sale — ${fmtETB(cartTotal)}`}
                </button>
              </div>
            </div>
          )}

          {/* ── No Sale ── */}
          {view === 'nosale' && (
            <div className="px-5 pb-8">
              <div className="flex items-center gap-3 mb-5">
                <button onClick={() => setView('sheet')} className={`${sub} text-2xl`}>‹</button>
                <div>
                  <h2 className={`${text} font-bold`}>No Sale</h2>
                  <p className={`${sub} text-xs`}>{outlet.outlet_name}</p>
                </div>
              </div>
              <p className={`${sub} text-sm mb-4`}>Select a reason:</p>
              <div className="space-y-2 mb-5">
                {reasons.filter((r) => r.is_active).map((r) => (
                  <label key={r.id}
                    className={`flex items-center gap-3 p-4 rounded-2xl cursor-pointer border transition-colors ${
                      noSaleId === r.id ? 'bg-blue-900/40 border-blue-600' : `${card} border`
                    }`}>
                    <input type="radio" value={r.id} checked={noSaleId===r.id}
                      onChange={() => setNoSaleId(r.id)} className="accent-blue-600" />
                    <span className={`${text} text-sm`}>{r.reason}</span>
                  </label>
                ))}
              </div>
              <textarea value={noSaleNotes} onChange={(e) => setNoSaleNotes(e.target.value)}
                placeholder="Additional notes (optional)…" rows={3}
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-5 ${inp}`} />
              <button onClick={submitNoSale} disabled={!noSaleId || saving}
                className="w-full py-4 bg-amber-600 hover:bg-amber-700 active:scale-95 disabled:opacity-40 rounded-2xl text-white font-bold text-lg">
                {saving ? 'Saving…' : 'Submit No Sale'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
