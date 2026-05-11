# True Link PLC — Route Management & Distribution Portal

## Quick Start

### Step 1 — Supabase
1. Go to https://supabase.com and create a new project
2. Open the SQL Editor and run the contents of `supabase/schema.sql`
3. Go to Authentication → Users → Add user → enter email + password
4. Go to Project Settings → API and copy:
   - Project URL
   - anon/public key

### Step 2 — Add your Supabase credentials
Open `frontend/src/lib/supabase.ts` and replace:
```
const SUPABASE_URL      = 'https://your-project.supabase.co'
const SUPABASE_ANON_KEY = 'your-anon-key-here'
```

### Step 3 — Start the backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Step 4 — Start the frontend
```bash
cd frontend
npm install
npm run dev
```

### Step 5 — Open the app
Go to http://localhost:3000

---

## First Time Setup in the App
1. Click ⚙ Settings → Warehouse tab → enter warehouse name and GPS coordinates
2. Click ⚙ Settings → Sales Reps tab → add your team
3. Click + next to the territory dropdown → create a territory
4. Click ↑ Upload CSV → upload your outlet file
5. Go to Products → add brands, flavors, and products
6. Set Days / Min / Max in the sidebar → click Create Route

---

## File Structure
```
truelink/
├── supabase/
│   └── schema.sql          ← run this in Supabase SQL editor
├── backend/
│   ├── main.py             ← FastAPI route optimizer
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   ├── types/index.ts
│   │   ├── lib/
│   │   │   ├── supabase.ts   ← PUT YOUR CREDENTIALS HERE
│   │   │   ├── api.ts
│   │   │   ├── utils.ts
│   │   │   └── csvParser.ts
│   │   ├── store/useStore.ts
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ProductsPage.tsx
│   │   │   ├── SalesEntryPage.tsx
│   │   │   └── ReportsPage.tsx
│   │   └── components/
│   │       ├── Navbar.tsx
│   │       ├── Sidebar.tsx
│   │       ├── MapView.tsx
│   │       └── SettingsModal.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── tsconfig.json
└── docker-compose.yml      ← for production with self-hosted OSRM
```

---

## Self-Hosted OSRM (recommended for production)
```bash
mkdir osrm-data
wget https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf -O osrm-data/map.osm.pbf
docker run -t -v $(pwd)/osrm-data:/data osrm/osrm-backend osrm-extract -p /opt/car.lua /data/map.osm.pbf
docker run -t -v $(pwd)/osrm-data:/data osrm/osrm-backend osrm-partition /data/map.osrm
docker run -t -v $(pwd)/osrm-data:/data osrm/osrm-backend osrm-customize /data/map.osrm
docker-compose up
```
