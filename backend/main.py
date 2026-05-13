"""
TRUE LINK PLC — Route Optimizer API v1.3
=========================================
Improvement: nearest-neighbour road-based sequencing
instead of OSRM /trip TSP solver.

This produces routes that follow the natural road flow:
start at warehouse, always go to the closest unvisited
outlet by road, return to warehouse at end.
"""

import os
import math
import logging
from typing import List, Optional

import requests
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

OSRM_BASE    = os.environ.get("OSRM_BASE", "http://router.project-osrm.org")
OSRM_TIMEOUT = 30

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("truelink-api")

app = FastAPI(title="True Link PLC Route API", version="1.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ────────────────────────────────────────────────────────────────────

class OutletIn(BaseModel):
    id:   str
    lat:  float
    lon:  float
    name: str

class WarehouseIn(BaseModel):
    lat: float
    lon: float

class OptimizeRequest(BaseModel):
    outlets:     List[OutletIn]
    warehouse:   WarehouseIn
    n_days:      int
    min_outlets: int = 1
    max_outlets: int = 9999

class DayOutlets(BaseModel):
    day:     int
    outlets: List[OutletIn]

class ReoptimizeRequest(BaseModel):
    days:      List[DayOutlets]
    warehouse: WarehouseIn

class StopOut(BaseModel):
    id:       str
    sequence: int
    name:     str
    lat:      float
    lon:      float

class DayResult(BaseModel):
    day:   int
    stops: List[StopOut]

class RouteResponse(BaseModel):
    days: List[DayResult]

# ── OSRM helpers ──────────────────────────────────────────────────────────────

def osrm_duration(
    origins:      List[dict],
    destinations: List[dict],
) -> Optional[List[List[float]]]:
    """
    Call OSRM /table to get a duration matrix between origins and destinations.
    Returns a 2D list of durations in seconds, or None on failure.
    """
    all_coords = origins + destinations
    coords_str = ";".join(f"{p['lon']},{p['lat']}" for p in all_coords)
    n_orig = len(origins)
    sources      = ";".join(str(i) for i in range(n_orig))
    destinations_idx = ";".join(str(i) for i in range(n_orig, len(all_coords)))

    url = (
        f"{OSRM_BASE}/table/v1/driving/{coords_str}"
        f"?sources={sources}&destinations={destinations_idx}&annotations=duration"
    )
    try:
        r = requests.get(url, timeout=OSRM_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        if data.get("code") == "Ok":
            return data.get("durations")
    except Exception as e:
        log.error("OSRM table error: %s", e)
    return None


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Straight-line distance in metres as fallback."""
    R    = 6371000
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a    = (math.sin(dLat/2)**2 +
            math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
            math.sin(dLon/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def nearest_neighbour_road(
    outlets:   List[OutletIn],
    warehouse: WarehouseIn,
) -> List[OutletIn]:
    """
    Nearest-neighbour sequencing using OSRM road durations.

    Algorithm:
      1. Start at warehouse
      2. Get road durations from current position to all unvisited outlets
      3. Visit the nearest (shortest duration) outlet
      4. Repeat until all outlets visited
      5. Return ordered list

    Falls back to straight-line distance if OSRM fails.
    """
    if not outlets:
        return []
    if len(outlets) == 1:
        return outlets

    unvisited = list(outlets)
    ordered   = []
    current   = {"lat": warehouse.lat, "lon": warehouse.lon}

    while unvisited:
        # Build OSRM table: 1 origin (current) → N destinations (unvisited)
        destinations = [{"lat": o.lat, "lon": o.lon} for o in unvisited]
        durations    = osrm_duration([current], destinations)

        if durations and durations[0]:
            row = durations[0]
            # Find index with minimum duration (ignore None values)
            best_idx = min(
                range(len(row)),
                key=lambda i: row[i] if row[i] is not None else float('inf')
            )
        else:
            # Fallback: nearest by straight line
            best_idx = min(
                range(len(unvisited)),
                key=lambda i: haversine_meters(
                    current["lat"], current["lon"],
                    unvisited[i].lat, unvisited[i].lon
                )
            )

        chosen  = unvisited.pop(best_idx)
        ordered.append(chosen)
        current = {"lat": chosen.lat, "lon": chosen.lon}

    return ordered


def chunk_nearest_neighbour(
    outlets:   List[OutletIn],
    warehouse: WarehouseIn,
    chunk_size: int = 50,
) -> List[OutletIn]:
    """
    For large clusters, split into geographic chunks then apply
    nearest-neighbour within each chunk and stitch chunks together
    in order of proximity to the warehouse.

    Chunk size is kept at 50 (not 100) to keep OSRM table calls fast
    and accurate — large tables degrade in quality.
    """
    if len(outlets) <= chunk_size:
        return nearest_neighbour_road(outlets, warehouse)

    n_chunks = math.ceil(len(outlets) / chunk_size)
    log.info("Large cluster (%d outlets) → %d chunks", len(outlets), n_chunks)

    coords  = np.array([[o.lat, o.lon] for o in outlets])
    sc      = StandardScaler()
    km      = KMeans(n_clusters=n_chunks, random_state=42, n_init=10)
    labels  = km.fit_predict(sc.fit_transform(coords))
    cents   = sc.inverse_transform(km.cluster_centers_)

    # Order chunks: nearest centroid to warehouse first
    wh      = np.array([warehouse.lat, warehouse.lon])
    order   = sorted(range(n_chunks), key=lambda i: np.linalg.norm(cents[i] - wh))

    result = []
    # Track "current position" across chunks for realistic stitching
    current_wh = warehouse
    for ci in order:
        chunk = [o for o, l in zip(outlets, labels) if l == ci]
        # Use position of last outlet from previous chunk as start
        chunk_wh = WarehouseIn(lat=current_wh.lat, lon=current_wh.lon) \
            if hasattr(current_wh, 'lat') else warehouse
        ordered_chunk = nearest_neighbour_road(chunk, chunk_wh)
        result.extend(ordered_chunk)
        if ordered_chunk:
            last = ordered_chunk[-1]
            current_wh = WarehouseIn(lat=last.lat, lon=last.lon)

    return result

# ── Clustering ────────────────────────────────────────────────────────────────

def cluster_outlets(
    outlets:     List[OutletIn],
    n_days:      int,
    min_outlets: int,
    max_outlets: int,
) -> List[List[OutletIn]]:
    if not outlets:
        return [[] for _ in range(n_days)]

    eff    = min(n_days, len(outlets))
    coords = np.array([[o.lat, o.lon] for o in outlets])
    sc     = StandardScaler()
    km     = KMeans(n_clusters=eff, random_state=42, n_init=10)
    labels = km.fit_predict(sc.fit_transform(coords))

    clusters = [[] for _ in range(eff)]
    for o, l in zip(outlets, labels):
        clusters[l].append(o)
    while len(clusters) < n_days:
        clusters.append([])

    # Enforce max_outlets
    changed = True
    iters   = 0
    while changed and iters < 100:
        changed = False
        iters  += 1
        for i, cl in enumerate(clusters):
            while len(cl) > max_outlets:
                cen  = np.mean([[o.lat, o.lon] for o in cl], axis=0)
                far  = max(range(len(cl)),
                           key=lambda j: np.linalg.norm([cl[j].lat - cen[0], cl[j].lon - cen[1]]))
                out  = cl.pop(far)
                dest = min((j for j in range(n_days) if j != i), key=lambda j: len(clusters[j]))
                clusters[dest].append(out)
                changed = True

    return clusters

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/optimize", response_model=RouteResponse)
def optimize(req: OptimizeRequest):
    if req.n_days < 1:
        raise HTTPException(400, "n_days must be >= 1")
    if req.min_outlets < 1:
        raise HTTPException(400, "min_outlets must be >= 1")
    if req.min_outlets > req.max_outlets:
        raise HTTPException(400, "min_outlets cannot exceed max_outlets")
    if not req.outlets:
        raise HTTPException(400, "No outlets provided")

    log.info("Optimizing %d outlets → %d days", len(req.outlets), req.n_days)
    clusters = cluster_outlets(req.outlets, req.n_days, req.min_outlets, req.max_outlets)

    days = []
    for i, cluster in enumerate(clusters):
        if not cluster:
            days.append(DayResult(day=i+1, stops=[]))
            continue
        ordered = chunk_nearest_neighbour(cluster, req.warehouse)
        days.append(DayResult(
            day=i+1,
            stops=[
                StopOut(id=o.id, sequence=s+1, name=o.name, lat=o.lat, lon=o.lon)
                for s, o in enumerate(ordered)
            ]
        ))
        log.info("Day %d: %d stops", i+1, len(ordered))

    return RouteResponse(days=days)


@app.post("/reoptimize", response_model=RouteResponse)
def reoptimize(req: ReoptimizeRequest):
    if not req.days:
        raise HTTPException(400, "No days provided")

    days = []
    for d in req.days:
        if not d.outlets:
            days.append(DayResult(day=d.day, stops=[]))
            continue
        ordered = chunk_nearest_neighbour(d.outlets, req.warehouse)
        days.append(DayResult(
            day=d.day,
            stops=[
                StopOut(id=o.id, sequence=s+1, name=o.name, lat=o.lat, lon=o.lon)
                for s, o in enumerate(ordered)
            ]
        ))

    return RouteResponse(days=days)
