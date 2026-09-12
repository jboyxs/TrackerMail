import os
from pathlib import Path

try:
    import geoip2.database
except ImportError:  # optional until a GeoLite2 database is mounted
    geoip2 = None

DB_PATH = Path(os.getenv("GEOIP_DATABASE_PATH", "/data/GeoLite2-City.mmdb"))

def lookup(ip: str) -> tuple[str | None, str | None, str | None]:
    if geoip2 is None or not DB_PATH.exists() or ip in {"unknown", "127.0.0.1", "::1"}:
        return None, None, None
    try:
        with geoip2.database.Reader(str(DB_PATH)) as reader:
            city = reader.city(ip)
        return city.country.iso_code, city.subdivisions.most_specific.name, city.city.name
    except Exception:
        return None, None, None
