import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import { getCurrentPosition } from '../lib/utils'

interface Props { onClose: () => void }

export default function RegisterOutletSheet({ onClose }: Props) {
  const { activeRep, todayStops, darkMode } = useRepStore()

  const [outletName,  setOutletName]  = useState('')
  const [ownerName,   setOwnerName]   = useState('')
  const [phone,       setPhone]       = useState('')
  const [landmark,    setLandmark]    = useState('')
  const [lat,         setLat]         = useState('')
  const [lon,         setLon]         = useState('')
  const [gpsLoading,  setGpsLoading]  = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState(false)

  // Get territory from rep's assigned route
  const territoryId = todayStops[0]
    ? (todayStops[0] as { route_plan_id?: string } & typeof todayStops[0]).route_plan_id
      ? undefined // will be fetched
      : undefined
    : undefined

  const [repTerritoryId, setRepTerritoryId] = useState<string | null>(null)

  useEffect(() => {
    // Get territory from the rep's route plan
    if (todayStops.length > 0) {
      const { routePlanId } = useRepStore.getState()
      if (routePlanId) {
        supabase.from('route_plans').select('territory_id').eq('id', routePlanId).single()
          .then(({ data }) => { if (data) setRepTerritoryId(data.territory_id) })
      }
    }
    // Auto-fill GPS
    autoFillGps()
  }, [])

  const autoFillGps = async () => {
    setGpsLoading(true)
    try {
      const pos = await getCurrentPosition()
      setLat(pos.coords.latitude.toFixed(6))
      setLon(pos.coords.longitude.toFixed(6))
    } catch { /* user can enter manually */ }
    setGpsLoading(false)
  }

  const handleSubmit = async () => {
    if (!outletName.trim()) return setError('Outlet name is required')
    const latN = parseFloat(lat)
    const lonN = parseFloat(lon)
    if (isNaN(latN) || isNaN(lonN)) return setError('Valid GPS coordinates are required')
    if (!repTerritoryId && !activeRep?.territory_id)
      return setError('Could not determine territory. Try again.')

    setSaving(true); setError('')
    const terrId = repTerritoryId || activeRep?.territory_id

    const { data: outlet, error: outletError } = await supabase.from('outlets').insert({
      outlet_name:  outletName.trim(),
      owner_name:   ownerName.trim()  || null,
      phone_number: phone.trim()      || null,
      land_mark:    landmark.trim()   || null,
      latitude:     latN,
      longitude:    lonN,
      territory_id: terrId,
      status:       'pending',
    }).select().single()

    if (outletError) { setError(outletError.message); setSaving(false); return }

    // Create notification for manager
    await supabase.from('notifications').insert({
      type:    'new_outlet',
      title:   '📍 New Outlet Submitted',
      message: `${activeRep?.name} registered "${outletName.trim()}" — pending approval`,
      data:    { outlet_id: outlet.id, rep_id: activeRep?.id, outlet_name: outletName.trim() },
    })

    setSaving(false)
    setSuccess(true)
  }

  const card  = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
  const input = darkMode
    ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400 focus:ring-blue-500'
    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-blue-500'
  const label = darkMode ? 'text-slate-300' : 'text-slate-700'
  const sub   = darkMode ? 'text-slate-400' : 'text-slate-500'

  if (success) {
    return (
      <div className="absolute inset-0 z-20 flex flex-col justify-end">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className={`relative ${darkMode ? 'bg-slate-900' : 'bg-white'} rounded-t-2xl p-8 text-center`}>
          <div className="text-6xl mb-4">✅</div>
          <p className={`${darkMode ? 'text-white' : 'text-slate-900'} font-bold text-xl mb-2`}>
            Outlet Submitted!
          </p>
          <p className={`${sub} text-sm mb-6`}>
            Your manager has been notified and will review this outlet for approval.
          </p>
          <button onClick={onClose}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 active:scale-95">
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative ${darkMode ? 'bg-slate-900' : 'bg-white'} rounded-t-2xl max-h-[90vh] flex flex-col`}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-600 rounded-full" />
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className={`${darkMode ? 'text-white' : 'text-slate-900'} font-bold text-lg`}>
                Register New Outlet
              </h2>
              <p className={`${sub} text-xs`}>This will be sent to your manager for approval</p>
            </div>
            <button onClick={onClose} className={`${sub} text-2xl`}>×</button>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-xl px-3 py-2 mb-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className={`block text-sm font-medium ${label} mb-1`}>Outlet Name *</label>
              <input value={outletName} onChange={(e) => setOutletName(e.target.value)}
                placeholder="e.g. Kera Mini Mart"
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 ${input}`} />
            </div>

            <div>
              <label className={`block text-sm font-medium ${label} mb-1`}>Owner Name</label>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Owner's full name"
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 ${input}`} />
            </div>

            <div>
              <label className={`block text-sm font-medium ${label} mb-1`}>Phone Number</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="09XXXXXXXX" type="tel"
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 ${input}`} />
            </div>

            <div>
              <label className={`block text-sm font-medium ${label} mb-1`}>Landmark / Description</label>
              <textarea value={landmark} onChange={(e) => setLandmark(e.target.value)}
                placeholder="e.g. Near Total station, Kera"
                rows={2}
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 resize-none ${input}`} />
            </div>

            {/* GPS */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={`text-sm font-medium ${label}`}>GPS Location *</label>
                <button onClick={autoFillGps} disabled={gpsLoading}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium disabled:opacity-50">
                  {gpsLoading ? 'Getting location…' : '📍 Use my location'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input value={lat} onChange={(e) => setLat(e.target.value)}
                  placeholder="Latitude" type="number" step="any"
                  className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 ${input}`} />
                <input value={lon} onChange={(e) => setLon(e.target.value)}
                  placeholder="Longitude" type="number" step="any"
                  className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 ${input}`} />
              </div>
              {lat && lon && (
                <p className={`${sub} text-xs mt-1`}>
                  📍 {parseFloat(lat).toFixed(4)}, {parseFloat(lon).toFixed(4)}
                </p>
              )}
            </div>
          </div>

          <button onClick={handleSubmit} disabled={saving || !outletName.trim()}
            className="w-full mt-6 py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all">
            {saving ? 'Submitting…' : 'Submit for Approval'}
          </button>
        </div>
      </div>
    </div>
  )
}
