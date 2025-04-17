from pydantic import BaseModel
from typing import Optional

# Base class for User to define shared fields
class UserBase(BaseModel):
    username: str
    role: str

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str  # Matches the /login endpoint response

class DataUsageRequest(BaseModel):
    usage_mb: int

class WalletUpdate(BaseModel):
    wallet_address: Optional[str] = None

class UserSchema(UserBase):
    id: int
    is_active: bool
    wallet_address: Optional[str] = None

    class Config:
        from_attributes = True  # Enables compatibility with SQLAlchemy models