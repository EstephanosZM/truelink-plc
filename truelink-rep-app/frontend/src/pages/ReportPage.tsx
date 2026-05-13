import { useState } from 'react'
import { useRepStore } from '../store/useRepStore'
import RouteCompletionReport from '../components/RouteCompletionReport'
import RepScorecard from '../components/RepScorecard'

export default function ReportPage() {
  const { activeRep, routePlanId, dayNumber, darkMode } = useRepStore()
  const [tab, setTab] = useState<'completion' | 'scorecard'>('completion')

  const bg   = darkMode ? 'bg-slate-900'   : 'bg-slate-50'
  const text = darkMode ? 'text-white'     : 'text-slate-900'
  const sub  = darkMode ? 'text-slate-400' : 'text-slate-500'

  const tabs = [
    { key: 'completion', label: "Today's Route" },
    { key: 'scorecard',  label: 'My Performance' },
  ] as const

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${bg}`}>
      {/* Tab bar */}
      <div className={`flex border-b shrink-0 ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t.key
                ? `border-b-2 border-blue-500 text-blue-400`
                : sub
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'completion' && routePlanId && dayNumber ? (
          <RouteCompletionReport
            routePlanId={routePlanId}
            dayNumber={dayNumber}
            repName={activeRep?.name}
            darkMode={darkMode}
          />
        ) : tab === 'completion' ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-center">
              <p className="text-4xl mb-3">📋</p>
              <p className={`${text} font-medium mb-1`}>No route for today</p>
              <p className={`${sub} text-sm`}>Your manager hasn't assigned a route yet</p>
            </div>
          </div>
        ) : null}

        {tab === 'scorecard' && activeRep && (
          <RepScorecard repId={activeRep.id} darkMode={darkMode} />
        )}
      </div>
    </div>
  )
}
