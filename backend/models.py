from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Float, Enum
from sqlalchemy.orm import relationship
from database import Base
import enum


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String)  # "user" or "wifi_provider"
    is_active = Column(Boolean, default=True)
    wallet_address = Column(String, unique=True, nullable=True)  # Added unique=True


    # Optional: Add relationship to DataUsage
    data_usage = relationship("DataUsage", back_populates="user")

class DataUsage(Base):
    __tablename__ = "data_usage"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    usage_mb = Column(Integer)  # Usage in MB
    timestamp = Column(String)  # When the usage was recorded

    # Optional: Add relationship to User
    user = relationship("User", back_populates="data_usage")

class PlanDuration(str, enum.Enum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"

class WifiPlan(Base):
    __tablename__ = "wifi_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    duration = Column(Enum(PlanDuration), nullable=False)
    price_kes = Column(Float, nullable=False)
    data_mb = Column(Integer, nullable=False)
    isp_id = Column(Integer, nullable=False)  # Links to the ISP user