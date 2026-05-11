import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { SalesRep } from '../types'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, setSettings, salesReps, setSalesReps,
          territories, proximitySettings, setProximitySettings } = useStore()

  const [tab, setTab] = useState<'warehouse' | 'reps' | 'territories'>('warehouse')

  // Warehouse
  const [whName,   setWhName]   = useState(settings?.warehouse_name || '')
  const [whLat,    setWhLat]    = useState(String(settings?.warehouse_lat || ''))
  const [whLon,    setWhLon]    = useState(String(settings?.warehouse_lon || ''))
  const [whSaving, setWhSaving] = useState(false)
  const [whError,  setWhError]  = useState('')

  // Reps
  const [repName,     setRepName]     = useState('')
  const [repPhone,    setRepPhone]    = useState('')
  const [repTerrId,   setRepTerrId]   = useState('')
  const [repErr,      setRepErr]      = useState('')
  const [repSaving,   setRepSaving]   = useState(false)
  const [editingRep,  setEditingRep]  = useState<SalesRep | null>(null)

  const saveWarehouse = async () => {
    const lat = parseFloat(whLat)
    const lon = parseFloat(whLon)
    if (!whName.trim()) return setWhError('Name is required')
    if (isNaN(lat) || isNaN(lon)) return setWhError('Invalid coordinates')
    setWhSaving(true); setWhError('')
    const { data, error } = await supabase
      .from('settings')
      .update({ warehouse_name: whName.trim(), warehouse_lat: lat, warehouse_lon: lon })
      .eq('id', settings?.id).select().single()
    setWhSaving(false)
    if (error) { setWhError(error.message); return }
    setSettings(data); onClose()
  }

  const addRep = async () => {
    if (!repName.trim()) return setRepErr('Name is required')
    setRepSaving(true); setRepErr('')
    const payload = {
      name: repName.trim(),
      phone_number: repPhone.trim() || null,
      territory_id: repTerrId || null,
    }
    const { data, error } = await supabase
      .from('sales_representatives').insert(payload).select().single()
    setRepSaving(false)
    if (error) { setRepErr(error.message); return }
    setSalesReps([...salesReps, data])
    setRepName(''); setRepPhone(''); setRepTerrId('')
  }

  const updateRep = async () => {
    if (!editingRep || !repName.trim()) return
    setRepSaving(true); setRepErr('')
    const payload = {
      name: repName.trim(),
      phone_number: repPhone.trim() || null,
      territory_id: repTerrId || null,
    }
    const { data, error } = await supabase
      .from('sales_representatives').update(payload).eq('id', editingRep.id).select().single()
    setRepSaving(false)
    if (error) { setRepErr(error.message); return }
    setSalesReps(salesReps.map((r) => r.id === data.id ? data : r))
    setEditingRep(null); setRepName(''); setRepPhone(''); setRepTerrId('')
  }

  const startEdit = (rep: SalesRep) => {
    setEditingRep(rep)
    setRepName(rep.name)
    setRepPhone(rep.phone_number || '')
    setRepTerrId(rep.territory_id || '')
  }

  const cancelEdit = () => {
    setEditingRep(null); setRepName(''); setRepPhone(''); setRepTerrId('')
  }

  const deleteRep = async (id: string) => {
    if (!confirm('Remove this sales representative?')) return
    await supabase.from('sales_representatives').delete().eq('id', id)
    setSalesReps(salesReps.filter((r) => r.id !== id))
  }

  const updateRadius = async (territoryId: string, radius: number) => {
    const existing = proximitySettings.find((p) => p.territory_id === territoryId)
    if (existing) {
      const { data } = await supabase.from('proximity_settings')
        .update({ radius_meters: radius }).eq('id', existing.id).select().single()
      if (data) setProximitySettings(proximitySettings.map((p) => p.id === data.id ? data : p))
    } else {
      const { data } = await supabase.from('proximity_settings')
        .insert({ territory_id: territoryId, radius_meters: radius }).select().single()
      if (data) setProximitySettings([...proximitySettings, data])
    }
  }

  const tabs = [
    { key: 'warehouse',   label: 'Warehouse'   },
    { key: 'reps',        label: 'Sales Reps'  },
    { key: 'territories', label: 'Territories' },
  ]

  const getTerritoryName = (id: string | null) =>
    territories.find((t) => t.id === id)?.name || '—'

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900">Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        <div className="flex border-b border-slate-200">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">

          {/* ── Warehouse ── */}
          {tab === 'warehouse' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Warehouse Name</label>
                <input value={whName} onChange={(e) => setWhName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Latitude</label>
                  <input value={whLat} onChange={(e) => setWhLat(e.target.value)}
                    placeholder="9.0300"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Longitude</label>
                  <input value={whLon} onChange={(e) => setWhLon(e.target.value)}
                    placeholder="38.7400"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {whError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{whError}</p>}
              <button onClick={saveWarehouse} disabled={whSaving}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {whSaving ? 'Saving…' : 'Save Warehouse'}
              </button>
            </div>
          )}

          {/* ── Sales Reps ── */}
          {tab === 'reps' && (
            <div className="space-y-4">
              {/* Add / Edit form */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  {editingRep ? `Editing: ${editingRep.name}` : 'Add Sales Rep'}
                </p>
                <input value={repName} onChange={(e) => setRepName(e.target.value)}
                  placeholder="Full name *"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <input value={repPhone} onChange={(e) => setRepPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Default Territory (optional)</label>
                  <select value={repTerrId} onChange={(e) => setRepTerrId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                    <option value="">No default territory</option>
                    {territories.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                {repErr && <p className="text-sm text-red-600">{repErr}</p>}
                <div className="flex gap-2">
                  {editingRep && (
                    <button onClick={cancelEdit}
                      className="flex-1 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-100">
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={editingRep ? updateRep : addRep}
                    disabled={repSaving}
                    className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {repSaving ? '…' : editingRep ? 'Update Rep' : '+ Add Rep'}
                  </button>
                </div>
              </div>

              {/* Rep list */}
              <div className="divide-y divide-slate-100">
                {salesReps.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{r.name}</p>
                      <p className="text-xs text-slate-500">
                        {r.phone_number && <span className="mr-2">📞 {r.phone_number}</span>}
                        {r.territory_id && <span>📍 {getTerritoryName(r.territory_id)}</span>}
                        {!r.phone_number && !r.territory_id && 'No details'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(r)}
                        className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50">
                        Edit
                      </button>
                      <button onClick={() => deleteRep(r.id)}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50">
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {!salesReps.length && (
                  <p className="text-sm text-slate-400 py-4 text-center">No sales reps added yet</p>
                )}
              </div>
            </div>
          )}

          {/* ── Territories (proximity) ── */}
          {tab === 'territories' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-3">
                Set the GPS proximity radius for each territory. Sales reps must be within
                this distance to check in at an outlet.
              </p>
              {territories.map((t) => {
                const ps = proximitySettings.find((p) => p.territory_id === t.id)
                return (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                      <span className="text-sm font-medium text-slate-900">{t.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={10} max={1000}
                        defaultValue={ps?.radius_meters ?? 100}
                        onBlur={(e) => updateRadius(t.id, parseInt(e.target.value) || 100)}
                        className="w-20 px-2 py-1 border border-slate-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-500">m</span>
                    </div>
                  </div>
                )
              })}
              {!territories.length && (
                <p className="text-sm text-slate-400 py-4 text-center">No territories yet</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
