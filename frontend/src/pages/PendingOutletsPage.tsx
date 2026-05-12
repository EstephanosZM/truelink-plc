import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface PendingOutlet {
  id: string
  outlet_name: string
  owner_name: string | null
  phone_number: string | null
  land_mark: string | null
  latitude: number
  longitude: number
  territory_id: string
  created_at: string
  territories?: { name: string }
}

export default function PendingOutletsPage() {
  const [outlets,  setOutlets]  = useState<PendingOutlet[]>([])
  const [loading,  setLoading]  = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('outlets')
      .select('*, territories(name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    setOutlets(data || [])
    setLoading(false)
  }

  const approve = async (id: string) => {
    setActionId(id)
    await supabase.from('outlets').update({ status: 'active' }).eq('id', id)
    // Mark related notification as read
    await supabase.from('notifications')
      .update({ is_read: true })
      .eq('type', 'new_outlet')
      .contains('data', { outlet_id: id })
    setOutlets(outlets.filter((o) => o.id !== id))
    setActionId(null)
  }

  const reject = async (id: string) => {
    if (!confirm('Reject and delete this outlet submission?')) return
    setActionId(id)
    await supabase.from('outlets').delete().eq('id', id)
    await supabase.from('notifications')
      .update({ is_read: true })
      .eq('type', 'new_outlet')
      .contains('data', { outlet_id: id })
    setOutlets(outlets.filter((o) => o.id !== id))
    setActionId(null)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Pending Outlets</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              New outlets submitted by sales reps for approval
            </p>
          </div>
          <button onClick={load} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            ↻ Refresh
          </button>
        </div>

        {loading && (
          <div className="text-center py-12 text-slate-400">Loading…</div>
        )}

        {!loading && outlets.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-slate-700 font-medium">No pending outlets</p>
            <p className="text-slate-400 text-sm mt-1">All outlet submissions have been reviewed</p>
          </div>
        )}

        <div className="space-y-4">
          {outlets.map((o) => (
            <div key={o.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                      Pending Review
                    </span>
                    {o.territories && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                        {o.territories.name}
                      </span>
                    )}
                  </div>

                  <h3 className="font-semibold text-slate-900 text-lg">{o.outlet_name}</h3>

                  <div className="mt-2 space-y-1">
                    {o.owner_name    && <p className="text-sm text-slate-600">👤 {o.owner_name}</p>}
                    {o.phone_number  && <p className="text-sm text-slate-600">📞 {o.phone_number}</p>}
                    {o.land_mark     && <p className="text-sm text-slate-600">📍 {o.land_mark}</p>}
                    <p className="text-sm text-slate-500">
                      🌍 {o.latitude.toFixed(5)}, {o.longitude.toFixed(5)}
                    </p>
                    <p className="text-xs text-slate-400 mt-2">
                      Submitted {new Date(o.created_at).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>
                </div>

                {/* Map preview */}
                <a
                  href={`https://maps.google.com/?q=${o.latitude},${o.longitude}`}
                  target="_blank" rel="noreferrer"
                  className="shrink-0 w-20 h-20 bg-slate-100 rounded-lg flex items-center justify-center hover:bg-slate-200 transition-colors"
                  title="View on Google Maps"
                >
                  <span className="text-2xl">🗺</span>
                </a>
              </div>

              <div className="flex gap-3 mt-4 pt-4 border-t border-slate-100">
                <button
                  onClick={() => approve(o.id)}
                  disabled={actionId === o.id}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {actionId === o.id ? '…' : '✓ Approve — Add to Territory'}
                </button>
                <button
                  onClick={() => reject(o.id)}
                  disabled={actionId === o.id}
                  className="px-6 py-2 border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  ✗ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
