import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { getTerritoryColor } from '../lib/utils'

export default function TerritoriesModal({ onClose }: { onClose: () => void }) {
  const { territories, setTerritories, activeTerritoryId,
          setActiveTerritoryId, setOutlets } = useStore()

  const [newName,  setNewName]  = useState('')
  const [adding,   setAdding]   = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error,    setError]    = useState('')

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return setError('Territory name is required')
    setAdding(true); setError('')
    const color = getTerritoryColor(name)
    const { data, error } = await supabase
      .from('territories').insert({ name, color }).select().single()
    setAdding(false)
    if (error) { setError(error.message); return }
    setTerritories([...territories, data])
    setNewName('')
  }

  const handleDelete = async (id: string, name: string) => {
    // Check for saved route plans first
    const { count } = await supabase
      .from('route_plans')
      .select('id', { count: 'exact', head: true })
      .eq('territory_id', id)
      .eq('status', 'saved')

    if ((count || 0) > 0) {
      const ok = confirm(
        `"${name}" has saved route plans.\n\nDeleting this territory will permanently remove all its outlets, routes, and sales data.\n\nAre you sure?`
      )
      if (!ok) return
    } else {
      const ok = confirm(`Delete territory "${name}"? This will remove all its outlets and routes.`)
      if (!ok) return
    }

    setDeleting(id)
    const { error } = await supabase.from('territories').delete().eq('id', id)
    setDeleting(null)

    if (error) { setError(error.message); return }

    const updated = territories.filter((t) => t.id !== id)
    setTerritories(updated)

    // If active territory was deleted, clear it
    if (activeTerritoryId === id) {
      setActiveTerritoryId(null)
      setOutlets([])
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900">Manage Territories</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        <div className="p-6">
          {/* Add new */}
          <div className="flex gap-2 mb-5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="New territory name…"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAdd} disabled={adding}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>
          )}

          {/* Territory list */}
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {territories.length === 0 && (
              <p className="text-sm text-slate-400 py-4 text-center">No territories yet</p>
            )}
            {territories.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: t.color }}
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t.name}</p>
                    {activeTerritoryId === t.id && (
                      <p className="text-xs text-blue-600">Currently active</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(t.id, t.name)}
                  disabled={deleting === t.id}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  {deleting === t.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
