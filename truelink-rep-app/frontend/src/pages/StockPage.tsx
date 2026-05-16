import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import { today } from '../lib/utils'

function getDateOptions() {
  const options = []
  const now = new Date()
  for (let i = 0; i <= 3; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)
    const value = d.toISOString().split('T')[0]
    const label = i === 0 ? `Today — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : i === 1 ? `Tomorrow — ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    options.push({ value, label })
  }
  return options
}

export default function StockPage() {
  const { stockLoads, products, activeRep, darkMode } = useRepStore()
  const [view,       setView]       = useState<'stock' | 'request' | 'history'>('stock')
  const [reqRows,    setReqRows]    = useState([{ productId: '', qty: '' }])
  const [routeDate,  setRouteDate]  = useState(getDateOptions()[0].value)
  const [reqNotes,   setReqNotes]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reqMsg,     setReqMsg]     = useState('')
  const [history,    setHistory]    = useState<{
    id: string
    products: { name: string }
    quantity_requested: number
    quantity_approved: number | null
    status: string
    route_date: string
    manager_notes: string | null
    created_at: string
  }[]>([])

  const dateOptions = getDateOptions()

  const totalBalance   = stockLoads.reduce((a, s) => a + s.current_balance, 0)
  const totalLoaded    = stockLoads.reduce((a, s) => a + s.current_balance + (s.quantity_added || 0), 0)
  const totalSoldUnits = totalLoaded - totalBalance

  useEffect(() => { if (view === 'history') loadHistory() }, [view])

  const loadHistory = async () => {
    if (!activeRep) return
    const { data } = await supabase
      .from('stock_requests')
      .select('*, products(name)')
      .eq('sales_rep_id', activeRep.id)
      .order('created_at', { ascending: false })
      .limit(30)
    setHistory(data || [])
  }

  const updateRow = (i: number, field: 'productId' | 'qty', val: string) =>
    setReqRows(reqRows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))

  const submitRequest = async () => {
    if (!activeRep) return
    const valid = reqRows.filter((r) => r.productId && parseInt(r.qty) > 0)
    if (!valid.length) return setReqMsg('Add at least one product with a quantity.')
    setSubmitting(true)

    for (const row of valid) {
      await supabase.from('stock_requests').insert({
        sales_rep_id:      activeRep.id,
        product_id:        row.productId,
        quantity_requested: parseInt(row.qty),
        route_date:        routeDate,
        request_notes:     reqNotes.trim() || null,
      })
    }

    await supabase.from('notifications').insert({
      type:    'stock_request',
      title:   '📦 Stock Request',
      message: `${activeRep.name} requested stock for ${new Date(routeDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
      data:    { rep_id: activeRep.id, route_date: routeDate },
    })

    setSubmitting(false)
    setReqMsg('Request submitted! Your manager will review it shortly.')
    setReqRows([{ productId: '', qty: '' }])
    setReqNotes('')
    setTimeout(() => setReqMsg(''), 4000)
    setView('history')
  }

  const bg   = darkMode ? 'bg-slate-900'   : 'bg-slate-50'
  const card = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
  const text = darkMode ? 'text-white'     : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'
  const inp  = darkMode
    ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'

  const statusBadge = (status: string) => {
    const cfg: Record<string, string> = {
      pending:  'bg-amber-900/50 text-amber-400',
      approved: 'bg-green-900/50 text-green-400',
      modified: 'bg-blue-900/50 text-blue-400',
      rejected: 'bg-red-900/50 text-red-400',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg[status] || 'bg-slate-700 text-slate-400'}`}>
        {status}
      </span>
    )
  }

  return (
    <div className={`flex-1 overflow-y-auto pb-24 ${bg}`}>
      {/* Tab bar */}
      <div className={`flex border-b ${darkMode ? 'border-slate-800' : 'border-slate-200'} px-4 pt-4 gap-1`}>
        {[
          { key: 'stock',   label: 'My Stock'  },
          { key: 'request', label: 'Request'   },
          { key: 'history', label: 'History'   },
        ].map((t) => (
          <button key={t.key} onClick={() => setView(t.key as typeof view)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
              view === t.key ? 'bg-blue-600 text-white' : `${sub} hover:text-slate-300`
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-5 space-y-4">

        {/* ── My Stock ── */}
        {view === 'stock' && (
          <>
            <div className={`${card} border rounded-2xl p-5`}>
              <p className={`text-xs font-semibold ${sub} uppercase tracking-wide mb-4`}>Today's Stock</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Loaded',    value: totalLoaded,    color: text             },
                  { label: 'Sold',      value: totalSoldUnits, color: 'text-green-400' },
                  { label: 'Remaining', value: totalBalance,   color: 'text-amber-400' },
                ].map((s) => (
                  <div key={s.label} className={`${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'} rounded-xl p-3 text-center`}>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className={`${sub} text-xs mt-1`}>{s.label}</p>
                  </div>
                ))}
              </div>
              {stockLoads.length === 0 && (
                <p className={`${sub} text-sm text-center pt-4`}>No stock loaded for today</p>
              )}
            </div>

            {stockLoads.map((sl) => {
              const prod   = products.find((p) => p.id === sl.product_id)
              if (!prod) return null
              const loaded = sl.current_balance + (sl.quantity_added || 0)
              const sold   = loaded - sl.current_balance
              const pct    = loaded > 0 ? Math.round(sold / loaded * 100) : 0
              return (
                <div key={sl.id} className={`${card} border rounded-2xl p-4`}>
                  <div className="flex items-center gap-3 mb-3">
                    {(prod as typeof prod & { image_url?: string }).image_url ? (
                      <img src={(prod as typeof prod & { image_url?: string }).image_url!}
                        alt={prod.name} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                    ) : (
                      <div className={`w-12 h-12 rounded-xl ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} flex items-center justify-center shrink-0`}>
                        <span className="text-xl">📦</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`${text} font-medium text-sm truncate`}>{prod.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-amber-400 font-bold text-lg">{sl.current_balance}</p>
                      <p className={`${sub} text-xs`}>remaining</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} rounded-full h-1.5`}>
                      <div
                        className={`h-1.5 rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-blue-500' : 'bg-amber-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className={`${sub} text-xs shrink-0`}>{sold}/{loaded} sold</p>
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* ── Request Stock ── */}
        {view === 'request' && (
          <div className={`${card} border rounded-2xl p-5 space-y-5`}>
            <div>
              <p className={`${text} font-semibold mb-0.5`}>Request Stock</p>
              <p className={`${sub} text-xs`}>Your manager will review and approve your request.</p>
            </div>

            {/* Date selection */}
            <div>
              <label className={`block text-sm font-medium ${text} mb-2`}>For which date?</label>
              <div className="space-y-2">
                {dateOptions.map((d) => (
                  <label key={d.value}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      routeDate === d.value
                        ? 'border-blue-500 bg-blue-900/20'
                        : `${darkMode ? 'border-slate-700' : 'border-slate-200'}`
                    }`}>
                    <input type="radio" value={d.value} checked={routeDate === d.value}
                      onChange={() => setRouteDate(d.value)} className="accent-blue-600 shrink-0" />
                    <span className={`${text} text-sm font-medium`}>{d.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Product rows — number input */}
            <div>
              <label className={`block text-sm font-medium ${text} mb-2`}>Products</label>
              <div className="space-y-3">
                {reqRows.map((row, i) => (
                  <div key={i} className={`${darkMode ? 'bg-slate-700/50' : 'bg-slate-50'} rounded-xl p-3 space-y-2`}>
                    <select
                      value={row.productId}
                      onChange={(e) => updateRow(i, 'productId', e.target.value)}
                      className={`w-full px-3 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`}>
                      <option value="">Select product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>

                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <input
                          type="number"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          min={1}
                          value={row.qty}
                          onChange={(e) => updateRow(i, 'qty', e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="Enter quantity (e.g. 48)"
                          className={`w-full px-4 py-3 border rounded-xl text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`}
                        />
                      </div>
                      {reqRows.length > 1 && (
                        <button
                          onClick={() => setReqRows(reqRows.filter((_, idx) => idx !== i))}
                          className="w-10 h-10 flex items-center justify-center text-red-400 hover:text-red-600 shrink-0 text-xl">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setReqRows([...reqRows, { productId: '', qty: '' }])}
                className="text-blue-400 text-sm font-medium mt-3 block">
                + Add another product
              </button>
            </div>

            {/* Notes */}
            <div>
              <label className={`block text-sm font-medium ${text} mb-1`}>Note to manager (optional)</label>
              <textarea
                value={reqNotes}
                onChange={(e) => setReqNotes(e.target.value)}
                placeholder="e.g. Need extra stock for promotion on Friday"
                rows={2}
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${inp}`}
              />
            </div>

            {reqMsg && (
              <p className="text-green-400 text-sm bg-green-900/20 px-3 py-2 rounded-lg">{reqMsg}</p>
            )}

            <button
              onClick={submitRequest}
              disabled={submitting}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 active:scale-95 disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        )}

        {/* ── History ── */}
        {view === 'history' && (
          <div className="space-y-3">
            {history.length === 0 && (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">📋</p>
                <p className={`${sub} text-sm`}>No requests yet</p>
              </div>
            )}
            {history.map((req) => (
              <div key={req.id} className={`${card} border rounded-2xl p-4`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className={`${text} font-semibold text-sm`}>{req.products?.name}</p>
                    <p className={`${sub} text-xs mt-0.5`}>
                      For {new Date(req.route_date + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric',
                      })}
                    </p>
                    <p className={`${sub} text-xs`}>
                      Submitted {new Date(req.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  {statusBadge(req.status)}
                </div>
                <div className="flex items-center gap-6 mt-3">
                  <div>
                    <p className={`${sub} text-xs`}>Requested</p>
                    <p className={`${text} font-bold text-lg`}>{req.quantity_requested} units</p>
                  </div>
                  {req.quantity_approved !== null && (
                    <div>
                      <p className={`${sub} text-xs`}>Approved</p>
                      <p className={`text-green-400 font-bold text-lg`}>{req.quantity_approved} units</p>
                    </div>
                  )}
                </div>
                {req.manager_notes && (
                  <p className={`${sub} text-xs mt-2 italic`}>Manager: "{req.manager_notes}"</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
