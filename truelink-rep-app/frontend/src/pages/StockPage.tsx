import { useRepStore } from '../store/useRepStore'

export default function StockPage() {
  const { stockLoads, products } = useRepStore()

  const totalBalance  = stockLoads.reduce((a, s) => a + s.current_balance, 0)
  const totalLoaded   = stockLoads.reduce((a, s) => a + s.current_balance + (s.quantity_added || 0), 0)
  const totalSold     = totalLoaded - totalBalance

  if (stockLoads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-900">
        <div className="text-center px-8">
          <p className="text-5xl mb-4">📦</p>
          <p className="text-white font-semibold mb-2">No stock loaded</p>
          <p className="text-slate-400 text-sm">Your manager hasn't loaded stock for today yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-900 pb-24">
      <div className="px-4 pt-6 space-y-4">
        {/* Summary */}
        <div className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-4">
            Stock Summary — Today
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Loaded',    value: totalLoaded,  color: 'text-white'     },
              { label: 'Sold',      value: totalSold,    color: 'text-green-400' },
              { label: 'Remaining', value: totalBalance, color: 'text-amber-400' },
            ].map((s) => (
              <div key={s.label} className="bg-slate-700/50 rounded-xl p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-slate-400 text-xs mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Per product */}
        <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide">By Product</p>
          </div>
          {stockLoads.map((sl) => {
            const prod      = products.find((p) => p.id === sl.product_id)
            if (!prod) return null
            const loaded    = sl.current_balance + (sl.quantity_added || 0)
            const sold      = loaded - sl.current_balance
            const pct       = loaded > 0 ? Math.round(sold / loaded * 100) : 0
            return (
              <div key={sl.id} className="px-4 py-4 border-b border-slate-700/50 last:border-0">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-white font-medium text-sm truncate">{prod.name}</p>
                    {prod.sku_code && (
                      <p className="text-slate-500 text-xs">{prod.sku_code}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-amber-400 font-bold">{sl.current_balance}</p>
                    <p className="text-slate-500 text-xs">remaining</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        pct >= 80 ? 'bg-green-500' :
                        pct >= 40 ? 'bg-blue-500'  : 'bg-amber-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-slate-400 text-xs shrink-0 w-16 text-right">
                    {sold}/{loaded} sold
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
