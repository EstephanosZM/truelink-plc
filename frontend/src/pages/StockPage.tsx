import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

interface Rep      { id: string; name: string }
interface Product  { id: string; name: string; sku_code: string | null; unit_price: number }
interface WStock   { product_id: string; quantity: number; min_level: number; products: { name: string } }
interface StockReq {
  id: string; sales_rep_id: string; product_id: string
  quantity_requested: number; quantity_approved: number | null
  request_date: string; route_date: string; status: string
  request_notes: string | null; manager_notes: string | null
  sales_representatives: { name: string }
  products: { name: string }
}
interface Receipt {
  id: string; product_id: string; quantity: number
  supplier: string | null; received_by: string | null
  notes: string | null; received_at: string
  products: { name: string }
}
interface StockLoad {
  id: string; sales_rep_id: string; product_id: string
  load_date: string; quantity_added: number; current_balance: number
  quantity_returned: number; is_finalized: boolean
}
interface NonSaleReason { id: string; reason: string; is_active: boolean }

export default function StockPage() {
  const [tab, setTab] = useState<'warehouse' | 'requests' | 'live' | 'eod' | 'reasons'>('warehouse')
  const [reps,     setReps]     = useState<Rep[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(false)

  useEffect(() => { loadBase() }, [])

  const loadBase = async () => {
    const [r, p] = await Promise.all([
      supabase.from('sales_representatives').select('id, name').order('name'),
      supabase.from('products').select('id, name, sku_code, unit_price').eq('status', 'active').order('name'),
    ])
    if (r.data) setReps(r.data)
    if (p.data) setProducts(p.data)
  }

  const tabs = [
    { key: 'warehouse', label: '🏭 Warehouse'      },
    { key: 'requests',  label: '📋 Stock Requests'  },
    { key: 'live',      label: '🟢 Live Status'     },
    { key: 'eod',       label: '🌙 End of Day'      },
    { key: 'reasons',   label: '📝 No-Sale Reasons' },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-slate-900 mb-5">Stock Management</h1>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 mb-6 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
              className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'warehouse' && <WarehouseTab products={products} />}
        {tab === 'requests'  && <RequestsTab reps={reps} products={products} />}
        {tab === 'live'      && <LiveTab reps={reps} products={products} />}
        {tab === 'eod'       && <EodTab reps={reps} products={products} />}
        {tab === 'reasons'   && <ReasonsTab />}
      </div>
    </div>
  )
}

// ── Warehouse Tab ─────────────────────────────────────────────────────────────
function WarehouseTab({ products }: { products: Product[] }) {
  const [wstock,    setWstock]    = useState<WStock[]>([])
  const [receipts,  setReceipts]  = useState<Receipt[]>([])
  const [view,      setView]      = useState<'stock' | 'receive'>('stock')
  const [rows,      setRows]      = useState([{ productId: '', qty: 0, supplier: '', notes: '' }])
  const [saving,    setSaving]    = useState(false)
  const [msg,       setMsg]       = useState('')

  useEffect(() => { loadWarehouse() }, [])

  const loadWarehouse = async () => {
    const { data: ws } = await supabase.from('warehouse_stock')
      .select('*, products(name)').order('products(name)')
    const { data: rc } = await supabase.from('warehouse_receipts')
      .select('*, products(name)').order('received_at', { ascending: false }).limit(30)
    if (ws) setWstock(ws)
    if (rc) setReceipts(rc)
  }

  const saveReceipt = async () => {
    const valid = rows.filter((r) => r.productId && r.qty > 0)
    if (!valid.length) return
    setSaving(true)

    for (const row of valid) {
      // Insert receipt
      await supabase.from('warehouse_receipts').insert({
        product_id: row.productId, quantity: row.qty,
        supplier: row.supplier || null, notes: row.notes || null,
      })
      // Upsert warehouse_stock
      const { data: existing } = await supabase.from('warehouse_stock')
        .select('*').eq('product_id', row.productId).maybeSingle()
      if (existing) {
        await supabase.from('warehouse_stock')
          .update({ quantity: existing.quantity + row.qty, updated_at: new Date().toISOString() })
          .eq('product_id', row.productId)
      } else {
        await supabase.from('warehouse_stock')
          .insert({ product_id: row.productId, quantity: row.qty })
      }
    }

    setSaving(false)
    setMsg('Stock received and warehouse updated!')
    setRows([{ productId: '', qty: 0, supplier: '', notes: '' }])
    setTimeout(() => setMsg(''), 3000)
    await loadWarehouse()
    setView('stock')
  }

  const updateRow = (i: number, field: string, val: string | number) =>
    setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setView('stock')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'stock' ? 'bg-blue-600 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            Current Stock
          </button>
          <button onClick={() => setView('receive')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${view === 'receive' ? 'bg-blue-600 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
            + Receive Stock
          </button>
        </div>
      </div>

      {view === 'stock' && (
        <>
          {/* Warehouse balance */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <p className="font-semibold text-slate-900 text-sm">Warehouse Balance</p>
              <p className="text-xs text-slate-500">
                Total: {wstock.reduce((a, w) => a + w.quantity, 0).toLocaleString()} units
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>{['Product','In Stock','Min Level','Status'].map((h) =>
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {wstock.map((w) => {
                  const isLow = w.quantity <= w.min_level && w.min_level > 0
                  return (
                    <tr key={w.product_id} className={`hover:bg-slate-50 ${isLow ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{w.products?.name}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">{w.quantity.toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-500">{w.min_level || '—'}</td>
                      <td className="px-4 py-3">
                        {isLow
                          ? <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">⚠ Low Stock</span>
                          : <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">OK</span>}
                      </td>
                    </tr>
                  )
                })}
                {!wstock.length && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No warehouse stock recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Receipt history */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <p className="font-semibold text-slate-900 text-sm">Recent Receipts</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>{['Product','Qty','Supplier','Notes','Received'].map((h) =>
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{r.products?.name}</td>
                    <td className="px-4 py-3 text-slate-700">{r.quantity}</td>
                    <td className="px-4 py-3 text-slate-600">{r.supplier || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{r.notes || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(r.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
                {!receipts.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No receipts yet</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === 'receive' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-xl">
          <h2 className="font-semibold text-slate-900 mb-4">Record Stock Receipt</h2>
          <p className="text-xs text-slate-500 mb-5 bg-blue-50 px-3 py-2 rounded-lg">
            ℹ Record products that have arrived at your warehouse. This increases the warehouse balance immediately.
          </p>
          <div className="space-y-3 mb-4">
            {rows.map((row, i) => (
              <div key={i} className="p-4 bg-slate-50 rounded-xl space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Product</label>
                    <select value={row.productId} onChange={(e) => updateRow(i, 'productId', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Select…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Quantity Received</label>
                    <input type="number" min={1} value={row.qty || ''}
                      onChange={(e) => updateRow(i, 'qty', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input value={row.supplier} onChange={(e) => updateRow(i, 'supplier', e.target.value)}
                    placeholder="Supplier (optional)"
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={row.notes} onChange={(e) => updateRow(i, 'notes', e.target.value)}
                    placeholder="Notes (optional)"
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                {rows.length > 1 && (
                  <button onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                    className="text-xs text-red-500 hover:text-red-700">Remove</button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setRows([...rows, { productId: '', qty: 0, supplier: '', notes: '' }])}
            className="text-sm text-blue-600 hover:text-blue-800 mb-5 font-medium">+ Add another product</button>
          {msg && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg mb-3">{msg}</p>}
          <div className="flex gap-3">
            <button onClick={() => setView('stock')}
              className="flex-1 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
            <button onClick={saveReceipt} disabled={saving}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Confirm Receipt'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Stock Requests Tab ────────────────────────────────────────────────────────
function RequestsTab({ reps, products }: { reps: Rep[]; products: Product[] }) {
  const [requests,  setRequests]  = useState<StockReq[]>([])
  const [wstock,    setWstock]    = useState<Record<string, number>>({})
  const [loading,   setLoading]   = useState(true)
  const [actionId,  setActionId]  = useState<string | null>(null)
  const [notes,     setNotes]     = useState<Record<string, string>>({})
  const [approved,  setApproved]  = useState<Record<string, number>>({})
  const [filter,    setFilter]    = useState<'pending' | 'all'>('pending')

  useEffect(() => { load() }, [filter])

  const load = async () => {
    setLoading(true)
    let q = supabase.from('stock_requests')
      .select('*, sales_representatives(name), products(name)')
      .order('created_at', { ascending: false })
    if (filter === 'pending') q = q.eq('status', 'pending')
    const { data } = await q.limit(50)
    setRequests(data || [])

    const { data: ws } = await supabase.from('warehouse_stock').select('product_id, quantity')
    const map: Record<string, number> = {}
    ;(ws || []).forEach((w: { product_id: string; quantity: number }) => { map[w.product_id] = w.quantity })
    setWstock(map)
    setLoading(false)
  }

  const handleApprove = async (req: StockReq, qtyApproved: number, managerNote: string) => {
    setActionId(req.id)
    const status = qtyApproved === req.quantity_requested ? 'approved' : 'modified'

    // Update request
    await supabase.from('stock_requests').update({
      status, quantity_approved: qtyApproved, manager_notes: managerNote || null,
    }).eq('id', req.id)

    // Deduct from warehouse stock
    const current = wstock[req.product_id] || 0
    await supabase.from('warehouse_stock')
      .update({ quantity: Math.max(0, current - qtyApproved), updated_at: new Date().toISOString() })
      .eq('product_id', req.product_id)

    // Add to rep's stock_loads for route_date
    const { data: existing } = await supabase.from('stock_loads')
      .select('*').eq('sales_rep_id', req.sales_rep_id)
      .eq('product_id', req.product_id).eq('load_date', req.route_date).maybeSingle()
    if (existing) {
      await supabase.from('stock_loads').update({
        current_balance: existing.current_balance + qtyApproved,
        quantity_added:  existing.quantity_added  + qtyApproved,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
    } else {
      await supabase.from('stock_loads').insert({
        sales_rep_id: req.sales_rep_id, product_id: req.product_id,
        load_date: req.route_date, quantity_added: qtyApproved, current_balance: qtyApproved,
      })
    }

    // Notify rep
    await supabase.from('notifications').insert({
      type:    'stock_approved',
      title:   '📦 Stock Request Approved',
      message: `Your request for ${qtyApproved} × ${req.products?.name} on ${req.route_date} has been ${status}.`,
      data:    { rep_id: req.sales_rep_id, product_id: req.product_id, qty: qtyApproved },
    })

    setActionId(null)
    await load()
  }

  const handleReject = async (req: StockReq) => {
    if (!confirm('Reject this stock request?')) return
    setActionId(req.id)
    await supabase.from('stock_requests').update({
      status: 'rejected', manager_notes: notes[req.id] || null,
    }).eq('id', req.id)

    await supabase.from('notifications').insert({
      type:    'stock_rejected',
      title:   '📦 Stock Request Rejected',
      message: `Your request for ${req.products?.name} on ${req.route_date} was rejected.${notes[req.id] ? ` Note: ${notes[req.id]}` : ''}`,
      data:    { rep_id: req.sales_rep_id },
    })
    setActionId(null)
    await load()
  }

  const statusBadge = (status: string) => {
    const cfg: Record<string, string> = {
      pending:  'bg-amber-100 text-amber-700',
      approved: 'bg-green-100 text-green-700',
      modified: 'bg-blue-100 text-blue-700',
      rejected: 'bg-red-100 text-red-700',
    }
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['pending', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${filter === f ? 'bg-blue-600 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {f === 'pending' ? 'Pending Approval' : 'All Requests'}
            </button>
          ))}
        </div>
        <button onClick={load} className="text-sm text-blue-600 hover:text-blue-800 font-medium">↻ Refresh</button>
      </div>

      {loading && <div className="text-center py-8 text-slate-400">Loading…</div>}

      {!loading && requests.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-slate-700 font-medium">No {filter === 'pending' ? 'pending' : ''} requests</p>
        </div>
      )}

      {requests.map((req) => {
        const warehouseQty = wstock[req.product_id] || 0
        const isInsufficient = warehouseQty < req.quantity_requested
        const approvedQty = approved[req.id] ?? req.quantity_requested

        return (
          <div key={req.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {statusBadge(req.status)}
                  <span className="text-xs text-slate-500">
                    Requested {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="font-semibold text-slate-900">{req.sales_representatives?.name}</p>
                <p className="text-sm text-slate-600 mt-0.5">
                  <span className="font-medium">{req.products?.name}</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Route date: <span className="font-medium text-slate-700">
                    {new Date(req.route_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                </p>
                {req.request_notes && (
                  <p className="text-xs text-slate-500 mt-1">Note: {req.request_notes}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-slate-900">{req.quantity_requested}</p>
                <p className="text-xs text-slate-500">units requested</p>
                <p className={`text-xs mt-1 font-medium ${isInsufficient ? 'text-red-600' : 'text-green-600'}`}>
                  {warehouseQty} in warehouse
                </p>
              </div>
            </div>

            {req.status === 'pending' && (
              <div className="border-t border-slate-100 pt-4 space-y-3">
                {isInsufficient && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                    ⚠ Warehouse only has {warehouseQty} units. You can approve a lower quantity.
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Approve quantity</label>
                    <input type="number" min={0} max={req.quantity_requested}
                      value={approvedQty}
                      onChange={(e) => setApproved({ ...approved, [req.id]: parseInt(e.target.value) || 0 })}
                      className="w-24 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-center" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">Note to rep (optional)</label>
                    <input value={notes[req.id] || ''} onChange={(e) => setNotes({ ...notes, [req.id]: e.target.value })}
                      placeholder="e.g. Reduced due to low stock"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleApprove(req, approvedQty, notes[req.id] || '')}
                    disabled={actionId === req.id || approvedQty <= 0}
                    className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                    {actionId === req.id ? '…' : `✓ Approve ${approvedQty} units`}
                  </button>
                  <button onClick={() => handleReject(req)} disabled={actionId === req.id}
                    className="px-6 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50">
                    ✗ Reject
                  </button>
                </div>
              </div>
            )}

            {req.status !== 'pending' && req.manager_notes && (
              <div className="border-t border-slate-100 pt-3 mt-3">
                <p className="text-xs text-slate-500">Manager note: {req.manager_notes}</p>
                {req.quantity_approved !== null && (
                  <p className="text-xs text-slate-600 mt-1 font-medium">Approved: {req.quantity_approved} units</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Live Status Tab ───────────────────────────────────────────────────────────
function LiveTab({ reps, products }: { reps: Rep[]; products: Product[] }) {
  const [liveData, setLiveData] = useState<{ rep: Rep; loads: { product_id: string; current_balance: number; quantity_added: number }[]; soldUnits: number }[]>([])
  const [loading, setLoading]   = useState(false)
  const today = new Date().toISOString().split('T')[0]

  const load = useCallback(async () => {
    setLoading(true)
    const { data: loads } = await supabase.from('stock_loads').select('*').eq('load_date', today)
    const { data: repSales } = await supabase.from('sales_records').select('sales_rep_id, quantity').eq('sale_date', today)
    const salesByRep: Record<string, number> = {}
    ;(repSales || []).forEach((r: { sales_rep_id: string; quantity: number }) => {
      salesByRep[r.sales_rep_id] = (salesByRep[r.sales_rep_id] || 0) + r.quantity
    })
    setLiveData(reps.map((rep) => ({
      rep,
      loads: (loads || []).filter((l: { sales_rep_id: string }) => l.sales_rep_id === rep.id),
      soldUnits: salesByRep[rep.id] || 0,
    })))
    setLoading(false)
  }, [reps, today])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Today — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <button onClick={load} className="text-sm text-blue-600 hover:text-blue-800 font-medium">↻ Refresh</button>
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
                <p className="text-xs text-slate-500">{loads.length ? `${loads.length} products loaded` : 'No stock loaded today'}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">{soldUnits} sold</p>
                <p className="text-xs text-slate-500">{totalBalance} remaining</p>
              </div>
            </div>
            {totalLoaded > 0 && (
              <>
                <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
                  <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="space-y-1">
                  {loads.map((sl) => {
                    const prod = products.find((p) => p.id === sl.product_id)
                    const loaded = sl.current_balance + (sl.quantity_added || 0)
                    return (
                      <div key={sl.product_id} className="flex items-center text-xs text-slate-600 gap-2">
                        <span className="flex-1 truncate">{prod?.name || 'Unknown'}</span>
                        <span className="text-slate-400">Loaded: {loaded} · Left: {sl.current_balance}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── End of Day Tab ────────────────────────────────────────────────────────────
function EodTab({ reps, products }: { reps: Rep[]; products: Product[] }) {
  const [selRep,  setSelRep]  = useState('')
  const [loads,   setLoads]   = useState<{ id: string; product_id: string; current_balance: number; quantity_added: number }[]>([])
  const [returns, setReturns] = useState<Record<string, number>>({})
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')
  const today = new Date().toISOString().split('T')[0]

  const loadRepStock = async (repId: string) => {
    const { data } = await supabase.from('stock_loads').select('*').eq('sales_rep_id', repId).eq('load_date', today)
    setLoads(data || [])
    const init: Record<string, number> = {}
    ;(data || []).forEach((l: { id: string }) => { init[l.id] = 0 })
    setReturns(init)
  }

  useEffect(() => { if (selRep) loadRepStock(selRep) }, [selRep])

  const save = async () => {
    setSaving(true)
    for (const load of loads) {
      const ret = returns[load.id] || 0
      await supabase.from('stock_loads').update({
        quantity_returned: ret, is_finalized: true,
      }).eq('id', load.id)
      // Returns are pending confirmation — warehouse_stock updated separately in confirmation flow
    }
    setSaving(false)
    setMsg('End of day recorded. Returns are pending warehouse confirmation.')
    setTimeout(() => setMsg(''), 4000)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg space-y-4">
      <h2 className="font-semibold text-slate-900">End of Day — Record Returns</h2>
      <p className="text-xs text-slate-500 bg-blue-50 px-3 py-2 rounded-lg">
        ℹ Returns recorded here are <b>pending</b>. The warehouse balance only updates after you confirm the physical return on the Warehouse tab.
      </p>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Sales Rep</label>
        <select value={selRep} onChange={(e) => setSelRep(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Select rep…</option>
          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      {loads.length > 0 && (
        <>
          <div className="space-y-3">
            {loads.map((l) => {
              const prod = products.find((p) => p.id === l.product_id)
              return (
                <div key={l.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-slate-700 truncate">{prod?.name}</span>
                  <span className="text-xs text-slate-400 shrink-0">Balance: {l.current_balance}</span>
                  <input type="number" min={0} max={l.current_balance}
                    value={returns[l.id] || 0}
                    onChange={(e) => setReturns({ ...returns, [l.id]: parseInt(e.target.value) || 0 })}
                    className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )
            })}
          </div>
          {msg && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">{msg}</p>}
          <button onClick={save} disabled={saving}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Record Returns (Pending Confirmation)'}
          </button>
        </>
      )}
      {selRep && !loads.length && (
        <p className="text-slate-400 text-sm text-center py-4">No stock loaded for this rep today</p>
      )}
    </div>
  )
}

// ── No-Sale Reasons Tab ───────────────────────────────────────────────────────
function ReasonsTab() {
  const [reasons,   setReasons]  = useState<NonSaleReason[]>([])
  const [newReason, setNewReason] = useState('')
  const [adding,    setAdding]   = useState(false)

  useEffect(() => { supabase.from('non_sale_reasons').select('*').order('reason').then(({ data }) => { if (data) setReasons(data) }) }, [])

  const add = async () => {
    if (!newReason.trim()) return
    setAdding(true)
    const { data } = await supabase.from('non_sale_reasons').insert({ reason: newReason.trim() }).select().single()
    if (data) setReasons([...reasons, data])
    setNewReason(''); setAdding(false)
  }
  const toggle = async (id: string, active: boolean) => {
    await supabase.from('non_sale_reasons').update({ is_active: !active }).eq('id', id)
    setReasons(reasons.map((r) => r.id === id ? { ...r, is_active: !active } : r))
  }
  const del = async (id: string) => {
    await supabase.from('non_sale_reasons').delete().eq('id', id)
    setReasons(reasons.filter((r) => r.id !== id))
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
      <h2 className="font-semibold text-slate-900 mb-4">No-Sale Reasons</h2>
      <div className="flex gap-2 mb-5">
        <input value={newReason} onChange={(e) => setNewReason(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New reason…"
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={add} disabled={adding || !newReason.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">Add</button>
      </div>
      <div className="divide-y divide-slate-100">
        {reasons.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${r.is_active ? 'bg-green-500' : 'bg-slate-300'}`} />
              <span className="text-sm text-slate-900">{r.reason}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggle(r.id, r.is_active)}
                className="text-xs text-slate-500 hover:text-slate-700">{r.is_active ? 'Deactivate' : 'Activate'}</button>
              <button onClick={() => del(r.id)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
