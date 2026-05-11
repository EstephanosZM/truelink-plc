import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'

export default function LoginPage() {
  const { allReps, setAuthenticated, setActiveRep } = useRepStore()
  const [step,     setStep]     = useState<'login' | 'pick'>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) { setError(error.message); return }
    setAuthenticated(true)
    setStep('pick')
  }

  const handlePickRep = (rep: typeof allReps[0]) => {
    setActiveRep(rep)
  }

  if (step === 'pick') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl font-bold">TL</span>
            </div>
            <h1 className="text-xl font-bold text-white">Who are you?</h1>
            <p className="text-slate-400 text-sm mt-1">Select your name to continue</p>
          </div>
          <div className="space-y-2">
            {allReps.map((rep) => (
              <button
                key={rep.id}
                onClick={() => handlePickRep(rep)}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl p-4 text-left transition-colors active:scale-95"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-white font-semibold text-sm">
                      {rep.name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-medium">{rep.name}</p>
                    {rep.phone_number && (
                      <p className="text-slate-400 text-xs">{rep.phone_number}</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {allReps.length === 0 && (
              <p className="text-slate-400 text-center py-8">
                No sales reps found. Ask your manager to add reps in the main app.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">TL</span>
          </div>
          <h1 className="text-xl font-bold text-white">True Link PLC</h1>
          <p className="text-slate-400 text-sm mt-1">Sales Rep Portal</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              required
            />
          </div>
          <div>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              required
            />
          </div>
          {error && (
            <p className="text-red-400 text-sm bg-red-900/30 px-3 py-2 rounded-lg">{error}</p>
          )}
          <button
            type="submit" disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors active:scale-95"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
