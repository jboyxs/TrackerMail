import base64
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials, HTTPAuthorizationCredentials, HTTPBearer

from database import create_track, create_user, delete_track, disable_user, find_user_by_token, get_track, initialize_database, list_tracks, list_users, record_open, reset_user_token
from models import TrackCreate, TrackRead, UserCreate, UserCreated, UserRead

TRANSPARENT_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8E1WQAAAABJRU5ErkJggg==")
NO_CACHE_HEADERS = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "jjboy")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
basic_security = HTTPBasic(auto_error=False)
bearer_security = HTTPBearer(auto_error=False)

@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield

app = FastAPI(title="Thunderbird Mail Tracker MVP", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

def require_admin(credentials: HTTPBasicCredentials | None = Depends(basic_security)) -> str:
    if not ADMIN_PASSWORD or not credentials or not secrets.compare_digest(credentials.username, ADMIN_USERNAME) or not secrets.compare_digest(credentials.password, ADMIN_PASSWORD):
        raise HTTPException(status_code=401, detail="Invalid admin credentials", headers={"WWW-Authenticate": "Basic"})
    return credentials.username

def require_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_security)) -> dict:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Bearer token required")
    user = find_user_by_token(credentials.credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or disabled API token")
    return user

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

@app.get("/admin", include_in_schema=False)
async def admin_page() -> FileResponse:
    return FileResponse("admin.html")

@app.post("/api/admin/users", response_model=UserCreated, status_code=status.HTTP_201_CREATED)
async def admin_create_user(payload: UserCreate, _: str = Depends(require_admin)) -> dict:
    try:
        user, token = create_user(payload.username)
    except Exception as error:
        if "UNIQUE" in str(error).upper():
            raise HTTPException(status_code=409, detail="Username already exists") from error
        raise
    return {**user, "disabled": bool(user["disabled"]), "token": token}

@app.get("/api/admin/users", response_model=list[UserRead])
async def admin_list_users(_: str = Depends(require_admin)) -> list[dict]:
    return [{**user, "disabled": bool(user["disabled"])} for user in list_users()]

@app.delete("/api/admin/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_disable_user(user_id: int, _: str = Depends(require_admin)) -> Response:
    if not disable_user(user_id):
        raise HTTPException(status_code=404, detail="Active user not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@app.post("/api/admin/users/{user_id}/reset-token", response_model=UserCreated)
async def admin_reset_token(user_id: int, _: str = Depends(require_admin)) -> dict:
    result = reset_user_token(user_id)
    if result is None:
        raise HTTPException(status_code=404, detail="User not found")
    user, token = result
    return {**user, "disabled": bool(user["disabled"]), "token": token}

@app.post("/api/tracks", response_model=TrackRead, status_code=status.HTTP_201_CREATED)
async def post_track(track: TrackCreate, user: dict = Depends(require_user)) -> dict:
    try:
        return create_track(track, user["id"])
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error

@app.get("/api/tracks/{tracking_id}", response_model=TrackRead)
async def get_one_track(tracking_id: str, user: dict = Depends(require_user)) -> dict:
    track = get_track(tracking_id, user["id"])
    if track is None:
        raise HTTPException(status_code=404, detail="Tracking record not found")
    return track

@app.get("/api/tracks", response_model=list[TrackRead])
async def get_all_tracks(user: dict = Depends(require_user)) -> list[dict]:
    return list_tracks(user["id"])

@app.delete("/api/tracks/{tracking_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_one_track(tracking_id: str, user: dict = Depends(require_user)) -> Response:
    if not delete_track(tracking_id, user["id"]):
        raise HTTPException(status_code=404, detail="Tracking record not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@app.get("/open/{tracking_id}.png", include_in_schema=False)
async def open_pixel(tracking_id: str) -> Response:
    record_open(tracking_id)
    return Response(content=TRANSPARENT_PNG, media_type="image/png", headers=NO_CACHE_HEADERS)
