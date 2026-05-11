import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useStore } from './store/useStore'
import LoginPage from './pages/LoginPage'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import ProductsPage from './pages/ProductsPage'
import SalesEntryPage from './pages/SalesEntryPage'
import ReportsPage from './pages/ReportsPage'
import StockPage   from './pages/StockPage'
import LiveMapPage from './pages/LiveMapPage'

type Page = 'routes' | 'products' | 'sales' | 'reports'

export default function App() {
  const { isAuthenticated, setAuthenticated, setSettings, setTerritories,
          setSalesReps, setProximitySettings } = useStore()
  const [activePage, setActivePage] = useState<Page>('routes')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { setAuthenticated(true); bootstrap() }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) { setAuthenticated(true); bootstrap() }
      else setAuthenticated(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const bootstrap = async () => {
    const [s, t, r, ps] = await Promise.all([
      supabase.from('settings').select('*').single(),
      supabase.from('territories').select('*').order('name'),
      supabase.from('sales_representatives').select('*').order('name'),
      supabase.from('proximity_settings').select('*'),
    ])
    if (s.data)  setSettings(s.data)
    if (t.data)  setTerritories(t.data)
    if (r.data)  setSalesReps(r.data)
    if (ps.data) setProximitySettings(ps.data)
  }

  if (!isAuthenticated) return <LoginPage />

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <Navbar activePage={activePage} setActivePage={setActivePage} />
      <div className="flex flex-1 overflow-hidden">
        {activePage === 'routes' && (
          <>
            <Sidebar />
            <MapView />
          </>
        )}
        {activePage === 'products' && <ProductsPage />}
        {activePage === 'sales'    && <SalesEntryPage />}
        {activePage === 'reports'  && <ReportsPage />}
        {activePage === 'stock'   && <StockPage />}
	{activePage === 'livemap' && <LiveMapPage />}
      </div>
    </div>
  )
}
