from pydantic import BaseModel

class UserCreate(BaseModel):
    username: str
    password: str
    role: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class DataUsageRequest(BaseModel):
    usage_mb: int

class WalletUpdate(BaseModel):
    wallet_address: str