from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    role = Column(String)  # "user" or "wifi_provider"
    is_active = Column(Boolean, default=True)
    wallet_address = Column(String, nullable=True)

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