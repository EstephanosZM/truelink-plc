import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { parseCSV } from '../lib/csvParser'
import { getTerritoryColor } from '../lib/utils'
import SettingsModal from './SettingsModal'
import TerritoriesModal from './TerritoriesModal'

type Page = 'routes' | 'products' | 'sales' | 'reports' | 'stock' | 'livemap' | 'pending'
interface Props { activePage: Page; setActivePage: (p: Page) => void }

export default function Navbar({ activePage, setActivePage }: Props) {
  const { territories, activeTerritoryId, setActiveTerritoryId,
          addTerritory, setOutlets, setLoading, settings } = useStore()

  const [uploading,        setUploading]        = useState(false)
  const [uploadError,      setUploadError]       = useState('')
  const [showSettings,     setShowSettings]      = useState(false)
  const [showTerritories,  setShowTerritories]   = useState(false)
  const [newTerName,       setNewTerName]        = useState('')
  const [showTerInput,     setShowTerInput]      = useState(false)
  const [notifCount,       setNotifCount]        = useState(0)
  const [showNotifs,       setShowNotifs]        = useState(false)
  const [notifications,    setNotifications]     = useState<{id:string;title:string;message:string;created_at:string}[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const navItems: { key: Page; label: string }[] = [
    { key: 'routes',   label: 'Routes'      },
    { key: 'products', label: 'Products'    },
    { key: 'sales',    label: 'Sales Entry' },
    { key: 'reports',  label: 'Reports'     },
    { key: 'stock',    label: 'Stock'       },
    { key: 'livemap',  label: 'Live Map'    },
  ]

  // Poll for unread notifications
  useEffect(() => {
    loadNotifications()
    const interval = setInterval(loadNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  // Real-time subscription for new notifications
  useEffect(() => {
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications'
      }, () => { loadNotifications() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const loadNotifications = async () => {
    const { data, count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(10)
    setNotifCount(count || 0)
    setNotifications(data || [])
  }

  const markAllRead = async () => {
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    setNotifCount(0)
    setNotifications([])
    setShowNotifs(false)
  }

  const handleTerritoryChange = async (id: string) => {
    setActiveTerritoryId(id)
    setLoading('outlets', true)
    const { data } = await supabase.from('outlets').select('*')
      .eq('territory_id', id).eq('status', 'active')
    setOutlets(data || [])
    setLoading('outlets', false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeTerritoryId) return
    setUploading(true); setUploadError('')
    try {
      const parsed = await parseCSV(file)
      await supabase.from('outlets').delete().eq('territory_id', activeTerritoryId)
      const { error } = await supabase.from('outlets').insert(
        parsed.map((o) => ({ ...o, territory_id: activeTerritoryId, status: 'active' }))
      )
      if (error) throw error
      const { data } = await supabase.from('outlets').select('*')
        .eq('territory_id', activeTerritoryId).eq('status', 'active')
      setOutlets(data || [])
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const createTerritory = async () => {
    const name = newTerName.trim()
    if (!name) return
    const color = getTerritoryColor(name)
    const { data, error } = await supabase.from('territories').insert({ name, color }).select().single()
    if (!error && data) { addTerritory(data); setActiveTerritoryId(data.id); setOutlets([]) }
    setNewTerName(''); setShowTerInput(false)
  }

  return (
    <>
      <nav className="h-14 bg-white border-b border-slate-200 flex items-center px-3 gap-2 shrink-0 z-10">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-1">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">TL</span>
          </div>
          <span className="font-semibold text-slate-900 text-sm hidden lg:block">True Link PLC</span>
        </div>

        <div className="w-px h-6 bg-slate-200 shrink-0" />

        {/* Nav — scrollable on mobile */}
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {navItems.map((item) => (
            <button key={item.key} onClick={() => setActivePage(item.key)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                activePage === item.key ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              {item.label}
            </button>
          ))}
        </div>

        {/* Territory controls */}
        {activePage === 'routes' && (
          <>
            <div className="w-px h-6 bg-slate-200 shrink-0 hidden md:block" />
            <div className="hidden md:flex items-center gap-2">
              <select value={activeTerritoryId || ''}
                onChange={(e) => e.target.value && handleTerritoryChange(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Select territory</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button onClick={() => setShowTerInput(!showTerInput)}
                className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 hover:bg-slate-50">+</button>
              <button onClick={() => setShowTerritories(true)}
                className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-slate-600 hidden lg:block">
                ⚙ Territories
              </button>
            </div>
            {showTerInput && (
              <div className="hidden md:flex items-center gap-2">
                <input autoFocus value={newTerName} onChange={(e) => setNewTerName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createTerritory()}
                  placeholder="Territory name…"
                  className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 w-32 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={createTerritory}
                  className="text-sm bg-blue-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-700">Create</button>
              </div>
            )}
          </>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {uploadError && (
            <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-md hidden md:block">{uploadError}</span>
          )}

          {activePage === 'routes' && (
            <label className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors hidden md:block ${
              activeTerritoryId
                ? 'border-slate-300 hover:bg-slate-50 text-slate-700'
                : 'border-slate-200 text-slate-400 cursor-not-allowed'
            }`}>
              {uploading ? 'Uploading…' : '↑ CSV'}
              <input ref={fileRef} type="file" accept=".csv" className="hidden"
                disabled={!activeTerritoryId || uploading} onChange={handleUpload} />
            </label>
          )}

          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="relative w-8 h-8 flex items-center justify-center rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors"
            >
              🔔
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>

            {/* Notification dropdown */}
            {showNotifs && (
              <div className="absolute right-0 top-10 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                  <p className="font-semibold text-slate-900 text-sm">Notifications</p>
                  {notifCount > 0 && (
                    <button onClick={markAllRead}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map((n) => (
                    <div key={n.id} className="px-4 py-3 border-b border-slate-100 hover:bg-slate-50">
                      <p className="text-sm font-medium text-slate-900">{n.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{n.message}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {new Date(n.created_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                      {n.title.includes('New Outlet') && (
                        <button
                          onClick={() => { setActivePage('pending'); setShowNotifs(false) }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-1"
                        >
                          Review →
                        </button>
                      )}
                    </div>
                  ))}
                  {notifications.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-8">No new notifications</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Pending outlets badge */}
          {notifCount > 0 && (
            <button
              onClick={() => setActivePage('pending')}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 font-medium hover:bg-amber-200 transition-colors hidden md:flex items-center gap-1"
            >
              📍 {notifCount} pending
            </button>
          )}

          {settings && (
            <span className="text-xs text-slate-500 hidden xl:block">🏭 {settings.warehouse_name}</span>
          )}

          <button onClick={() => setShowSettings(true)}
            className="text-xs text-slate-600 border border-slate-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
            ⚙
          </button>
        </div>
      </nav>

      {showSettings    && <SettingsModal    onClose={() => setShowSettings(false)} />}
      {showTerritories && <TerritoriesModal onClose={() => setShowTerritories(false)} />}
    </>
  )
}
