export interface Settings {
  id: string
  warehouse_name: string
  warehouse_lat: number
  warehouse_lon: number
}

export interface Territory {
  id: string
  name: string
  color: string
  created_at: string
}

export interface ProximitySetting {
  id: string
  territory_id: string
  radius_meters: number
  proximity_enabled: boolean
}

export interface Outlet {
  id: string
  territory_id: string
  pep_code: string | null
  outlet_name: string
  owner_name: string | null
  phone_number: string | null
  ot1_id: string | null
  land_mark: string | null
  latitude: number
  longitude: number
  route_code: string | null
  visit_freq: string | null
  visit_day: string | null
  visit_week: string | null
  status: string
  notes: string | null
}

export interface SalesRep {
  id: string
  name: string
  phone_number: string | null
  territory_id: string | null
}

export interface RoutePlan {
  id: string
  territory_id: string
  generated_at: string
  n_days: number
  min_outlets: number
  max_outlets: number
  status: 'draft' | 'saved'
}

export interface RouteStop {
  id: string
  route_plan_id: string
  day_number: number
  outlet_id: string
  sequence: number
  sales_rep_id: string | null
  visited: boolean
  visited_at: string | null
  checkin_lat: number | null
  checkin_lon: number | null
  checkin_distance_m: number | null
  checkin_within_radius: boolean | null
  checkin_flagged: boolean
  flag_reason: string | null
}

export interface Brand {
  id: string
  name: string
  logo_url: string | null
  created_at: string
}

export interface Flavor {
  id: string
  brand_id: string
  name: string
  created_at: string
}

export interface Product {
  id: string
  brand_id: string
  flavor_id: string
  name: string
  sku_code: string | null
  unit_price: number
  description: string | null
  status: string
  created_at: string
}

export interface SalesRecord {
  id: string
  route_plan_id: string
  day_number: number
  outlet_id: string
  sales_rep_id: string | null
  product_id: string
  quantity: number
  unit_price: number
  total_price: number
  sale_date: string
  notes: string | null
}

export interface StopOut {
  id: string
  sequence: number
  name: string
  lat: number
  lon: number
}

export interface DayRoute {
  day: number
  salesRepId: string | null
  stops: StopOut[]
}
