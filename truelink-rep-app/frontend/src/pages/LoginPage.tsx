import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRepStore } from '../store/useRepStore'

// Shared credentials — embedded so reps never see a login form
const SHARED_EMAIL    = 'testa@test.com'       // ← change to your shared rep email
const SHARED_PASSWORD = 'testa'      // ← change to your shared rep password

type Step = 'loading' | 'pick' | 'pin' | 'error'

export default function LoginPage() {
  const { allReps, setAuthenticated, setActiveRep } = useRepStore()

  const [step,        setStep]        = useState<Step>('loading')
  const [selectedRep, setSelectedRep] = useState<typeof allReps[0] | null>(null)
  const [pin,         setPin]         = useState(['', '', '', ''])
  const [pinError,    setPinError]    = useState('')
  const [authError,   setAuthError]   = useState('')
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Auto-login with shared credentials on mount
  useEffect(() => {
    autoLogin()
  }, [])

  const autoLogin = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setAuthenticated(true)
        await loadReps()
        setStep('pick')
        return
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: SHARED_EMAIL, password: SHARED_PASSWORD,
      })
      if (error) { setAuthError(error.message); setStep('error'); return }
      setAuthenticated(true)
      await loadReps()
      setStep('pick')
    } catch {
      setAuthError('Could not connect. Check your internet connection.')
      setStep('error')
    }
  }

  const loadReps = async () => {
    const { data } = await supabase
      .from('sales_representatives').select('*').order('name')
    if (data) useRepStore.getState().setAllReps(data)
  }

  const handlePickRep = (rep: typeof allReps[0]) => {
    setSelectedRep(rep)
    setPin(['', '', '', ''])
    setPinError('')
    setStep('pin')
    setTimeout(() => inputRefs.current[0]?.focus(), 100)
  }

  const handlePinDigit = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return
    const newPin = [...pin]
    newPin[index] = value
    setPin(newPin)
    setPinError('')
    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }
    if (value && index === 3) {
      const enteredPin = [...newPin.slice(0, 3), value].join('')
      verifyPin(enteredPin)
    }
  }

  const handlePinKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const verifyPin = (enteredPin: string) => {
    if (!selectedRep) return
    const rep = selectedRep as typeof allReps[0] & { pin_code?: string }
    if (!rep.pin_code) {
      setActiveRep(selectedRep)
      return
    }
    if (enteredPin === rep.pin_code) {
      setActiveRep(selectedRep)
    } else {
      setPinError('Incorrect PIN. Try again.')
      setPin(['', '', '', ''])
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }

  const submitPin = () => {
    const enteredPin = pin.join('')
    if (enteredPin.length !== 4) { setPinError('Enter all 4 digits'); return }
    verifyPin(enteredPin)
  }

  // Loading screen
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold">TL</span>
          </div>
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mt-4" />
          <p className="text-slate-400 text-sm mt-3">Connecting…</p>
        </div>
      </div>
    )
  }

  // Error screen
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-red-900/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⚠</span>
          </div>
          <p className="text-white font-semibold mb-2">Connection Failed</p>
          <p className="text-slate-400 text-sm mb-6">{authError}</p>
          <button onClick={() => { setStep('loading'); autoLogin() }}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 active:scale-95">
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Name picker
  if (step === 'pick') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl font-bold">TL</span>
            </div>
            <h1 className="text-xl font-bold text-white">True Link PLC</h1>
            <p className="text-slate-400 text-sm mt-1">Who are you?</p>
          </div>
          <div className="space-y-2">
            {allReps.map((rep) => (
              <button key={rep.id} onClick={() => handlePickRep(rep)}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-2xl p-4 text-left transition-colors active:scale-95">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 bg-blue-600 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-white font-semibold text-sm">
                      {rep.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-medium">{rep.name}</p>
                    {rep.phone_number && <p className="text-slate-400 text-xs">{rep.phone_number}</p>}
                  </div>
                  <span className="ml-auto text-slate-600">›</span>
                </div>
              </button>
            ))}
            {allReps.length === 0 && (
              <p className="text-slate-400 text-center py-8 text-sm">
                No sales reps found. Ask your manager to add reps in the main app.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // PIN entry
  if (step === 'pin' && selectedRep) {
    const rep = selectedRep as typeof allReps[0] & { pin_code?: string }
    const initials = selectedRep.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-xs text-center">
          <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-2xl font-bold">{initials}</span>
          </div>
          <h2 className="text-white font-bold text-xl mb-1">{selectedRep.name}</h2>
          <p className="text-slate-400 text-sm mb-8">
            {rep.pin_code ? 'Enter your 4-digit PIN' : 'No PIN set — tap Continue'}
          </p>

          {rep.pin_code ? (
            <>
              {/* PIN input boxes */}
              <div className="flex justify-center gap-4 mb-8">
                {pin.map((digit, i) => (
                  <div key={i} className="relative">
                    <input
                      ref={(el) => { inputRefs.current[i] = el }}
                      type="tel"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handlePinDigit(i, e.target.value)}
                      onKeyDown={(e) => handlePinKeyDown(i, e)}
                      className="w-14 h-14 bg-slate-800 border-2 border-slate-700 rounded-2xl text-white text-2xl font-bold text-center focus:outline-none focus:border-blue-500 transition-colors opacity-0 absolute inset-0"
                    />
                    <div className={`w-14 h-14 bg-slate-800 border-2 rounded-2xl flex items-center justify-center transition-colors ${digit ? 'border-blue-500' : 'border-slate-700'}`}>
                      {digit ? <div className="w-3 h-3 bg-white rounded-full" /> : null}
                    </div>
                  </div>
                ))}
              </div>

              {pinError && (
                <p className="text-red-400 text-sm mb-4">{pinError}</p>
              )}

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((key, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (key === '⌫') {
                        const lastIdx = [...pin].map((d, i) => d ? i : -1).filter(i => i >= 0).pop()
                        if (lastIdx !== undefined) {
                          const newPin = [...pin]
                          newPin[lastIdx] = ''
                          setPin(newPin)
                          inputRefs.current[lastIdx]?.focus()
                        }
                      } else if (key !== '') {
                        const firstEmpty = pin.findIndex((d) => d === '')
                        if (firstEmpty >= 0) handlePinDigit(firstEmpty, String(key))
                      }
                    }}
                    className={`h-14 rounded-2xl text-xl font-semibold transition-colors active:scale-95 ${
                      key === ''
                        ? 'bg-transparent pointer-events-none'
                        : key === '⌫'
                        ? 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        : 'bg-slate-800 text-white hover:bg-slate-700'
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>

              <button onClick={submitPin}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 active:scale-95 transition-all">
                Continue →
              </button>
            </>
          ) : (
            <button onClick={() => setActiveRep(selectedRep)}
              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 active:scale-95">
              Continue →
            </button>
          )}

          <button onClick={() => { setStep('pick'); setSelectedRep(null) }}
            className="mt-4 text-slate-500 text-sm hover:text-slate-400">
            ← Not you?
          </button>
        </div>
      </div>
    )
  }

  return null
}
