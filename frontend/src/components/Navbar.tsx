import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { parseCSV } from '../lib/csvParser'
import { getTerritoryColor } from '../lib/utils'
import SettingsModal from './SettingsModal'
import TerritoriesModal from './TerritoriesModal'

type Page = 'routes' | 'products' | 'sales' | 'reports' | 'stock' | 'livemap'
interface Props { activePage: Page; setActivePage: (p: Page) => void }

export default function Navbar({ activePage, setActivePage }: Props) {
  const { territories, activeTerritoryId, setActiveTerritoryId,
          addTerritory, setOutlets, setLoading, settings } = useStore()

  const [uploading,       setUploading]       = useState(false)
  const [uploadError,     setUploadError]      = useState('')
  const [showSettings,    setShowSettings]     = useState(false)
  const [showTerritories, setShowTerritories]  = useState(false)
  const [newTerName,      setNewTerName]       = useState('')
  const [showTerInput,    setShowTerInput]     = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

const navItems: { key: Page; label: string }[] = [
  { key: 'routes',   label: 'Routes'      },
  { key: 'products', label: 'Products'    },
  { key: 'sales',    label: 'Sales Entry' },
  { key: 'reports',  label: 'Reports'     },
  { key: 'stock',    label: 'Stock'       },
  { key: 'livemap',  label: 'Live Map'    },
]

  const handleTerritoryChange = async (id: string) => {
    setActiveTerritoryId(id)
    setLoading('outlets', true)
    const { data } = await supabase
      .from('outlets').select('*')
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
    const { data, error } = await supabase
      .from('territories').insert({ name, color }).select().single()
    if (!error && data) {
      addTerritory(data)
      setActiveTerritoryId(data.id)
      setOutlets([])
    }
    setNewTerName(''); setShowTerInput(false)
  }

  return (
    <>
      <nav className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-4 shrink-0 z-10">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">TL</span>
          </div>
          <span className="font-semibold text-slate-900 text-sm hidden md:block">True Link PLC</span>
        </div>

        <div className="w-px h-6 bg-slate-200" />

        {/* Nav tabs */}
        <div className="flex gap-1">
          {navItems.map((item) => (
            <button key={item.key} onClick={() => setActivePage(item.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activePage === item.key
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}>
              {item.label}
            </button>
          ))}
        </div>

        {/* Territory controls — only on Routes page */}
        {activePage === 'routes' && (
          <>
            <div className="w-px h-6 bg-slate-200" />
            <div className="flex items-center gap-2">
              <select
                value={activeTerritoryId || ''}
                onChange={(e) => e.target.value && handleTerritoryChange(e.target.value)}
                className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select territory</option>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              {/* Add territory */}
              <button
                onClick={() => setShowTerInput(!showTerInput)}
                className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors"
                title="Add territory"
              >+</button>

              {/* Manage territories */}
              <button
                onClick={() => setShowTerritories(true)}
                className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 transition-colors"
                title="Manage territories"
              >⚙ Territories</button>
            </div>

            {showTerInput && (
              <div className="flex items-center gap-2">
                <input
                  autoFocus value={newTerName}
                  onChange={(e) => setNewTerName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createTerritory()}
                  placeholder="Territory name…"
                  className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={createTerritory}
                  className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
                >Create</button>
              </div>
            )}
          </>
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          {uploadError && (
            <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-md">{uploadError}</span>
          )}

          {activePage === 'routes' && (
            <label className={`text-sm px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
              activeTerritoryId
                ? 'border-slate-300 hover:bg-slate-50 text-slate-700'
                : 'border-slate-200 text-slate-400 cursor-not-allowed'
            }`}>
              {uploading ? 'Uploading…' : '↑ Upload CSV'}
              <input
                ref={fileRef} type="file" accept=".csv" className="hidden"
                disabled={!activeTerritoryId || uploading}
                onChange={handleUpload}
              />
            </label>
          )}

          {settings && (
            <span className="text-xs text-slate-500 hidden lg:block">
              🏭 {settings.warehouse_name}
            </span>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50"
          >⚙ Settings</button>
        </div>
      </nav>

      {showSettings    && <SettingsModal    onClose={() => setShowSettings(false)} />}
      {showTerritories && <TerritoriesModal onClose={() => setShowTerritories(false)} />}
    </>
  )
}
