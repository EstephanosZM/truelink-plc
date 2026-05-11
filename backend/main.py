"""
TRUE LINK PLC — Route Optimizer API
=====================================
POST /optimize     — cluster outlets into N days, order via OSRM
POST /reoptimize   — re-order two affected days after a move
"""

import os
import math
import logging
from typing import List

import requests
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

OSRM_BASE        = os.environ.get("OSRM_BASE", "http://router.project-osrm.org")
OSRM_MAX_WP      = 100
OSRM_TIMEOUT     = 30

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("truelink-api")

app = FastAPI(title="True Link PLC Route API", version="1.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Models ────────────────────────────────────────────────────────────────────

class OutletIn(BaseModel):
    id: str
    lat: float
    lon: float
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

# ── OSRM ─────────────────────────────────────────────────────────────────────

def osrm_trip(waypoints: List[dict], warehouse: WarehouseIn) -> List[int]:
    all_pts = [{"lat": warehouse.lat, "lon": warehouse.lon}] \
            + waypoints \
            + [{"lat": warehouse.lat, "lon": warehouse.lon}]
    coords  = ";".join(f"{p['lon']},{p['lat']}" for p in all_pts)
    n       = len(waypoints)
    url     = (f"{OSRM_BASE}/trip/v1/driving/{coords}"
               f"?roundtrip=false&source=first&destination=last&annotations=false")
    try:
        r = requests.get(url, timeout=OSRM_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok":
            return list(range(n))
        wps = data.get("waypoints", [])
        ordered = sorted(wps, key=lambda w: w["waypoint_index"])
        result  = []
        for wp in ordered:
            idx = wp.get("waypoint_index", -1)
            if 1 <= idx <= n:
                result.append(idx - 1)
        return result if len(result) == n else list(range(n))
    except Exception as e:
        log.error("OSRM error: %s", e)
        return list(range(n))


def chunk_and_order(outlets: List[OutletIn], warehouse: WarehouseIn) -> List[OutletIn]:
    if not outlets:
        return []
    if len(outlets) <= OSRM_MAX_WP:
        wps   = [{"lat": o.lat, "lon": o.lon} for o in outlets]
        order = osrm_trip(wps, warehouse)
        return [outlets[i] for i in order if i < len(outlets)]

    n_chunks = math.ceil(len(outlets) / OSRM_MAX_WP)
    coords   = np.array([[o.lat, o.lon] for o in outlets])
    sc       = StandardScaler()
    km       = KMeans(n_clusters=n_chunks, random_state=42, n_init=10)
    labels   = km.fit_predict(sc.fit_transform(coords))
    cents    = sc.inverse_transform(km.cluster_centers_)
    wh       = np.array([warehouse.lat, warehouse.lon])
    order    = sorted(range(n_chunks), key=lambda i: np.linalg.norm(cents[i] - wh))

    result = []
    for ci in order:
        chunk = [o for o, l in zip(outlets, labels) if l == ci]
        wps   = [{"lat": o.lat, "lon": o.lon} for o in chunk]
        idx   = osrm_trip(wps, warehouse)
        result.extend([chunk[i] for i in idx if i < len(chunk)])
    return result

# ── Clustering ────────────────────────────────────────────────────────────────

def cluster_outlets(outlets, n_days, min_outlets, max_outlets):
    if not outlets:
        return [[] for _ in range(n_days)]
    eff  = min(n_days, len(outlets))
    arr  = np.array([[o.lat, o.lon] for o in outlets])
    sc   = StandardScaler()
    km   = KMeans(n_clusters=eff, random_state=42, n_init=10)
    labs = km.fit_predict(sc.fit_transform(arr))
    clusters = [[] for _ in range(eff)]
    for o, l in zip(outlets, labs):
        clusters[l].append(o)
    while len(clusters) < n_days:
        clusters.append([])

    # enforce max
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
    for i, cl in enumerate(clusters):
        ordered = chunk_and_order(cl, req.warehouse)
        days.append(DayResult(
            day=i + 1,
            stops=[StopOut(id=o.id, sequence=s+1, name=o.name, lat=o.lat, lon=o.lon)
                   for s, o in enumerate(ordered)]
        ))
    return RouteResponse(days=days)


@app.post("/reoptimize", response_model=RouteResponse)
def reoptimize(req: ReoptimizeRequest):
    if not req.days:
        raise HTTPException(400, "No days provided")
    days = []
    for d in req.days:
        ordered = chunk_and_order(d.outlets, req.warehouse)
        days.append(DayResult(
            day=d.day,
            stops=[StopOut(id=o.id, sequence=s+1, name=o.name, lat=o.lat, lon=o.lon)
                   for s, o in enumerate(ordered)]
        ))
    return RouteResponse(days=days)
