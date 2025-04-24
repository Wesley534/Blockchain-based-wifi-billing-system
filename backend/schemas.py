from pydantic import BaseModel
from typing import Optional
from models import PlanDuration
from datetime import datetime


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
    usage_mb: float  # Changed to float to match simulation


class WalletUpdate(BaseModel):
    wallet_address: Optional[str] = None


class UserSchema(UserBase):
    id: int
    is_active: bool
    wallet_address: Optional[str] = None

    class Config:
        from_attributes = True  # Enables compatibility with SQLAlchemy models


class WifiPlanBase(BaseModel):
    name: str
    duration: PlanDuration
    price_kes: float
    data_mb: int


class WifiPlanCreate(WifiPlanBase):
    pass


class WifiPlanUpdate(WifiPlanBase):
    name: Optional[str] = None
    duration: Optional[PlanDuration] = None
    price_kes: Optional[float] = None
    data_mb: Optional[int] = None


class WifiPlan(WifiPlanBase):
    id: int
    isp_id: int

    class Config:
        from_attributes = True


class WiFiPlan(BaseModel):
    id: int
    name: str
    duration: str  # Matches frontend expectation (e.g., "DAILY")
    price_kes: float
    data_mb: int


class PlanPurchase(BaseModel):
    plan_id: int


class PendingRegistrationRequest(BaseModel):
    wallet_address: str


class PendingRegistrationResponse(BaseModel):
    id: int
    username: str
    wallet_address: str
    created_at: datetime

    class Config:
        from_attributes = True


class ConfirmRegistrationRequest(BaseModel):
    pending_id: int