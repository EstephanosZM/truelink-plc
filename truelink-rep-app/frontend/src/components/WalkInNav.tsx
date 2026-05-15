import { useRepStore } from '../store/useRepStore'

export default function WalkInNav() {
  const { page, setPage, darkMode } = useRepStore()

  const tabs = [
    { key: 'pos',   icon: '🏪', label: 'Sales'  },
    { key: 'stock', icon: '📦', label: 'Stock'  },
  ] as const

  const bg    = darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
  const active = 'text-blue-500'
  const inact  = darkMode ? 'text-slate-500' : 'text-slate-400'

  return (
    <div className={`absolute bottom-0 left-0 right-0 ${bg} border-t flex items-center safe-area-pb z-10`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setPage(tab.key)}
          className={`flex-1 flex flex-col items-center py-3 transition-colors ${
            page === tab.key ? active : inact
          }`}
        >
          <span className="text-2xl">{tab.icon}</span>
          <span className="text-xs mt-0.5 font-medium">{tab.label}</span>
        </button>
      ))}
    </div>
  )
}
