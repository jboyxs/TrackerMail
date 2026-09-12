import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from models import TrackCreate

DATABASE_PATH = Path(os.getenv("DATABASE_PATH", Path(__file__).parent / "data" / "tracker.db"))

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def serialize_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def device_fingerprint(ip: str, user_agent: str) -> str:
    salt = os.getenv("FINGERPRINT_SALT", "development-only-change-this")
    return hmac.new(salt.encode(), f"{ip}|{user_agent}".encode(), hashlib.sha256).hexdigest()

@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        yield connection
        connection.commit()
    finally:
        connection.close()

def initialize_database() -> None:
    with connect() as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0)")
        connection.execute("CREATE TABLE IF NOT EXISTS tracks (tracking_id TEXT PRIMARY KEY, owner_id INTEGER, recipient TEXT NOT NULL, subject TEXT NOT NULL, sent_at TEXT NOT NULL, first_opened_at TEXT, last_opened_at TEXT, open_count INTEGER NOT NULL DEFAULT 0 CHECK (open_count >= 0), last_ip TEXT, last_user_agent TEXT, last_device_fingerprint TEXT, last_geo_country TEXT, FOREIGN KEY(owner_id) REFERENCES users(id))")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(tracks)")}
        if "owner_id" not in columns:
            connection.execute("ALTER TABLE tracks ADD COLUMN owner_id INTEGER")
        for column in ("last_ip", "last_user_agent", "last_device_fingerprint", "last_geo_country", "last_geo_region", "last_geo_city"):
            if column not in columns:
                connection.execute(f"ALTER TABLE tracks ADD COLUMN {column} TEXT")

def create_user(username: str) -> tuple[dict, str]:
    token = "mt_" + secrets.token_urlsafe(32)
    with connect() as connection:
        cursor = connection.execute("INSERT INTO users (username, token_hash, created_at) VALUES (?, ?, ?)", (username, hash_token(token), utc_now_iso()))
        connection.execute("UPDATE tracks SET owner_id = ? WHERE owner_id IS NULL", (cursor.lastrowid,))
        row = connection.execute("SELECT id, username, created_at, disabled FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row), token

def reset_user_token(user_id: int) -> tuple[dict, str] | None:
    token = "mt_" + secrets.token_urlsafe(32)
    with connect() as connection:
        cursor = connection.execute("UPDATE users SET token_hash = ? WHERE id = ?", (hash_token(token), user_id))
        if cursor.rowcount == 0:
            return None
        row = connection.execute("SELECT id, username, created_at, disabled FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row), token

def list_users() -> list[dict]:
    with connect() as connection:
        return [dict(row) for row in connection.execute("SELECT id, username, created_at, disabled FROM users ORDER BY created_at").fetchall()]

def disable_user(user_id: int) -> bool:
    with connect() as connection:
        cursor = connection.execute("UPDATE users SET disabled = 1 WHERE id = ? AND disabled = 0", (user_id,))
    return cursor.rowcount > 0

def find_user_by_token(token: str) -> dict | None:
    with connect() as connection:
        row = connection.execute("SELECT id, username, created_at, disabled FROM users WHERE token_hash = ? AND disabled = 0", (hash_token(token),)).fetchone()
    return dict(row) if row else None

def create_track(track: TrackCreate, owner_id: int) -> dict:
    with connect() as connection:
        connection.execute("INSERT INTO tracks (tracking_id, owner_id, recipient, subject, sent_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tracking_id) DO NOTHING", (track.tracking_id, owner_id, track.recipient, track.subject, serialize_datetime(track.sent_at)))
        row = connection.execute("SELECT * FROM tracks WHERE tracking_id = ? AND owner_id = ?", (track.tracking_id, owner_id)).fetchone()
    if row is None:
        raise ValueError("tracking_id already belongs to another user")
    return dict(row)

def get_track(tracking_id: str, owner_id: int) -> dict | None:
    with connect() as connection:
        row = connection.execute("SELECT * FROM tracks WHERE tracking_id = ? AND owner_id = ?", (tracking_id, owner_id)).fetchone()
    return dict(row) if row else None

def delete_track(tracking_id: str, owner_id: int) -> bool:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM tracks WHERE tracking_id = ? AND owner_id = ?", (tracking_id, owner_id))
    return cursor.rowcount > 0

def list_tracks(owner_id: int) -> list[dict]:
    with connect() as connection:
        return [dict(row) for row in connection.execute("SELECT * FROM tracks WHERE owner_id = ? ORDER BY sent_at DESC", (owner_id,)).fetchall()]

def record_open(tracking_id: str, ip: str, user_agent: str, geo_country: str | None, geo_region: str | None, geo_city: str | None) -> dict | None:
    opened_at = utc_now_iso()
    fingerprint = device_fingerprint(ip, user_agent)
    with connect() as connection:
        cursor = connection.execute("UPDATE tracks SET first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ?, open_count = open_count + 1, last_ip = ?, last_user_agent = ?, last_device_fingerprint = ?, last_geo_country = ?, last_geo_region = ?, last_geo_city = ? WHERE tracking_id = ?", (opened_at, opened_at, ip, user_agent, fingerprint, geo_country, geo_region, geo_city, tracking_id))
        if cursor.rowcount == 0:
            return None
        return dict(connection.execute("SELECT * FROM tracks WHERE tracking_id = ?", (tracking_id,)).fetchone())
