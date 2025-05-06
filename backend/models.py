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
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="user", nullable=False)  # "user" or "wifi_provider"
    is_active = Column(Boolean, default=True)
    wallet_address = Column(String, unique=True, nullable=True)
    email = Column(String, unique=True, nullable=False)
    status = Column(String, nullable=False, default="pending")  # New column for status (pending, active, rejected)

    # Relationships
    data_usage = relationship("DataUsage", back_populates="user", cascade="all, delete-orphan")
    purchased_plans = relationship("UserPlanPurchase", back_populates="user", cascade="all, delete-orphan")
    feedback_requests = relationship("FeedbackRequest", back_populates="user", cascade="all, delete-orphan")


class DataUsage(Base):
    __tablename__ = "data_usage"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    usage_mb = Column(Float)
    timestamp = Column(String)

    user = relationship("User", back_populates="data_usage")


class WifiPlan(Base):
    __tablename__ = "wifi_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    duration = Column(Enum(PlanDuration), nullable=False)
    price_kes = Column(Float, nullable=False)
    data_mb = Column(Integer, nullable=False)
    isp_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    isp = relationship("User")
    purchases = relationship("UserPlanPurchase", back_populates="plan", cascade="all, delete-orphan")


class UserPlanPurchase(Base):
    __tablename__ = "user_plan_purchases"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    plan_id = Column(Integer, ForeignKey("wifi_plans.id", ondelete="CASCADE"), index=True)
    user_address = Column(String, nullable=False)
    price_kes = Column(Float, nullable=False)
    price_eth = Column(Float, nullable=False)
    purchase_date = Column(DateTime, nullable=False)
    user = relationship("User", back_populates="purchased_plans")
    plan = relationship("WifiPlan", back_populates="purchases")


class PendingRegistration(Base):
    __tablename__ = "pending_registrations"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    wallet_address = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class HelpRequest(Base):
    __tablename__ = "help_requests"

    id = Column(Integer, primary_key=True, index=True)
    subject = Column(String, nullable=False)
    message = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class FeedbackRequest(Base):
    __tablename__ = "feedback_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)  # New column
    feedback = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    reply = Column(String, nullable=True)
    replied_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="feedback_requests")  # New relationship