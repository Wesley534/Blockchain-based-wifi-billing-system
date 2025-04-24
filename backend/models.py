from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Float, Enum, DateTime
from sqlalchemy.orm import relationship
from database import Base
import enum
from datetime import datetime


class PlanDuration(str, enum.Enum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String)  # "user" or "wifi_provider"
    is_active = Column(Boolean, default=True)
    wallet_address = Column(String, unique=True, nullable=True)  # Unique wallet address, nullable

    # Relationships
    data_usage = relationship("DataUsage", back_populates="user", cascade="all, delete-orphan")
    purchased_plans = relationship("UserPlanPurchase", back_populates="user", cascade="all, delete-orphan")
    pending_registrations = relationship("PendingRegistration", back_populates="user", cascade="all, delete-orphan")


class DataUsage(Base):
    __tablename__ = "data_usage"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    usage_mb = Column(Float)  # Changed to Float to match simulation
    timestamp = Column(String)  # When the usage was recorded

    # Relationship
    user = relationship("User", back_populates="data_usage")


class WifiPlan(Base):
    __tablename__ = "wifi_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    duration = Column(Enum(PlanDuration), nullable=False)
    price_kes = Column(Float, nullable=False)
    data_mb = Column(Integer, nullable=False)
    isp_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)  # Links to ISP user

    # Relationship
    isp = relationship("User")
    purchases = relationship("UserPlanPurchase", back_populates="plan", cascade="all, delete-orphan")


class UserPlanPurchase(Base):
    __tablename__ = "user_plan_purchases"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    plan_id = Column(Integer, ForeignKey("wifi_plans.id", ondelete="CASCADE"), index=True)
    purchase_date = Column(DateTime, nullable=False)

    # Relationships
    user = relationship("User", back_populates="purchased_plans")
    plan = relationship("WifiPlan", back_populates="purchases")


class PendingRegistration(Base):
    __tablename__ = "pending_registrations"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    wallet_address = Column(String, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationship
    user = relationship("User", back_populates="pending_registrations")