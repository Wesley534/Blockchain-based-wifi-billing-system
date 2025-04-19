from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import Base, engine, get_db, SessionLocal
from models import User, DataUsage, WifiPlan as WifiPlanModel, PlanDuration
from schemas import (
    UserCreate, UserLogin, Token, DataUsageRequest, WalletUpdate, UserSchema,
    WifiPlan, WifiPlanCreate, WifiPlanUpdate
)
from auth import get_password_hash, authenticate_user, create_access_token, get_current_user
import time
import random
import threading
import requests
from datetime import datetime
from typing import Dict
from fastapi.security import OAuth2PasswordBearer
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Explicitly allow frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create the database tables
Base.metadata.create_all(bind=engine)

# In-memory store for active user sessions (username: JWT token)
active_users: Dict[str, str] = {}
active_users_lock = threading.Lock()

# OAuth2 scheme for token validation
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# Function to get all users with role "user" from the database
def get_all_users(db: Session):
    return db.query(User).filter(User.role == "user").all()

# Function to simulate data usage for currently logged-in users
def simulate_data_usage():
    while True:
        with active_users_lock:
            if not active_users:
                logger.info("No active users for simulation.")
                time.sleep(10)
                continue
            # Create a copy to avoid modifying the dictionary during iteration
            users_to_simulate = active_users.copy()
        
        for username, token in users_to_simulate.items():
            usage_mb = random.randint(1, 100)
            headers = {"Authorization": f"Bearer {token}"}
            try:
                response = requests.post(
                    "http://127.0.0.1:8000/data-usage",
                    json={"usage_mb": usage_mb},
                    headers=headers,
                )
                if response.status_code == 200:
                    logger.info(f"Simulated {usage_mb} MB usage for {username}: {response.json()}")
                else:
                    logger.error(f"Failed to simulate usage for {username}: {response.json()}")
                    # Remove user if token is invalid (e.g., expired)
                    if response.status_code == 401:
                        with active_users_lock:
                            active_users.pop(username, None)
            except Exception as e:
                logger.error(f"Error simulating usage for {username}: {e}")
        time.sleep(10)  # Simulate usage every 10 seconds for all active users

# Start the simulation and seed users when the app starts
@app.on_event("startup")
async def startup_event():
    db = SessionLocal()
    try:
        seed_users(db)
    finally:
        db.close()
    simulation_thread = threading.Thread(target=simulate_data_usage, daemon=True)
    simulation_thread.start()
    logger.info("Started data usage simulation for active users in the background.")

# Seed the database with sample users
def seed_users(db: Session):
    users_to_seed = [
        {"username": "user1", "password": "pass123", "role": "user"},
        {"username": "user2", "password": "pass123", "role": "user"},
        {"username": "isp1", "password": "isp_pass", "role": "wifi_provider"},
    ]
    for user_data in users_to_seed:
        if not db.query(User).filter(User.username == user_data["username"]).first():
            hashed_password = get_password_hash(user_data["password"])
            db_user = User(
                username=user_data["username"],
                hashed_password=hashed_password,
                role=user_data["role"]
            )
            db.add(db_user)
    db.commit()
    logger.info("Seeded database with sample users.")

@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    """Register a new user or WiFi provider."""
    try:
        db_user = db.query(User).filter(User.username == user.username).first()
        if db_user:
            raise HTTPException(status_code=400, detail="Username already registered")
        hashed_password = get_password_hash(user.password)
        db_user = User(
            username=user.username,
            hashed_password=hashed_password,
            role=user.role
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)

        access_token = create_access_token(data={"sub": user.username})
        logger.info(f"Registered user: {user.username}")
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "role": db_user.role
        }
    except Exception as e:
        logger.error(f"Error in register: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    """Log in a user or WiFi provider, return a JWT token, and track active session."""
    try:
        db_user = authenticate_user(db, user.username, user.password)
        if not db_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        access_token = create_access_token(data={"sub": user.username})
        # Store the user's token in active_users
        with active_users_lock:
            active_users[user.username] = access_token
        logger.info(f"User {user.username} logged in and added to active users.")
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "role": db_user.role
        }
    except Exception as e:
        logger.error(f"Error in login: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    """Log out the current user and remove them from active sessions."""
    try:
        with active_users_lock:
            active_users.pop(current_user.username, None)
        logger.info(f"User {current_user.username} logged out and removed from active users.")
        return {"message": "Logged out successfully"}
    except Exception as e:
        logger.error(f"Error in logout: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# Define helper functions to create role-specific dependencies
def get_user(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "user":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have the required role: user",
        )
    return current_user

def get_isp(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "wifi_provider":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have the required role: wifi_provider",
        )
    return current_user

@app.get("/user/dashboard", response_model=dict)
def user_dashboard(current_user: User = Depends(get_user)):
    """Protected endpoint for the user dashboard."""
    return {"message": f"Welcome to the User Dashboard, {current_user.username}!"}

@app.get("/isp/dashboard", response_model=dict)
def isp_dashboard(current_user: User = Depends(get_isp)):
    """Protected endpoint for the ISP (WiFi provider) dashboard."""
    return {"message": f"Welcome to the ISP Dashboard, {current_user.username}!"}

@app.post("/data-usage")
def log_data_usage(data: DataUsageRequest, current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    """Log data usage in the database for the authenticated user."""
    try:
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        data_usage = DataUsage(user_id=current_user.id, usage_mb=data.usage_mb, timestamp=timestamp)
        db.add(data_usage)
        db.commit()
        logger.info(f"Logged {data.usage_mb} MB usage for user {current_user.username}")
        return {"message": "Data usage logged successfully"}
    except Exception as e:
        logger.error(f"Error in log_data_usage: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/data-usage")
def get_data_usage(current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    """Retrieve data usage history for the authenticated user from the database."""
    try:
        usage = db.query(DataUsage).filter(DataUsage.user_id == current_user.id).all()
        return [{"usage_mb": u.usage_mb, "timestamp": u.timestamp} for u in usage]
    except Exception as e:
        logger.error(f"Error in get_data_usage: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/update-wallet")
def update_wallet(wallet_data: WalletUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update the wallet address for the authenticated user."""
    try:
        db_user = db.query(User).filter(User.id == current_user.id).first()
        if not db_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        db_user.wallet_address = wallet_data.wallet_address
        db.commit()
        db.refresh(db_user)
        logger.info(f"Updated wallet address for user {current_user.username}")
        return {"message": "Wallet address updated successfully"}
    except Exception as e:
        logger.error(f"Error in update_wallet: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/users", response_model=list[UserSchema])
def get_all_users_endpoint(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    """Retrieve all users with role 'user' (ISP only)."""
    try:
        users = get_all_users(db)
        return users
    except Exception as e:
        logger.error(f"Error in get_all_users_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/users", response_model=list[UserSchema])
def get_all_isp_users_endpoint(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    """Retrieve all users with role 'user' for ISP dashboard (ISP only)."""
    try:
        users = get_all_users(db)
        return users
    except Exception as e:
        logger.error(f"Error in get_all_isp_users_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# ISP-specific endpoints
@app.get("/isp/data-usage")
def get_total_data_usage(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    """Retrieve aggregated data usage history for all users (ISP only)."""
    try:
        all_usage = db.query(DataUsage).all()
        usage_by_time = {}
        for entry in all_usage:
            timestamp = entry.timestamp[:19]
            if timestamp not in usage_by_time:
                usage_by_time[timestamp] = 0
            usage_by_time[timestamp] += entry.usage_mb
        total_usage = [
            {"timestamp": timestamp, "total_usage_mb": usage_mb}
            for timestamp, usage_mb in usage_by_time.items()
        ]
        return sorted(total_usage, key=lambda x: x["timestamp"])
    except Exception as e:
        logger.error(f"Error in get_total_data_usage: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/isp/log-data-usage")
def isp_log_data_usage(
    data: dict,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
    """Log data usage for a specific user (ISP only)."""
    try:
        username = data.get("username")
        usage_mb = data.get("usage_mb")
        if not username or not isinstance(usage_mb, (int, float)) or usage_mb <= 0:
            raise HTTPException(status_code=400, detail="Invalid username or usage_mb")
        target_user = db.query(User).filter(User.username == username, User.role == "user").first()
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        data_usage = DataUsage(user_id=target_user.id, usage_mb=usage_mb, timestamp=timestamp)
        db.add(data_usage)
        db.commit()
        logger.info(f"Logged {usage_mb} MB usage for {username} by ISP")
        return {"message": f"Data usage of {usage_mb} MB logged successfully for {username}"}
    except Exception as e:
        logger.error(f"Error in isp_log_data_usage: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# WiFi Plan endpoints
@app.get("/isp/wifi-plans", response_model=list[WifiPlan])
def get_wifi_plans(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    """Retrieve all WiFi plans created by the ISP."""
    try:
        plans = db.query(WifiPlanModel).filter(WifiPlanModel.isp_id == current_user.id).all()
        return plans
    except Exception as e:
        logger.error(f"Error in get_wifi_plans: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/isp/wifi-plans", response_model=WifiPlan)
def create_wifi_plan(
    plan: WifiPlanCreate,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
    """Create a new WiFi plan (ISP only)."""
    try:
        if plan.price_kes <= 0:
            raise HTTPException(status_code=400, detail="Price must be positive")
        if plan.data_mb <= 0:
            raise HTTPException(status_code=400, detail="Data must be positive")
        db_plan = WifiPlanModel(
            name=plan.name,
            duration=plan.duration,
            price_kes=plan.price_kes,
            data_mb=plan.data_mb,
            isp_id=current_user.id,
        )
        db.add(db_plan)
        db.commit()
        db.refresh(db_plan)
        logger.info(f"Created WiFi plan: {plan.name} by ISP {current_user.username}")
        return db_plan
    except Exception as e:
        logger.error(f"Error in create_wifi_plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.put("/isp/wifi-plans/{plan_id}", response_model=WifiPlan)
def update_wifi_plan(
    plan_id: int,
    plan: WifiPlanUpdate,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db),
):
    """Update an existing WiFi plan (ISP only)."""
    try:
        db_plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == plan_id, WifiPlanModel.isp_id == current_user.id).first()
        if not db_plan:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WiFi plan not found")
        update_data = plan.dict(exclude_unset=True)
        if "price_kes" in update_data and update_data["price_kes"] <= 0:
            raise HTTPException(status_code=400, detail="Price must be positive")
        if "data_mb" in update_data and update_data["data_mb"] <= 0:
            raise HTTPException(status_code=400, detail="Data must be positive")
        for key, value in update_data.items():
            setattr(db_plan, key, value)
        db.commit()
        db.refresh(db_plan)
        logger.info(f"Updated WiFi plan ID {plan_id} by ISP {current_user.username}")
        return db_plan
    except Exception as e:
        logger.error(f"Error in update_wifi_plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.delete("/isp/wifi-plans/{plan_id}")
def delete_wifi_plan(
    plan_id: int,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
    """Delete a WiFi plan (ISP only)."""
    try:
        db_plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == plan_id, WifiPlanModel.isp_id == current_user.id).first()
        if not db_plan:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WiFi plan not found")
        db.delete(db_plan)
        db.commit()
        logger.info(f"Deleted WiFi plan ID {plan_id} by ISP {current_user.username}")
        return {"message": "WiFi plan deleted successfully"}
    except Exception as e:
        logger.error(f"Error in delete_wifi_plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")