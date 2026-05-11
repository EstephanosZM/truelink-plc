import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

interface Rep      { id: string; name: string; monthly_target: number }
interface Product  { id: string; name: string; sku_code: string | null; unit_price: number }
interface StockRow { productId: string; quantityAdded: number }
interface StockLoad {
  id: string; sales_rep_id: string; product_id: string
  load_date: string; quantity_added: number; current_balance: number
  quantity_returned: number; is_finalized: boolean
}
interface SalesRecord { product_id: string; quantity: number; outlet_id: string }
interface NonSaleReason { id: string; reason: string; is_active: boolean }
interface LiveStatus {
  rep: Rep
  loads: StockLoad[]
  soldUnits: number
}

export default function StockPage() {
  const [tab, setTab] = useState<'load' | 'live' | 'eod' | 'reasons'>('live')
  const [reps,     setReps]     = useState<Rep[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [reasons,  setReasons]  = useState<NonSaleReason[]>([])
  const [liveData, setLiveData] = useState<LiveStatus[]>([])
  const [loading,  setLoading]  = useState(false)

  // Load stock form
  const [selRep,     setSelRep]     = useState('')
  const [routeDate,  setRouteDate]  = useState(new Date().toISOString().split('T')[0])
  const [stockRows,  setStockRows]  = useState<StockRow[]>([{ productId: '', quantityAdded: 0 }])
  const [saving,     setSaving]     = useState(false)
  const [saveMsg,    setSaveMsg]    = useState('')

  // Reason form
  const [newReason,  setNewReason]  = useState('')
  const [addingRsn,  setAddingRsn]  = useState(false)

  const today = new Date().toISOString().split('T')[0]

  useEffect(() => { loadBase() }, [])
  useEffect(() => { if (tab === 'live') loadLive() }, [tab])

  const loadBase = async () => {
    const [r, p, rsn] = await Promise.all([
      supabase.from('sales_representatives').select('id, name, monthly_target').order('name'),
      supabase.from('products').select('id, name, sku_code, unit_price').eq('status', 'active').order('name'),
      supabase.from('non_sale_reasons').select('*').order('reason'),
    ])
    if (r.data)   setReps(r.data)
    if (p.data)   setProducts(p.data)
    if (rsn.data) setReasons(rsn.data)
  }

  const loadLive = useCallback(async () => {
    setLoading(true)
    const { data: loads } = await supabase
      .from('stock_loads').select('*').eq('load_date', today)

    const { data: sales } = await supabase
      .from('sales_records').select('product_id, quantity, outlet_id').eq('sale_date', today)

    const { data: allReps } = await supabase
      .from('sales_representatives').select('id, name, monthly_target').order('name')

    if (!allReps) { setLoading(false); return }

    const statuses: LiveStatus[] = allReps.map((rep: Rep) => {
      const repLoads = (loads || []).filter((l: StockLoad) => l.sales_rep_id === rep.id)
      const repSales = (sales || []).filter((s: SalesRecord) => {
        // Check if this sale belongs to this rep's outlets (approximate by rep_id on sales_records)
        return true // We'll match via sales_records.sales_rep_id if available
      })
      const { data: repSalesFiltered } = { data: (sales||[]) }
      const soldUnits = 0 // Will be loaded below
      return { rep, loads: repLoads, soldUnits }
    })

    // Load sales per rep properly
    const { data: repSalesAll } = await supabase
      .from('sales_records').select('sales_rep_id, quantity').eq('sale_date', today)

    const salesByRep: Record<string, number> = {}
    ;(repSalesAll || []).forEach((r: { sales_rep_id: string; quantity: number }) => {
      salesByRep[r.sales_rep_id] = (salesByRep[r.sales_rep_id] || 0) + r.quantity
    })

    const finalStatuses: LiveStatus[] = allReps.map((rep: Rep) => {
      const repLoads = (loads || []).filter((l: StockLoad) => l.sales_rep_id === rep.id)
      return { rep, loads: repLoads, soldUnits: salesByRep[rep.id] || 0 }
    })

    setLiveData(finalStatuses)
    setLoading(false)
  }, [today])

  // Load current balance when rep + date changes
  const loadExistingStock = async () => {
    if (!selRep) return
    const { data } = await supabase.from('stock_loads')
      .select('*').eq('sales_rep_id', selRep).eq('load_date', routeDate)
    if (data && data.length > 0) {
      setStockRows(data.map((s: StockLoad) => ({
        productId: s.product_id, quantityAdded: 0,
      })))
    }
  }

  useEffect(() => { if (selRep) loadExistingStock() }, [selRep, routeDate])

  const saveStock = async () => {
    if (!selRep) return
    const valid = stockRows.filter((r) => r.productId && r.quantityAdded > 0)
    if (!valid.length) return
    setSaving(true); setSaveMsg('')

    for (const row of valid) {
      // Check if record exists
      const { data: existing } = await supabase.from('stock_loads')
        .select('*').eq('sales_rep_id', selRep)
        .eq('product_id', row.productId).eq('load_date', routeDate).single()

      if (existing) {
        // Increment current_balance
        await supabase.from('stock_loads').update({
          current_balance:  existing.current_balance + row.quantityAdded,
          quantity_added:   existing.quantity_added  + row.quantityAdded,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id)
      } else {
        await supabase.from('stock_loads').insert({
          sales_rep_id: selRep, product_id: row.productId,
          load_date: routeDate, quantity_added: row.quantityAdded,
          current_balance: row.quantityAdded,
        })
      }
    }

    setSaving(false)
    setSaveMsg('Stock saved successfully!')
    setStockRows([{ productId: '', quantityAdded: 0 }])
    setTimeout(() => setSaveMsg(''), 3000)
  }

  const addStockRow = () => setStockRows([...stockRows, { productId: '', quantityAdded: 0 }])
  const updateRow   = (i: number, field: keyof StockRow, val: string | number) =>
    setStockRows(stockRows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  const removeRow   = (i: number) => setStockRows(stockRows.filter((_, idx) => idx !== i))

  const addReason = async () => {
    if (!newReason.trim()) return
    setAddingRsn(true)
    const { data } = await supabase.from('non_sale_reasons')
      .insert({ reason: newReason.trim() }).select().single()
    if (data) setReasons([...reasons, data])
    setNewReason(''); setAddingRsn(false)
  }

  const toggleReason = async (id: string, active: boolean) => {
    await supabase.from('non_sale_reasons').update({ is_active: !active }).eq('id', id)
    setReasons(reasons.map((r) => r.id === id ? { ...r, is_active: !active } : r))
  }

  const deleteReason = async (id: string) => {
    await supabase.from('non_sale_reasons').delete().eq('id', id)
    setReasons(reasons.filter((r) => r.id !== id))
  }

  const tabs = [
    { key: 'live',    label: '🟢 Live Status'    },
    { key: 'load',    label: '📦 Load Stock'      },
    { key: 'eod',     label: '🌙 End of Day'      },
    { key: 'reasons', label: '📋 No-Sale Reasons' },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold text-slate-900 mb-5">Stock Management</h1>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 mb-6 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Live Status ── */}
        {tab === 'live' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Today — {new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}</p>
              <button onClick={loadLive} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                ↻ Refresh
              </button>
            </div>

            {loading && <div className="text-center py-8 text-slate-400">Loading…</div>}

            {liveData.map(({ rep, loads, soldUnits }) => {
              const totalBalance = loads.reduce((a, l) => a + l.current_balance, 0)
              const totalLoaded  = loads.reduce((a, l) => a + l.current_balance + (l.quantity_added || 0), 0)
              const pct = totalLoaded > 0 ? Math.round(soldUnits / totalLoaded * 100) : 0
              const barColor = pct >= 50 ? 'bg-green-500' : pct >= 20 ? 'bg-amber-500' : 'bg-red-500'

              return (
                <div key={rep.id} className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-slate-900">{rep.name}</p>
                      <p className="text-xs text-slate-500">
                        {loads.length > 0 ? `${loads.length} products loaded` : 'No stock loaded today'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{soldUnits} sold</p>
                      <p className="text-xs text-slate-500">{totalBalance} remaining</p>
                    </div>
                  </div>

                  {totalLoaded > 0 && (
                    <>
                      <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
                        <div className={`h-2 rounded-full transition-all ${barColor}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <div className="space-y-1.5">
                        {loads.map((sl) => {
                          const prod     = products.find((p) => p.id === sl.product_id)
                          const slLoaded = sl.current_balance + (sl.quantity_added || 0)
                          return (
                            <div key={sl.id} className="flex items-center text-xs text-slate-600 gap-2">
                              <span className="flex-1 truncate">{prod?.name || 'Unknown'}</span>
                              <span className="text-slate-400 shrink-0">
                                Loaded: {slLoaded} · Left: {sl.current_balance}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {!loading && liveData.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <p className="text-4xl mb-3">📦</p>
                <p>No reps found. Add sales representatives in Settings.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Load Stock ── */}
        {tab === 'load' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
            <h2 className="font-semibold text-slate-900 mb-4">Load Stock for Rep</h2>

            <div className="space-y-4 mb-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sales Rep</label>
                <select value={selRep} onChange={(e) => setSelRep(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  <option value="">Select rep</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Route Date</label>
                <input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-3 bg-blue-50 px-3 py-2 rounded-lg">
              ℹ Stock is incremental — quantities entered here are added to the rep's existing balance.
            </p>

            <div className="space-y-2 mb-4">
              {stockRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select value={row.productId} onChange={(e) => updateRow(i, 'productId', e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                    <option value="">Select product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" min={0} value={row.quantityAdded}
                    onChange={(e) => updateRow(i, 'quantityAdded', parseInt(e.target.value)||0)}
                    className="w-20 px-2 py-2 border border-slate-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Qty" />
                  {stockRows.length > 1 && (
                    <button onClick={() => removeRow(i)} className="text-slate-400 hover:text-red-500 text-lg">×</button>
                  )}
                </div>
              ))}
            </div>

            <button onClick={addStockRow}
              className="text-sm text-blue-600 hover:text-blue-800 mb-5 font-medium">
              + Add product
            </button>

            {saveMsg && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg mb-3">{saveMsg}</p>}

            <button onClick={saveStock} disabled={saving || !selRep}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Stock Load'}
            </button>
          </div>
        )}

        {/* ── End of Day ── */}
        {tab === 'eod' && (
          <EodTab reps={reps} products={products} today={today} />
        )}

        {/* ── Non-Sale Reasons ── */}
        {tab === 'reasons' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
            <h2 className="font-semibold text-slate-900 mb-4">No-Sale Reasons</h2>
            <div className="flex gap-2 mb-5">
              <input value={newReason} onChange={(e) => setNewReason(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addReason()}
                placeholder="New reason…"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={addReason} disabled={addingRsn || !newReason.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                Add
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {reasons.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${r.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />
                    <span className="text-sm text-slate-900">{r.reason}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => toggleReason(r.id, r.is_active)}
                      className="text-xs text-slate-500 hover:text-slate-700">
                      {r.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => deleteReason(r.id)}
                      className="text-xs text-red-500 hover:text-red-700">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// End of Day sub-component
function EodTab({ reps, products, today }: { reps: Rep[]; products: Product[]; today: string }) {
  const [selRep,   setSelRep]   = useState('')
  const [loads,    setLoads]    = useState<StockLoad[]>([])
  const [returns,  setReturns]  = useState<Record<string, number>>({})
  const [saving,   setSaving]   = useState(false)
  const [msg,      setMsg]      = useState('')

  const loadRepStock = async (repId: string) => {
    const { data } = await supabase.from('stock_loads')
      .select('*').eq('sales_rep_id', repId).eq('load_date', today)
    setLoads(data || [])
    const init: Record<string, number> = {}
    ;(data || []).forEach((l: StockLoad) => { init[l.id] = l.quantity_returned })
    setReturns(init)
  }

  useEffect(() => { if (selRep) loadRepStock(selRep) }, [selRep])

  const save = async () => {
    setSaving(true)
    for (const load of loads) {
      const ret = returns[load.id] || 0
      await supabase.from('stock_loads').update({
        quantity_returned: ret,
        is_finalized: true,
        current_balance: Math.max(0, load.current_balance - ret),
      }).eq('id', load.id)
    }
    setSaving(false)
    setMsg('End of day stock recorded!')
    setTimeout(() => setMsg(''), 3000)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
      <h2 className="font-semibold text-slate-900 mb-4">End of Day — Record Returns</h2>
      <div className="mb-5">
        <label className="block text-sm font-medium text-slate-700 mb-1">Sales Rep</label>
        <select value={selRep} onChange={(e) => setSelRep(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          <option value="">Select rep</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {loads.length > 0 && (
        <>
          <div className="space-y-3 mb-5">
            {loads.map((l) => {
              const prod = products.find((p) => p.id === l.product_id)
              return (
                <div key={l.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-slate-700 truncate">{prod?.name}</span>
                  <span className="text-xs text-slate-400 shrink-0">Balance: {l.current_balance}</span>
                  <input type="number" min={0} max={l.current_balance}
                    value={returns[l.id] || 0}
                    onChange={(e) => setReturns({ ...returns, [l.id]: parseInt(e.target.value)||0 })}
                    className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Return" />
                </div>
              )
            })}
          </div>
          {msg && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg mb-3">{msg}</p>}
          <button onClick={save} disabled={saving}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Record Returns'}
          </button>
        </>
      )}
      {selRep && loads.length === 0 && (
        <p className="text-slate-400 text-sm text-center py-6">No stock loaded for this rep today</p>
      )}
    </div>
  )
}
