from pydantic import BaseModel, EmailStr
from typing import Optional
from models import PlanDuration
from datetime import datetime


class UserBase(BaseModel):
    username: str
    role: str


class UserCreate(UserBase):
    password: str
    email: EmailStr
    wallet_address: str  # Added as required for registration


class UserLogin(BaseModel):
    username: str
    password: str
    email: EmailStr


class Token(BaseModel):
    access_token: str
    token_type: str
    role: str


class DataUsageRequest(BaseModel):
    usage_mb: float


class WalletUpdate(BaseModel):
    wallet_address: Optional[str] = None


class UserSchema(UserBase):
    id: int
    is_active: bool
    wallet_address: Optional[str] = None
    email: str

    class Config:
        from_attributes = True


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
    duration: str
    price_kes: float
    data_mb: int


class PlanPurchase(BaseModel):
    plan_id: int
    user_address: str
    price_kes: float
    price_eth: float

    class Config:
        from_attributes = True


class PendingRegistrationCreate(BaseModel):
    username: str
    password: str
    email: EmailStr
    wallet_address: str
    role: str = "user"


class PendingRegistrationRequest(BaseModel):
    wallet_address: str


class PendingRegistrationResponse(BaseModel):
    id: int
    username: str
    email: str
    wallet_address: str
    created_at: datetime

    class Config:
        from_attributes = True


class ConfirmRegistrationRequest(BaseModel):
    pending_id: int


class OTPVerificationRequest(BaseModel):
    otp: str


class HelpRequestCreate(BaseModel):
    subject: str
    message: str


class HelpRequestResponse(BaseModel):
    id: int
    subject: str
    message: str
    created_at: datetime

    class Config:
        from_attributes = True


class FeedbackRequestCreate(BaseModel):
    feedback: str


class FeedbackRequestResponse(BaseModel):
    id: int
    feedback: str
    created_at: datetime

    class Config:
        from_attributes = True

class TransactionResponse(BaseModel):
    username: str
    user_address: str
    plan_name: str
    amount_kes: float
    amount_eth: float
    timestamp: str
    status: str     