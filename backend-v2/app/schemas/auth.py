from pydantic import BaseModel


class UserResponse(BaseModel):
    login: str
    name: str | None
    avatar_url: str | None
