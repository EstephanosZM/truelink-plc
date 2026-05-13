import { useRepStore } from '../store/useRepStore'

export default function BottomNav() {
  const { page, setPage, todayStops, darkMode } = useRepStore()

  const pending = todayStops.filter(
    (s) => !s.visit || s.visit.visit_status === 'not_visited'
  ).length

  const tabs = [
    { key: 'home',    icon: '🏠', label: 'Home'    },
    { key: 'map',     icon: '🗺',  label: 'Map'     },
    { key: 'list',    icon: '📋', label: 'Stops',  badge: pending > 0 ? pending : null },
    { key: 'stock',   icon: '📦', label: 'Stock'   },
    { key: 'reports', icon: '📊', label: 'Reports' },
  ] as const

  const bg     = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
  const active = 'text-blue-500'
  const inact  = darkMode ? 'text-slate-500' : 'text-slate-400'

  return (
    <div className={`absolute bottom-0 left-0 right-0 ${bg} border-t flex items-center safe-area-pb z-10`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setPage(tab.key as typeof page)}
          className={`flex-1 flex flex-col items-center py-3 relative transition-colors ${
            page === tab.key ? active : inact
          }`}
        >
          <span className="text-xl">{tab.icon}</span>
          <span className="text-xs mt-0.5 font-medium">{tab.label}</span>
          {'badge' in tab && tab.badge && (
            <span className="absolute top-2 right-1/2 translate-x-3 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
              {tab.badge > 9 ? '9+' : tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
