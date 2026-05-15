import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import { fmtETB, today } from '../lib/utils'

interface Outlet {
  id: string
  outlet_name: string
  tin_number: string | null
  phone_number: string | null
  land_mark: string | null
}

interface Product {
  id: string
  name: string
  unit_price: number
  image_url?: string
  sku_code?: string
}

interface CartItem {
  product: Product
  quantity: number
  stock: number
}

type SaleType = 'paid' | 'free'
type View     = 'pos' | 'cart' | 'receipt'

const FREE_GOODS_REASONS = [
  'Promotion / Campaign',
  'Damaged goods replacement',
  'Sample',
  'Goodwill / Loyalty',
  'Other',
]

const WALKIN_OUTLET_NAME = 'Walk-in Customer'

export default function WalkInPOS() {
  const { activeRep, stockLoads, products, setStockLoads, darkMode } = useRepStore()

  const [view,          setView]         = useState<View>('pos')
  const [search,        setSearch]       = useState('')
  const [results,       setResults]      = useState<Outlet[]>([])
  const [selOutlet,     setSelOutlet]    = useState<Outlet | null>(null)
  const [showNewForm,   setShowNewForm]  = useState(false)
  const [newName,       setNewName]      = useState('')
  const [newTIN,        setNewTIN]       = useState('')
  const [newPhone,      setNewPhone]     = useState('')
  const [newLandmark,   setNewLandmark]  = useState('')
  const [savingNew,     setSavingNew]    = useState(false)

  const [cart,          setCart]         = useState<CartItem[]>([])
  const [saleType,      setSaleType]     = useState<SaleType>('paid')
  const [freeReason,    setFreeReason]   = useState('')
  const [saving,        setSaving]       = useState(false)
  const [lastReceipt,   setLastReceipt]  = useState<{
    outlet: Outlet; items: CartItem[]; total: number
    saleType: SaleType; freeReason: string; time: string
  } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  // Init cart from stock
  useEffect(() => {
    const items: CartItem[] = stockLoads
      .filter((sl) => sl.current_balance > 0)
      .map((sl) => {
        const prod = products.find((p) => p.id === sl.product_id)
        if (!prod) return null
        return { product: prod as Product, quantity: 0, stock: sl.current_balance }
      })
      .filter(Boolean) as CartItem[]
    setCart(items)
  }, [stockLoads, products])

  // Search outlets
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('outlets')
        .select('id, outlet_name, tin_number, phone_number, land_mark')
        .ilike('outlet_name', `%${search.trim()}%`)
        .eq('status', 'active')
        .limit(8)
      setResults(data || [])
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const selectOutlet = (outlet: Outlet) => {
    setSelOutlet(outlet)
    setSearch(outlet.outlet_name)
    setResults([])
  }

  const selectWalkIn = () => {
    setSelOutlet({
      id:           '__walkin__',
      outlet_name:  WALKIN_OUTLET_NAME,
      tin_number:   null,
      phone_number: null,
      land_mark:    null,
    })
    setSearch(WALKIN_OUTLET_NAME)
    setResults([])
  }

  const createAndSelect = async () => {
    if (!newName.trim()) return
    setSavingNew(true)
    const { data } = await supabase.from('outlets').insert({
      outlet_name:  newName.trim(),
      tin_number:   newTIN.trim()   || null,
      phone_number: newPhone.trim() || null,
      land_mark:    newLandmark.trim() || null,
      latitude:     0, longitude: 0,
      territory_id: null,
      status:       'active',
    }).select().single()
    setSavingNew(false)
    if (data) {
      selectOutlet(data)
      setShowNewForm(false)
      setNewName(''); setNewTIN(''); setNewPhone(''); setNewLandmark('')
    }
  }

  const updateQty = (idx: number, delta: number) => {
    setCart((prev) => prev.map((item, i) =>
      i === idx ? { ...item, quantity: Math.max(0, Math.min(item.stock, item.quantity + delta)) } : item
    ))
  }

  const isFree       = saleType === 'free'
  const cartTotal    = isFree ? 0 : cart.reduce((a, i) => a + i.quantity * i.product.unit_price, 0)
  const cartHasItems = cart.some((i) => i.quantity > 0)
  const canComplete  = cartHasItems && selOutlet && (!isFree || freeReason)

  const completeSale = async () => {
    if (!canComplete || !activeRep) return
    setSaving(true)

    let outletId = selOutlet!.id

    // If generic walk-in, create a temporary outlet record
    if (outletId === '__walkin__') {
      const { data } = await supabase.from('outlets').insert({
        outlet_name: `Walk-in — ${new Date().toLocaleString()}`,
        tin_number: null, latitude: 0, longitude: 0,
        territory_id: null, status: 'active',
      }).select().single()
      if (data) outletId = data.id
    }

    const saleDate = today()
    const records  = cart.filter((i) => i.quantity > 0).map((i) => ({
      outlet_id:          outletId,
      sales_rep_id:       activeRep.id,
      product_id:         i.product.id,
      quantity:           i.quantity,
      unit_price:         isFree ? 0 : i.product.unit_price,
      total_price:        isFree ? 0 : i.quantity * i.product.unit_price,
      sale_date:          saleDate,
      is_free_goods:      isFree,
      free_goods_reason:  isFree ? freeReason : null,
      is_walkin_sale:     true,
    }))

    await supabase.from('sales_records').insert(records)

    // Deduct stock
    for (const item of cart.filter((i) => i.quantity > 0)) {
      await supabase.from('stock_loads')
        .update({ current_balance: item.stock - item.quantity })
        .eq('sales_rep_id', activeRep.id)
        .eq('product_id',   item.product.id)
        .eq('load_date',    saleDate)
    }

    const { data: newStock } = await supabase.from('stock_loads')
      .select('*').eq('sales_rep_id', activeRep.id).eq('load_date', saleDate)
    if (newStock) setStockLoads(newStock)

    setLastReceipt({
      outlet:     selOutlet!,
      items:      cart.filter((i) => i.quantity > 0),
      total:      cartTotal,
      saleType,
      freeReason,
      time:       new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    })

    setSaving(false)
    setView('receipt')
  }

  const resetForNextSale = () => {
    setSelOutlet(null)
    setSearch('')
    setCart((prev) => prev.map((i) => ({ ...i, quantity: 0 })))
    setSaleType('paid')
    setFreeReason('')
    setView('pos')
    setLastReceipt(null)
    setTimeout(() => searchRef.current?.focus(), 100)
  }

  const bg   = darkMode ? 'bg-slate-900'   : 'bg-slate-50'
  const card = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
  const text = darkMode ? 'text-white'     : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'
  const inp  = darkMode
    ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'

  const totalBalance = stockLoads.reduce((a, s) => a + s.current_balance, 0)

  // ── Receipt ────────────────────────────────────────────────────────────────
  if (view === 'receipt' && lastReceipt) {
    return (
      <div className={`flex-1 overflow-y-auto pb-24 ${bg}`}>
        <div className="px-5 pt-8 space-y-4">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-white text-3xl">{lastReceipt.saleType === 'free' ? '🎁' : '✓'}</span>
            </div>
            <h2 className={`${text} font-bold text-xl`}>
              {lastReceipt.saleType === 'free' ? 'Free Goods Recorded' : 'Sale Complete'}
            </h2>
            <p className={`${sub} text-sm mt-1`}>{lastReceipt.time}</p>
          </div>

          <div className={`${card} border rounded-2xl p-5`}>
            <p className={`${sub} text-xs font-semibold uppercase tracking-wide mb-3`}>Customer</p>
            <p className={`${text} font-semibold`}>{lastReceipt.outlet.outlet_name}</p>
            {lastReceipt.outlet.tin_number && (
              <p className={`${sub} text-xs mt-1`}>TIN: {lastReceipt.outlet.tin_number}</p>
            )}
            {lastReceipt.outlet.phone_number && (
              <p className={`${sub} text-xs`}>📞 {lastReceipt.outlet.phone_number}</p>
            )}
          </div>

          <div className={`${card} border rounded-2xl p-5`}>
            <p className={`${sub} text-xs font-semibold uppercase tracking-wide mb-3`}>Items</p>
            {lastReceipt.items.map((item) => (
              <div key={item.product.id} className="flex justify-between py-2 border-b border-slate-700/30 last:border-0">
                <div>
                  <p className={`${text} text-sm font-medium`}>{item.product.name}</p>
                  <p className={`${sub} text-xs`}>× {item.quantity}</p>
                </div>
                <p className={`${lastReceipt.saleType === 'free' ? 'text-purple-400' : 'text-green-400'} font-semibold`}>
                  {lastReceipt.saleType === 'free' ? 'Free' : fmtETB(item.quantity * item.product.unit_price)}
                </p>
              </div>
            ))}
            {lastReceipt.saleType === 'paid' && (
              <div className="flex justify-between mt-3 pt-2 border-t border-slate-700/30">
                <p className={`${text} font-bold`}>Total</p>
                <p className="text-green-400 font-bold text-lg">{fmtETB(lastReceipt.total)}</p>
              </div>
            )}
            {lastReceipt.saleType === 'free' && (
              <p className={`${sub} text-xs mt-2`}>Reason: {lastReceipt.freeReason}</p>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <button onClick={resetForNextSale}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-2xl text-white font-bold text-lg">
              New Sale
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── POS / Cart ─────────────────────────────────────────────────────────────
  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${bg}`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-5 py-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-white font-bold text-lg">Walk-in Sales</h1>
            <p className="text-blue-200 text-xs">{activeRep?.name} · {totalBalance} units in stock</p>
          </div>
          <button onClick={() => useRepStore.getState().setDarkMode(!darkMode)}
            className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center text-white">
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-6">

        {/* ── Customer selector ── */}
        <div className={`${card} border rounded-2xl p-4`}>
          <p className={`${text} font-semibold text-sm mb-3`}>
            {selOutlet ? '✅ Customer Selected' : 'Select Customer'}
          </p>

          {selOutlet ? (
            <div className="flex items-start justify-between">
              <div>
                <p className={`${text} font-medium`}>{selOutlet.outlet_name}</p>
                {selOutlet.tin_number    && <p className={`${sub} text-xs mt-0.5`}>TIN: {selOutlet.tin_number}</p>}
                {selOutlet.phone_number  && <p className={`${sub} text-xs`}>📞 {selOutlet.phone_number}</p>}
                {selOutlet.land_mark     && <p className={`${sub} text-xs`}>📍 {selOutlet.land_mark}</p>}
              </div>
              <button onClick={() => { setSelOutlet(null); setSearch('') }}
                className="text-blue-400 text-sm font-medium shrink-0 ml-3">Change</button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by customer name…"
                  className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`}
                />
                {results.length > 0 && (
                  <div className={`absolute top-full left-0 right-0 z-20 mt-1 ${card} border rounded-xl shadow-xl overflow-hidden`}>
                    {results.map((r) => (
                      <button key={r.id} onClick={() => selectOutlet(r)}
                        className={`w-full text-left px-4 py-3 border-b ${darkMode ? 'border-slate-700 hover:bg-slate-700' : 'border-slate-100 hover:bg-slate-50'} last:border-0`}>
                        <p className={`${text} text-sm font-medium`}>{r.outlet_name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {r.tin_number    && <p className={`${sub} text-xs`}>TIN: {r.tin_number}</p>}
                          {r.phone_number  && <p className={`${sub} text-xs`}>{r.phone_number}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Quick options */}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={selectWalkIn}
                  className={`py-3 border-2 border-dashed ${darkMode ? 'border-slate-600 text-slate-400' : 'border-slate-300 text-slate-500'} rounded-xl text-sm font-medium hover:border-blue-500 hover:text-blue-500 active:scale-95`}>
                  👤 Walk-in Customer
                </button>
                <button onClick={() => setShowNewForm(!showNewForm)}
                  className={`py-3 border-2 border-dashed ${darkMode ? 'border-slate-600 text-slate-400' : 'border-slate-300 text-slate-500'} rounded-xl text-sm font-medium hover:border-green-500 hover:text-green-500 active:scale-95`}>
                  ➕ New Customer
                </button>
              </div>

              {/* New customer form */}
              {showNewForm && (
                <div className={`${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'} rounded-xl p-4 space-y-3`}>
                  <p className={`${text} text-sm font-semibold`}>New Customer</p>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)}
                    placeholder="Customer / outlet name *"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
                  <input value={newTIN} onChange={(e) => setNewTIN(e.target.value)}
                    placeholder="TIN number (optional)"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="Phone number (optional)"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
                  <input value={newLandmark} onChange={(e) => setNewLandmark(e.target.value)}
                    placeholder="Landmark (optional)"
                    className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
                  <div className="flex gap-2">
                    <button onClick={() => setShowNewForm(false)}
                      className={`flex-1 py-2 border ${darkMode ? 'border-slate-600 text-slate-400' : 'border-slate-300 text-slate-600'} rounded-xl text-sm`}>
                      Cancel
                    </button>
                    <button onClick={createAndSelect} disabled={!newName.trim() || savingNew}
                      className="flex-1 py-2 bg-green-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                      {savingNew ? 'Saving…' : 'Create & Select'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sale type toggle ── */}
        {selOutlet && (
          <div className={`${card} border rounded-2xl p-1 flex gap-1`}>
            <button onClick={() => setSaleType('paid')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                saleType === 'paid' ? 'bg-blue-600 text-white' : sub
              }`}>
              💳 Paid Sale
            </button>
            <button onClick={() => setSaleType('free')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                saleType === 'free' ? 'bg-purple-600 text-white' : sub
              }`}>
              🎁 Free Goods
            </button>
          </div>
        )}

        {/* ── Free goods reason ── */}
        {selOutlet && isFree && (
          <div className={`${card} border rounded-2xl p-4`}>
            <p className={`${text} text-sm font-medium mb-3`}>Reason for free goods *</p>
            <div className="space-y-2">
              {FREE_GOODS_REASONS.map((r) => (
                <label key={r} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  freeReason === r
                    ? 'border-purple-500 bg-purple-900/20'
                    : `${card} border`
                }`}>
                  <input type="radio" value={r} checked={freeReason === r}
                    onChange={() => setFreeReason(r)} className="accent-purple-600" />
                  <span className={`${text} text-sm`}>{r}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── Products ── */}
        {selOutlet && (
          <div className="space-y-3">
            <p className={`${sub} text-xs font-semibold uppercase tracking-wide px-1`}>Products</p>
            {cart.length === 0 && (
              <div className={`${card} border rounded-2xl p-8 text-center`}>
                <p className="text-4xl mb-2">📦</p>
                <p className={`${sub} text-sm`}>No stock loaded. Request stock first.</p>
              </div>
            )}
            {cart.map((item, i) => (
              <div key={item.product.id}
                className={`${card} border rounded-2xl p-4 ${item.stock === 0 ? 'opacity-40' : ''}`}>
                <div className="flex items-center gap-3 mb-3">
                  {item.product.image_url ? (
                    <img src={item.product.image_url} alt={item.product.name}
                      className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className={`w-12 h-12 rounded-xl ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} flex items-center justify-center shrink-0`}>
                      <span className="text-2xl">📦</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`${text} font-medium text-sm truncate`}>{item.product.name}</p>
                    <p className={`${sub} text-xs`}>
                      {isFree ? 'Free' : fmtETB(item.product.unit_price)} · {item.stock} in stock
                    </p>
                  </div>
                  {item.quantity > 0 && (
                    <p className={`${isFree ? 'text-purple-400' : 'text-green-400'} font-bold shrink-0`}>
                      {isFree ? `${item.quantity} × Free` : fmtETB(item.quantity * item.product.unit_price)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <button onClick={() => updateQty(i, -1)} disabled={item.quantity === 0}
                    className={`w-12 h-12 rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} ${text} font-bold text-2xl disabled:opacity-30 active:scale-90 flex items-center justify-center`}>
                    −
                  </button>
                  <span className={`${text} font-bold text-2xl flex-1 text-center`}>{item.quantity}</span>
                  <button onClick={() => updateQty(i, 1)}
                    disabled={item.quantity >= item.stock || item.stock === 0}
                    className={`w-12 h-12 rounded-full ${isFree ? 'bg-purple-600' : 'bg-blue-600'} text-white font-bold text-2xl disabled:opacity-30 active:scale-90 flex items-center justify-center`}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Cart summary + Complete ── */}
        {selOutlet && cartHasItems && (
          <div className={`${card} border rounded-2xl p-5`}>
            <p className={`${sub} text-xs font-semibold uppercase tracking-wide mb-3`}>
              {isFree ? '🎁 Free Goods Summary' : '🛒 Cart Summary'}
            </p>
            {cart.filter((i) => i.quantity > 0).map((item) => (
              <div key={item.product.id} className="flex justify-between py-1.5">
                <span className={`${sub} text-sm`}>{item.product.name} × {item.quantity}</span>
                <span className={`${isFree ? 'text-purple-400' : text} text-sm font-medium`}>
                  {isFree ? 'Free' : fmtETB(item.quantity * item.product.unit_price)}
                </span>
              </div>
            ))}
            {!isFree && (
              <div className={`border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} mt-3 pt-3 flex justify-between`}>
                <span className={`${text} font-bold`}>Total</span>
                <span className="text-green-400 font-bold text-xl">{fmtETB(cartTotal)}</span>
              </div>
            )}
          </div>
        )}

        {selOutlet && (
          <button onClick={completeSale} disabled={!canComplete || saving}
            className={`w-full py-5 active:scale-95 disabled:opacity-40 rounded-2xl text-white font-bold text-lg transition-all ${
              !cartHasItems     ? 'bg-slate-600 cursor-not-allowed' :
              isFree            ? 'bg-purple-600 hover:bg-purple-700' :
              'bg-green-600 hover:bg-green-700'
            }`}>
            {saving             ? 'Processing…'                       :
             !cartHasItems      ? 'Add items to complete'             :
             isFree             ? '✓ Complete — Free Goods'           :
             `✓ Complete Sale — ${fmtETB(cartTotal)}`}
          </button>
        )}

        {!selOutlet && (
          <div className={`${card} border rounded-2xl p-8 text-center`}>
            <p className="text-5xl mb-3">🏪</p>
            <p className={`${text} font-semibold mb-1`}>Select a customer to begin</p>
            <p className={`${sub} text-sm`}>Search existing customers or tap Walk-in Customer for a quick sale</p>
          </div>
        )}
      </div>
    </div>
  )
}
