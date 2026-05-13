"""
TRUE LINK PLC — Route Optimizer API v1.5
=========================================
Routing methods available:
  - method=nearest_neighbour  (default, fast)
  - method=two_opt             (nearest neighbour + 2-opt post-processing, better quality)
  - method=ortools             (Google OR-Tools VRP solver, best quality, slower)

Clustering: DBSCAN (geographic compactness) + KMeans merge/split
"""

import os
import math
import logging
from typing import List, Optional, Literal

import requests
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.cluster import KMeans, DBSCAN
from sklearn.preprocessing import StandardScaler

OSRM_BASE    = os.environ.get("OSRM_BASE", "http://router.project-osrm.org")
OSRM_TIMEOUT = 30

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("truelink-api")

# ── Check OR-Tools availability ───────────────────────────────────────────────
try:
    from ortools.constraint_solver import routing_enums_pb2
    from ortools.constraint_solver import pywrapcp
    ORTOOLS_AVAILABLE = True
    log.info("OR-Tools available ✓")
except ImportError:
    ORTOOLS_AVAILABLE = False
    log.warning("OR-Tools not installed. Install with: pip install ortools")

app = FastAPI(title="True Link PLC Route API", version="1.5.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ────────────────────────────────────────────────────────────────────

RoutingMethod = Literal["nearest_neighbour", "two_opt", "ortools"]

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
    method:      RoutingMethod = "nearest_neighbour"

class DayOutlets(BaseModel):
    day:     int
    outlets: List[OutletIn]

class ReoptimizeRequest(BaseModel):
    days:      List[DayOutlets]
    warehouse: WarehouseIn
    method:    RoutingMethod = "nearest_neighbour"

class StopOut(BaseModel):
    id:       str
    sequence: int
    name:     str
    lat:      float
    lon:      float

class DayResult(BaseModel):
    day:    int
    stops:  List[StopOut]
    method: str = "nearest_neighbour"

class RouteResponse(BaseModel):
    days:   List[DayResult]
    method: str

# ── Geo helpers ───────────────────────────────────────────────────────────────

def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R    = 6371000
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a    = (math.sin(dLat/2)**2 +
            math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
            math.sin(dLon/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def build_distance_matrix(
    outlets:   List[OutletIn],
    warehouse: WarehouseIn,
) -> List[List[float]]:
    """
    Build a full NxN distance matrix (metres, haversine) including the warehouse.
    Index 0 = warehouse, indices 1..N = outlets.
    Used by OR-Tools and 2-Opt.
    """
    points = [{"lat": warehouse.lat, "lon": warehouse.lon}] + \
             [{"lat": o.lat, "lon": o.lon} for o in outlets]
    n      = len(points)
    matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                matrix[i][j] = haversine_meters(
                    points[i]["lat"], points[i]["lon"],
                    points[j]["lat"], points[j]["lon"],
                )
    return matrix

# ── OSRM ──────────────────────────────────────────────────────────────────────

def osrm_duration(
    origins:      List[dict],
    destinations: List[dict],
) -> Optional[List[List[float]]]:
    all_coords = origins + destinations
    coords_str = ";".join(f"{p['lon']},{p['lat']}" for p in all_coords)
    n_orig     = len(origins)
    src_str    = ";".join(str(i) for i in range(n_orig))
    dst_str    = ";".join(str(i) for i in range(n_orig, len(all_coords)))
    url = (f"{OSRM_BASE}/table/v1/driving/{coords_str}"
           f"?sources={src_str}&destinations={dst_str}&annotations=duration")
    try:
        r = requests.get(url, timeout=OSRM_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        if data.get("code") == "Ok":
            return data.get("durations")
    except Exception as e:
        log.error("OSRM table error: %s", e)
    return None

# ── Method 1: Nearest Neighbour ───────────────────────────────────────────────

def nearest_neighbour_road(
    outlets:   List[OutletIn],
    warehouse: WarehouseIn,
) -> List[OutletIn]:
    if not outlets:       return []
    if len(outlets) == 1: return outlets

    unvisited = list(outlets)
    ordered   = []
    current   = {"lat": warehouse.lat, "lon": warehouse.lon}

    while unvisited:
        destinations = [{"lat": o.lat, "lon": o.lon} for o in unvisited]
        durations    = osrm_duration([current], destinations)

        if durations and durations[0]:
            row      = durations[0]
            best_idx = min(
                range(len(row)),
                key=lambda i: row[i] if row[i] is not None else float('inf')
            )
        else:
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

# ── Method 2: 2-Opt ───────────────────────────────────────────────────────────

def two_opt_improve(
    route:     List[OutletIn],
    warehouse: WarehouseIn,
) -> List[OutletIn]:
    """
    2-Opt post-processing on top of any initial route.

    Algorithm:
      For every pair of edges (i, i+1) and (j, j+1) in the route,
      check whether reversing the segment between them shortens
      the total distance. If yes, keep the reversal.
      Repeat until no improvement is found.

    Uses haversine distance (no OSRM calls needed — this is fast).
    Includes warehouse as fixed start/end point.

    Typically improves route length by 10–20%.
    """
    if len(route) < 4:
        return route

    # Build full tour including warehouse: [wh, r0, r1, ..., rN, wh]
    wh    = OutletIn(id="__wh__", lat=warehouse.lat, lon=warehouse.lon, name="Warehouse")
    tour  = [wh] + list(route) + [wh]
    n     = len(tour)

    def dist(a: OutletIn, b: OutletIn) -> float:
        return haversine_meters(a.lat, a.lon, b.lat, b.lon)

    def tour_length(t: List[OutletIn]) -> float:
        return sum(dist(t[i], t[i+1]) for i in range(len(t)-1))

    improved = True
    iters    = 0
    max_iter = 100  # safety cap

    while improved and iters < max_iter:
        improved = False
        iters   += 1
        for i in range(1, n - 2):
            for j in range(i + 1, n - 1):
                # Current edges: (tour[i-1]→tour[i]) and (tour[j]→tour[j+1])
                # Proposed:      (tour[i-1]→tour[j])  and (tour[i]→tour[j+1])
                d_current = (dist(tour[i-1], tour[i]) +
                             dist(tour[j],   tour[j+1]))
                d_proposed = (dist(tour[i-1], tour[j]) +
                              dist(tour[i],   tour[j+1]))

                if d_proposed < d_current - 1e-10:  # improvement found
                    # Reverse segment tour[i..j]
                    tour[i:j+1] = tour[i:j+1][::-1]
                    improved = True

    log.info("2-Opt: %d iterations, final length %.0fm", iters, tour_length(tour))

    # Return route without warehouse endpoints
    return [s for s in tour[1:-1] if s.id != "__wh__"]


def nearest_neighbour_then_two_opt(
    outlets:   List[OutletIn],
    warehouse: WarehouseIn,
) -> List[OutletIn]:
    """Nearest neighbour first, then 2-Opt improvement pass."""
    initial = nearest_neighbour_road(outlets, warehouse)
    return two_opt_improve(initial, warehouse)

# ── Method 3: OR-Tools VRP ────────────────────────────────────────────────────

def ortools_sequence(
    outlets:   List[OutletIn],
    warehouse: WarehouseIn,
) -> List[OutletIn]:
    """
    Use Google OR-Tools to solve the Travelling Salesman Problem
    for a single day's cluster.

    OR-Tools finds a near-optimal route using guided local search.
    Typically 15–30% better than nearest neighbour on complex routes.

    Falls back to nearest_neighbour_then_two_opt if OR-Tools
    is not installed or fails.
    """
    if not ORTOOLS_AVAILABLE:
        log.warning("OR-Tools not available, falling back to 2-opt")
        return nearest_neighbour_then_two_opt(outlets, warehouse)

    if not outlets:       return []
    if len(outlets) == 1: return outlets

    n      = len(outlets) + 1  # +1 for warehouse (index 0)
    matrix = build_distance_matrix(outlets, warehouse)

    # Scale to integers (OR-Tools requires integer distances)
    scale       = 10
    int_matrix  = [[int(matrix[i][j] * scale) for j in range(n)] for i in range(n)]

    manager  = pywrapcp.RoutingIndexManager(n, 1, 0)  # n nodes, 1 vehicle, depot=0
    routing  = pywrapcp.RoutingModel(manager)

    def distance_callback(from_idx, to_idx):
        return int_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    transit_cb_idx = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_idx)

    # Search parameters — Guided Local Search for best quality
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.seconds = 10  # max 10 seconds per cluster

    solution = routing.SolveWithParameters(search_params)

    if not solution:
        log.warning("OR-Tools found no solution, falling back to 2-opt")
        return nearest_neighbour_then_two_opt(outlets, warehouse)

    # Extract route order
    index  = routing.Start(0)
    order  = []
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node != 0:  # skip warehouse (node 0)
            order.append(outlets[node - 1])
        index = solution.Value(routing.NextVar(index))

    log.info("OR-Tools solution: %d stops, distance %.0fm",
             len(order),
             solution.ObjectiveValue() / scale)

    return order if order else nearest_neighbour_then_two_opt(outlets, warehouse)

# ── Routing dispatcher ────────────────────────────────────────────────────────

def sequence_outlets(
    outlets:   List[OutletIn],
    warehouse: WarehouseIn,
    method:    RoutingMethod,
    chunk_size: int = 50,
) -> List[OutletIn]:
    """
    Route a cluster using the selected method.
    Large clusters are chunked and stitched regardless of method.
    """
    if not outlets:
        return []

    # For small clusters, apply method directly
    if len(outlets) <= chunk_size:
        if method == "two_opt":
            return nearest_neighbour_then_two_opt(outlets, warehouse)
        elif method == "ortools":
            return ortools_sequence(outlets, warehouse)
        else:
            return nearest_neighbour_road(outlets, warehouse)

    # Large clusters: chunk geographically, apply method per chunk
    n_chunks = math.ceil(len(outlets) / chunk_size)
    log.info("Large cluster (%d outlets) → %d chunks, method=%s", len(outlets), n_chunks, method)

    coords   = np.array([[o.lat, o.lon] for o in outlets])
    sc       = StandardScaler()
    km       = KMeans(n_clusters=n_chunks, random_state=42, n_init=10)
    labels   = km.fit_predict(sc.fit_transform(coords))
    cents    = sc.inverse_transform(km.cluster_centers_)
    wh       = np.array([warehouse.lat, warehouse.lon])
    order    = sorted(range(n_chunks), key=lambda i: np.linalg.norm(cents[i] - wh))

    result     = []
    current_wh = warehouse
    for ci in order:
        chunk = [o for o, l in zip(outlets, labels) if l == ci]
        if method == "two_opt":
            ordered = nearest_neighbour_then_two_opt(chunk, current_wh)
        elif method == "ortools":
            ordered = ortools_sequence(chunk, current_wh)
        else:
            ordered = nearest_neighbour_road(chunk, current_wh)
        result.extend(ordered)
        if ordered:
            last       = ordered[-1]
            current_wh = WarehouseIn(lat=last.lat, lon=last.lon)

    return result

# ── Compact clustering (unchanged from v1.4) ──────────────────────────────────

def estimate_eps(outlets: List[OutletIn], target_m: float = 800) -> float:
    return target_m / 6371000


def cluster_compact(
    outlets:     List[OutletIn],
    n_days:      int,
    min_outlets: int,
    max_outlets: int,
) -> List[List[OutletIn]]:
    if not outlets:
        return [[] for _ in range(n_days)]
    if len(outlets) <= n_days:
        result = [[o] for o in outlets]
        while len(result) < n_days: result.append([])
        return result

    coords_rad = np.radians([[o.lat, o.lon] for o in outlets])
    eps        = estimate_eps(outlets, 800)
    db         = DBSCAN(eps=eps, min_samples=1, metric='haversine', algorithm='ball_tree')
    labels     = db.fit_predict(coords_rad)
    n_micro    = len(set(labels))

    log.info("DBSCAN: %d micro-clusters from %d outlets", n_micro, len(outlets))

    micro: dict = {}
    for outlet, label in zip(outlets, labels):
        micro.setdefault(label, []).append(outlet)

    if n_micro == n_days:
        clusters = list(micro.values())
    elif n_micro <= n_days:
        clusters = list(micro.values())
        clusters.sort(key=len, reverse=True)
        while len(clusters) < n_days:
            largest = clusters.pop(0)
            if len(largest) < 2: clusters.append(largest); break
            coords_l = np.array([[o.lat, o.lon] for o in largest])
            sc       = StandardScaler()
            km2      = KMeans(n_clusters=2, random_state=42, n_init=10)
            labs2    = km2.fit_predict(sc.fit_transform(coords_l))
            clusters.extend([[o for o, l in zip(largest, labs2) if l == k] for k in range(2)])
            clusters.sort(key=len, reverse=True)
        while len(clusters) > n_days:
            clusters.sort(key=len)
            clusters.append(clusters.pop(0) + clusters.pop(0))
    else:
        centroids = np.array([
            [sum(o.lat for o in mc) / len(mc), sum(o.lon for o in mc) / len(mc)]
            for mc in micro.values()
        ])
        mc_list = list(micro.values())
        sc      = StandardScaler()
        km      = KMeans(n_clusters=n_days, random_state=42, n_init=10)
        grp     = km.fit_predict(sc.fit_transform(centroids))
        clusters = [[] for _ in range(n_days)]
        for mc, gid in zip(mc_list, grp):
            clusters[gid].extend(mc)

    while len(clusters) < n_days:
        clusters.append([])

    # Enforce max_outlets
    changed = True
    iters   = 0
    while changed and iters < 100:
        changed = False; iters += 1
        for i, cl in enumerate(clusters):
            while len(cl) > max_outlets:
                cen  = np.mean([[o.lat, o.lon] for o in cl], axis=0)
                far  = max(range(len(cl)), key=lambda j: np.linalg.norm([cl[j].lat-cen[0], cl[j].lon-cen[1]]))
                out  = cl.pop(far)
                dest = min((j for j in range(n_days) if j != i), key=lambda j: len(clusters[j]))
                clusters[dest].append(out)
                changed = True

    log.info("Final day sizes: %s", [len(c) for c in clusters])
    return clusters

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":           "ok",
        "ortools_available": ORTOOLS_AVAILABLE,
        "methods":          ["nearest_neighbour", "two_opt", "ortools" if ORTOOLS_AVAILABLE else "ortools (unavailable)"],
    }


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
    if req.method == "ortools" and not ORTOOLS_AVAILABLE:
        raise HTTPException(400, "OR-Tools is not installed on this server. Use method=two_opt instead.")

    log.info("Optimizing %d outlets → %d days, method=%s", len(req.outlets), req.n_days, req.method)

    clusters = cluster_compact(req.outlets, req.n_days, req.min_outlets, req.max_outlets)

    days = []
    for i, cluster in enumerate(clusters):
        if not cluster:
            days.append(DayResult(day=i+1, stops=[], method=req.method))
            continue
        ordered = sequence_outlets(cluster, req.warehouse, req.method)
        days.append(DayResult(
            day=i+1,
            method=req.method,
            stops=[
                StopOut(id=o.id, sequence=s+1, name=o.name, lat=o.lat, lon=o.lon)
                for s, o in enumerate(ordered)
            ]
        ))
        log.info("Day %d: %d stops", i+1, len(ordered))

    return RouteResponse(days=days, method=req.method)


@app.post("/reoptimize", response_model=RouteResponse)
def reoptimize(req: ReoptimizeRequest):
    if not req.days:
        raise HTTPException(400, "No days provided")
    if req.method == "ortools" and not ORTOOLS_AVAILABLE:
        raise HTTPException(400, "OR-Tools is not installed. Use method=two_opt instead.")

    days = []
    for d in req.days:
        if not d.outlets:
            days.append(DayResult(day=d.day, stops=[], method=req.method))
            continue
        ordered = sequence_outlets(d.outlets, req.warehouse, req.method)
        days.append(DayResult(
            day=d.day,
            method=req.method,
            stops=[
                StopOut(id=o.id, sequence=s+1, name=o.name, lat=o.lat, lon=o.lon)
                for s, o in enumerate(ordered)
            ]
        ))

    return RouteResponse(days=days, method=req.method)
