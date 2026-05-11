import { createClient } from '@supabase/supabase-js'

// ── Replace these with your Supabase project values ──────────────────────────
const SUPABASE_URL      = 'https://mqkslxshmrjzkcoyldzp.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xa3NseHNobXJqemtjb3lsZHpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNjc2MjgsImV4cCI6MjA5Mzk0MzYyOH0._IX91nOJpxMggczm6OViiREpdVZs0H9-0iIH6vXfXEc'
// ─────────────────────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
