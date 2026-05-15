import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'
import { getCurrentPosition } from '../lib/utils'
import OutletSheet from './OutletSheet'

interface Props { onClose: () => void }

export default function RegisterOutletSheet({ onClose }: Props) {
  const { activeRep, darkMode } = useRepStore()

  const [name,      setName]      = useState('')
  const [tin,       setTin]       = useState('')
  const [owner,     setOwner]     = useState('')
  const [phone,     setPhone]     = useState('')
  const [landmark,  setLandmark]  = useState('')
  const [lat,       setLat]       = useState('')
  const [lon,       setLon]       = useState('')
  const [gpsLoading,setGpsLoading]= useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  // Walk-in sell immediately
  const [walkInOutlet, setWalkInOutlet] = useState<null | {
    id: string; outlet_name: string; latitude: number; longitude: number
    land_mark: string | null; phone_number: string | null
  }>(null)

  const getGPS = async () => {
    setGpsLoading(true)
    try {
      const pos = await getCurrentPosition()
      setLat(pos.coords.latitude.toFixed(6))
      setLon(pos.coords.longitude.toFixed(6))
    } catch { setError('Could not get GPS. Enter coordinates manually.') }
    setGpsLoading(false)
  }

  const submit = async (andSell = false) => {
    if (!name.trim()) return setError('Outlet name is required')
    const latNum = parseFloat(lat); const lonNum = parseFloat(lon)
    if (isNaN(latNum) || isNaN(lonNum)) return setError('GPS coordinates are required. Tap 📍 to get your location.')
    setSaving(true); setError('')

    const { data, err } = await supabase.from('outlets').insert({
      outlet_name:  name.trim(),
      tin_number:   tin.trim()      || null,
      owner_name:   owner.trim()    || null,
      phone_number: phone.trim()    || null,
      land_mark:    landmark.trim() || null,
      latitude:     latNum,
      longitude:    lonNum,
      status:       'pending',
      territory_id: null,
    }).select().single() as { data: {
      id: string; outlet_name: string; latitude: number; longitude: number
      land_mark: string | null; phone_number: string | null
    } | null; err: unknown }

    if (!data) { setSaving(false); setError('Failed to save outlet'); return }

    // Notify manager
    await supabase.from('notifications').insert({
      type:    'new_outlet',
      title:   '📍 New Outlet Submitted',
      message: `${activeRep?.name} registered: ${name.trim()}${tin.trim() ? ` (TIN: ${tin.trim()})` : ''}`,
      data:    { outlet_id: data.id, rep_id: activeRep?.id },
    })

    if (andSell) {
      setSaving(false)
      setWalkInOutlet(data)
    } else {
      setSaving(false)
      onClose()
    }
  }

  // If Submit & Sell Now was tapped, hand off to OutletSheet in walk-in mode
  if (walkInOutlet) {
    return <OutletSheet onClose={onClose} walkInOutlet={walkInOutlet} />
  }

  const bg   = darkMode ? 'bg-slate-900' : 'bg-white'
  const text = darkMode ? 'text-white'   : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'
  const inp  = darkMode
    ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400'
    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`relative ${bg} rounded-t-2xl max-h-[92vh] flex flex-col`}>
        <div className="flex justify-center pt-3 pb-1">
          <div className={`w-10 h-1 ${darkMode ? 'bg-slate-700' : 'bg-slate-300'} rounded-full`} />
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <h2 className={`${text} font-bold text-lg`}>Register New Outlet</h2>
            <button onClick={onClose} className={`${sub} text-2xl`}>×</button>
          </div>

          <div className="space-y-3">
            <div>
              <label className={`block text-xs font-medium ${sub} mb-1`}>Outlet Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop name"
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
            </div>

            <div>
              <label className={`block text-xs font-medium ${sub} mb-1`}>TIN Number</label>
              <input value={tin} onChange={(e) => setTin(e.target.value)}
                placeholder="e.g. 0012345678 (optional)"
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-xs font-medium ${sub} mb-1`}>Owner Name</label>
                <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Optional"
                  className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
              </div>
              <div>
                <label className={`block text-xs font-medium ${sub} mb-1`}>Phone Number</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional"
                  className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
              </div>
            </div>

            <div>
              <label className={`block text-xs font-medium ${sub} mb-1`}>Landmark</label>
              <input value={landmark} onChange={(e) => setLandmark(e.target.value)}
                placeholder="e.g. Near Total station, Kera"
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
            </div>

            <div>
              <label className={`block text-xs font-medium ${sub} mb-1`}>GPS Location *</label>
              <div className="flex gap-2">
                <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude"
                  className={`flex-1 px-3 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
                <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Longitude"
                  className={`flex-1 px-3 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inp}`} />
                <button onClick={getGPS} disabled={gpsLoading}
                  className="px-4 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 shrink-0">
                  {gpsLoading ? '…' : '📍'}
                </button>
              </div>
              <p className={`${sub} text-xs mt-1`}>Tap 📍 to use your current location</p>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-800 rounded-xl px-3 py-2 text-red-400 text-sm">
                {error}
              </div>
            )}
          </div>

          <div className="mt-6 space-y-3">
            <button onClick={() => submit(false)} disabled={saving}
              className={`w-full py-4 border-2 rounded-2xl font-bold text-base disabled:opacity-50 active:scale-95 transition-all ${
                darkMode
                  ? 'border-blue-500 text-blue-400 hover:bg-blue-900/20'
                  : 'border-blue-600 text-blue-600 hover:bg-blue-50'
              }`}>
              {saving ? 'Submitting…' : 'Submit for Approval'}
            </button>
            <button onClick={() => submit(true)} disabled={saving}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-2xl text-white font-bold text-base disabled:opacity-50 transition-all">
              {saving ? 'Submitting…' : 'Submit & Sell Now →'}
            </button>
            <p className={`${sub} text-xs text-center`}>
              "Sell Now" opens the cart immediately. Outlet stays pending until manager approves.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
