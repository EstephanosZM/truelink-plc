export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R    = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    = Math.sin(dLat/2)**2 +
               Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 10000, maximumAge: 0,
    })
  })
}

/** Count remaining weekdays (Mon–Fri) in the current month including today */
export function remainingWorkingDaysInMonth(): number {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth()
  const last  = new Date(year, month + 1, 0).getDate()
  let count   = 0
  for (let d = now.getDate(); d <= last; d++) {
    const day = new Date(year, month, d).getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

/** Daily average target = monthly target / remaining working days */
export function dailyTarget(monthlyTarget: number): number {
  const days = remainingWorkingDaysInMonth()
  return days > 0 ? Math.round(monthlyTarget / days) : 0
}

export function fmtETB(n: number): string {
  return `ETB ${n.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function today(): string {
  return new Date().toISOString().split('T')[0]
}

export function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}
