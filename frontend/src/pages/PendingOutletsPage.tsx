import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface PendingOutlet {
  id:           string
  outlet_name:  string
  tin_number:   string | null
  phone_number: string | null
  land_mark:    string | null
  latitude:     number
  longitude:    number
  created_at:   string
  territory_id: string | null
}

export default function PendingOutletsPage() {
  const [outlets,  setOutlets]  = useState<PendingOutlet[]>([])
  const [loading,  setLoading]  = useState(true)
  const [editTIN,  setEditTIN]  = useState<Record<string, string>>({})
  const [actioning,setActioning]= useState<string | null>(null)
  const [msg,      setMsg]      = useState('')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('outlets')
      .select('id, outlet_name, tin_number, phone_number, land_mark, latitude, longitude, created_at, territory_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setOutlets(data || [])
    // Pre-fill TIN edit fields
    const tins: Record<string, string> = {}
    ;(data || []).forEach((o: PendingOutlet) => { tins[o.id] = o.tin_number || '' })
    setEditTIN(tins)
    setLoading(false)
  }

  const approve = async (outlet: PendingOutlet) => {
    setActioning(outlet.id)
    await supabase.from('outlets').update({
      status:     'active',
      tin_number: editTIN[outlet.id]?.trim() || outlet.tin_number || null,
    }).eq('id', outlet.id)
    await supabase.from('notifications').delete().eq('data->>outlet_id', outlet.id)
    setOutlets(outlets.filter((o) => o.id !== outlet.id))
    setMsg(`✅ ${outlet.outlet_name} approved and added to territory.`)
    setTimeout(() => setMsg(''), 4000)
    setActioning(null)
  }

  const reject = async (outlet: PendingOutlet) => {
    if (!confirm(`Reject and delete "${outlet.outlet_name}"?`)) return
    setActioning(outlet.id)
    await supabase.from('outlets').delete().eq('id', outlet.id)
    setOutlets(outlets.filter((o) => o.id !== outlet.id))
    setActioning(null)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Pending Outlets</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {outlets.length} outlet{outlets.length !== 1 ? 's' : ''} awaiting approval
            </p>
          </div>
          <button onClick={load} className="text-sm text-blue-600 hover:text-blue-800 font-medium">↻ Refresh</button>
        </div>

        {msg && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">
            {msg}
          </div>
        )}

        {outlets.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-slate-700 font-medium">No pending outlets</p>
            <p className="text-slate-400 text-sm mt-1">All submissions have been reviewed</p>
          </div>
        )}

        <div className="space-y-4">
          {outlets.map((outlet) => (
            <div key={outlet.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-slate-900 text-lg">{outlet.outlet_name}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Submitted {new Date(outlet.created_at).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <a href={`https://maps.google.com/?q=${outlet.latitude},${outlet.longitude}`}
                    target="_blank" rel="noreferrer"
                    className="shrink-0 px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                    🗺 View on Map
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-4">
                  {/* TIN — editable inline */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">TIN Number</label>
                    <input
                      value={editTIN[outlet.id] || ''}
                      onChange={(e) => setEditTIN({ ...editTIN, [outlet.id]: e.target.value })}
                      placeholder="Enter TIN if available…"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
                    <p className="text-sm text-slate-700">{outlet.phone_number || <span className="text-slate-400">—</span>}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Landmark</label>
                    <p className="text-sm text-slate-700">{outlet.land_mark || <span className="text-slate-400">—</span>}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">GPS</label>
                    <p className="text-sm text-slate-700 font-mono">
                      {outlet.latitude.toFixed(5)}, {outlet.longitude.toFixed(5)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex border-t border-slate-100">
                <button onClick={() => reject(outlet)} disabled={actioning === outlet.id}
                  className="flex-1 py-3 text-red-600 font-medium text-sm hover:bg-red-50 disabled:opacity-50 transition-colors border-r border-slate-100">
                  ✗ Reject
                </button>
                <button onClick={() => approve(outlet)} disabled={actioning === outlet.id}
                  className="flex-1 py-3 text-green-700 font-medium text-sm hover:bg-green-50 disabled:opacity-50 transition-colors">
                  {actioning === outlet.id ? '…' : '✓ Approve — Add to Territory'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
