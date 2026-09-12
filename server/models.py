from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TrackCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    tracking_id: str = Field(min_length=1, max_length=128)
    recipient: str = Field(min_length=1, max_length=512)
    subject: str = Field(default="(No subject)", max_length=998)
    sent_at: datetime


class TrackRead(TrackCreate):
    owner_id: int | None = None
    first_opened_at: datetime | None = None
    last_opened_at: datetime | None = None
    open_count: int = 0

    @property
    def opened(self) -> bool:
        return self.open_count > 0


class UserCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    username: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.@-]+$")


class UserRead(BaseModel):
    id: int
    username: str
    created_at: datetime
    disabled: bool


class UserCreated(UserRead):
    token: str
