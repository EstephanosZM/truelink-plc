import Papa from 'papaparse'

export interface ParsedOutlet {
  outlet_name: string
  latitude: number
  longitude: number
  pep_code?: string | null
  owner_name?: string | null
  phone_number?: string | null
  ot1_id?: string | null
  land_mark?: string | null
  route_code?: string | null
  visit_freq?: string | null
  visit_day?: string | null
  visit_week?: string | null
}

const COL_MAP: Record<string, keyof ParsedOutlet> = {
  'outlet name':  'outlet_name',
  'outlet_name':  'outlet_name',
  'outletname':   'outlet_name',
  'name':         'outlet_name',
  'latitude_':    'latitude',
  'latitude':     'latitude',
  'lat':          'latitude',
  'longitude_':   'longitude',
  'longitude':    'longitude',
  'lon':          'longitude',
  'lng':          'longitude',
  'pep-code':     'pep_code',
  'pep_code':     'pep_code',
  'pepcode':      'pep_code',
  'pep code':     'pep_code',
  'owner name':   'owner_name',
  'owner_name':   'owner_name',
  'ownername':    'owner_name',
  'phone number': 'phone_number',
  'phone_number': 'phone_number',
  'phonenumber':  'phone_number',
  'phone':        'phone_number',
  'ot1 id':       'ot1_id',
  'ot1_id':       'ot1_id',
  'ot1id':        'ot1_id',
  'land_mark':    'land_mark',
  'landmark':     'land_mark',
  'land mark':    'land_mark',
  'route code':   'route_code',
  'route_code':   'route_code',
  'routecode':    'route_code',
  'visit freq':   'visit_freq',
  'visit_freq':   'visit_freq',
  'visitfreq':    'visit_freq',
  'visit day':    'visit_day',
  'visit_day':    'visit_day',
  'visitday':     'visit_day',
  'visit week':   'visit_week',
  'visit_week':   'visit_week',
  'visitweek':    'visit_week',
}

export function parseCSV(file: File): Promise<ParsedOutlet[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        const raw = results.data as Record<string, string>[]

        if (!raw.length) { reject(new Error('CSV file is empty')); return }

        const firstRow  = raw[0]
        const headerMap: Record<string, keyof ParsedOutlet> = {}

        for (const col of Object.keys(firstRow)) {
          const norm  = col.trim().toLowerCase()
          const field = COL_MAP[norm]
          if (field) headerMap[col] = field
        }

        const mapped = Object.values(headerMap)
        if (!mapped.includes('outlet_name')) { reject(new Error('Missing required column: Outlet name')); return }
        if (!mapped.includes('latitude'))    { reject(new Error('Missing required column: Latitude_'));   return }
        if (!mapped.includes('longitude'))   { reject(new Error('Missing required column: Longitude_'));  return }

        const outlets: ParsedOutlet[] = []

        raw.forEach((row, i) => {
          const m: Partial<ParsedOutlet> = {}
          for (const [col, field] of Object.entries(headerMap)) {
            const val = row[col]?.trim()
            if (val) (m as Record<string, unknown>)[field] = val
          }

          const lat = parseFloat(m.latitude as unknown as string)
          const lon = parseFloat(m.longitude as unknown as string)

          if (isNaN(lat) || isNaN(lon)) {
            console.warn(`Row ${i + 2}: invalid coordinates`)
            return
          }

          outlets.push({
            outlet_name:  m.outlet_name  || `Outlet ${i + 2}`,
            latitude:     lat,
            longitude:    lon,
            pep_code:     m.pep_code     || null,
            owner_name:   m.owner_name   || null,
            phone_number: m.phone_number || null,
            ot1_id:       m.ot1_id       || null,
            land_mark:    m.land_mark    || null,
            route_code:   m.route_code   || null,
            visit_freq:   m.visit_freq   || null,
            visit_day:    m.visit_day    || null,
            visit_week:   m.visit_week   || null,
          })
        })

        if (!outlets.length) { reject(new Error('No valid outlets found in CSV')); return }
        resolve(outlets)
      },
      error: (err) => reject(new Error(`CSV parse error: ${err.message}`)),
    })
  })
}
