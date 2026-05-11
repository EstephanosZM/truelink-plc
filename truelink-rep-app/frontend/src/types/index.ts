export interface SalesRep {
  id: string
  name: string
  phone_number: string | null
  territory_id: string | null
  monthly_target: number
}

export interface StockLoad {
  id: string
  sales_rep_id: string
  product_id: string
  load_date: string
  quantity_added: number
  current_balance: number
  quantity_returned: number
  is_finalized: boolean
}

export interface OutletVisit {
  id: string
  route_plan_id: string
  day_number: number
  outlet_id: string
  sales_rep_id: string
  visit_date: string
  visit_status: 'sold' | 'no_sale' | 'closed' | 'not_visited'
  non_sale_reason_id: string | null
  non_sale_notes: string | null
  checkin_lat: number | null
  checkin_lon: number | null
  checkin_distance_m: number | null
  checkin_within_radius: boolean | null
  checkin_flagged: boolean
  flag_reason: string | null
  visited_at: string | null
}

export interface NonSaleReason {
  id: string
  reason: string
  is_active: boolean
}

export interface Outlet {
  id: string
  territory_id: string
  outlet_name: string
  owner_name: string | null
  phone_number: string | null
  land_mark: string | null
  latitude: number
  longitude: number
  pep_code: string | null
}

export interface RouteStop {
  id: string
  route_plan_id: string
  day_number: number
  outlet_id: string
  sequence: number
  sales_rep_id: string | null
}

export interface RoutePlan {
  id: string
  territory_id: string
  generated_at: string
  n_days: number
  status: string
}

export interface Product {
  id: string
  name: string
  brand_id: string
  flavor_id: string
  unit_price: number
  sku_code: string | null
  status: string
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
}

export interface CartItem {
  product: Product
  quantity: number
  stock: number
}

export interface DayStop extends RouteStop {
  outlet: Outlet
  visit?: OutletVisit
  sales?: SalesRecord[]
}
