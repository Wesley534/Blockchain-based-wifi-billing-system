from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from typing import List, Dict
from database import Base, engine, get_db, SessionLocal
from models import User, DataUsage, WifiPlan as WifiPlanModel, PlanDuration, PendingRegistration
from schemas import (
    UserCreate, UserLogin, Token, DataUsageRequest, WalletUpdate, UserSchema,
    WifiPlan, WifiPlanCreate, WifiPlanUpdate, WiFiPlan, PlanPurchase,
    PendingRegistrationRequest, PendingRegistrationResponse, ConfirmRegistrationRequest
)
from auth import get_password_hash, authenticate_user, create_access_token, get_current_user
import time
import logging
import threading
import random
from datetime import datetime
from fastapi.security import OAuth2PasswordBearer

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://192.168.2.105:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create the database tables
try:
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created successfully")
except Exception as e:
    logger.error(f"Failed to create database tables: {str(e)}")
    raise

# In-memory store for active user sessions (username: JWT token)
active_users: Dict[str, str] = {}

# OAuth2 scheme for token validation
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# Function to get all users with role "user" from the database
def get_all_users(db: Session):
    return db.query(User).filter(User.role == "user").all()

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

# Simulate data usage for active users
def simulate_data_usage():
    """Simulate data usage for active users in the background."""
    logger.info("Started data usage simulation in the background.")
    while True:
        try:
            db = SessionLocal()
            try:
                if not active_users:
                    logger.info("No active users for simulation.")
                else:
                    for username in active_users.keys():
                        user = db.query(User).filter(User.username == username, User.role == "user").first()
                        if user:
                            usage_mb = random.uniform(0.1, 10.0)  # Simulate 0.1-10 MB
                            timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                            data_usage = DataUsage(user_id=user.id, usage_mb=usage_mb, timestamp=timestamp)
                            db.add(data_usage)
                            logger.info(f"Simulated {usage_mb:.2f} MB usage for {username}")
                    db.commit()
            except OperationalError as db_err:
                logger.error(f"Database error in simulation: {str(db_err)}")
                db.rollback()
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Error in simulation thread: {str(e)}")
        time.sleep(30)  # Run every 30 seconds

@app.on_event("startup")
async def startup_event():
    db = SessionLocal()
    try:
        seed_users(db)
    except Exception as e:
        logger.error(f"Error seeding users: {str(e)}")
        raise
    finally:
        db.close()
    # Start simulation in a separate thread
    simulation_thread = threading.Thread(target=simulate_data_usage, daemon=True)
    simulation_thread.start()
    logger.info("Data usage simulation started in the background.")

@app.post("/register", response_model=Token)
async def register(user: UserCreate, db: Session = Depends(get_db)):
    """Register a new user or WiFi provider."""
    try:
        logger.info(f"Register attempt for username: {user.username}")
        start_time = time.time()
        db_user = db.query(User).filter(User.username == user.username).first()
        if db_user:
            raise HTTPException(status_code=400, detail="Username already registered")
        db_pending = db.query(PendingRegistration).filter(PendingRegistration.username == user.username).first()
        if db_pending:
            raise HTTPException(status_code=400, detail="Username is pending registration")
        hashed_password = get_password_hash(user.password)
        db_user = User(
            username=user.username,
            hashed_password=hashed_password,
            role=user.role
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        access_token = create_access_token(data={"sub": user.username, "role": user.role})
        active_users[user.username] = access_token
        logger.info(f"Registered user: {user.username} in {time.time() - start_time:.2f} seconds")
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "role": db_user.role
        }
    except Exception as e:
        logger.error(f"Error in register: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/login", response_model=Token)
async def login(user: UserLogin, db: Session = Depends(get_db)):
    """Log in a user or WiFi provider, return a JWT token, and track active session."""
    try:
        start_time = time.time()
        logger.info(f"Login attempt for username: {user.username}")
        logger.debug(f"Starting authentication for: {user.username}")
        try:
            db_user = authenticate_user(db, user.username, user.password)
        except OperationalError as db_err:
            logger.error(f"Database error during authentication: {str(db_err)}")
            raise HTTPException(status_code=500, detail="Database error, please try again later")
        if not db_user:
            logger.warning(f"Authentication failed for username: {user.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        logger.debug(f"Creating access token for: {user.username}")
        access_token = create_access_token(data={"sub": user.username, "role": db_user.role})
        active_users[user.username] = access_token
        logger.info(f"User {user.username} logged in in {time.time() - start_time:.2f} seconds")
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "role": db_user.role
        }
    except Exception as e:
        logger.error(f"Error in login: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Log out the current user and remove them from active sessions."""
    try:
        active_users.pop(current_user.username, None)
        logger.info(f"User {current_user.username} logged out")
        return {"message": "Logged out successfully"}
    except Exception as e:
        logger.error(f"Error in logout: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

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

@app.post("/request-registration")
async def request_registration(
    request: PendingRegistrationRequest,
    current_user: User = Depends(get_user),
    db: Session = Depends(get_db)
):
    """Request registration with a wallet address, adding to pending_registrations."""
    try:
        logger.info(f"Registration request for user: {current_user.username}, wallet: {request.wallet_address}")
        
        # Validate wallet address format (basic check for Ethereum address)
        if not request.wallet_address or not request.wallet_address.startswith("0x") or len(request.wallet_address) != 42:
            raise HTTPException(status_code=400, detail="Invalid wallet address format")
        
        # Check if wallet address is already used in users or pending_registrations
        existing_user = db.query(User).filter(User.wallet_address == request.wallet_address).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Wallet address is already associated with another user")
        existing_pending = db.query(PendingRegistration).filter(
            PendingRegistration.wallet_address == request.wallet_address
        ).first()
        if existing_pending:
            raise HTTPException(status_code=400, detail="Wallet address is already pending registration")
        
        # Check if user already has a pending registration
        existing_request = db.query(PendingRegistration).filter(
            PendingRegistration.username == current_user.username
        ).first()
        if existing_request:
            raise HTTPException(status_code=400, detail="User already has a pending registration")
        
        # Create pending registration
        pending = PendingRegistration(
            username=current_user.username,
            wallet_address=request.wallet_address,
            user_id=current_user.id
        )
        db.add(pending)
        db.commit()
        db.refresh(pending)
        logger.info(f"Pending registration created for {current_user.username} with wallet {request.wallet_address}")
        return {"message": "Registration request submitted successfully"}
    except Exception as e:
        logger.error(f"Error in request_registration: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/pending-registrations", response_model=List[PendingRegistrationResponse])
async def get_pending_registrations(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    """Fetch all pending registrations for the ISP."""
    try:
        logger.info(f"Fetching pending registrations for ISP {current_user.username}")
        pending = db.query(PendingRegistration).all()
        return [
            {
                "id": p.id,
                "username": p.username,
                "wallet_address": p.wallet_address,
                "created_at": p.created_at
            } for p in pending
        ]
    except Exception as e:
        logger.error(f"Error in get_pending_registrations: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/isp/confirm-registration")
async def confirm_registration(
    request: ConfirmRegistrationRequest,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
    """Confirm a pending registration, update the user's wallet address, and remove from pending."""
    try:
        logger.info(f"Confirming registration for pending_id: {request.pending_id} by ISP {current_user.username}")
        pending = db.query(PendingRegistration).filter(PendingRegistration.id == request.pending_id).first()
        if not pending:
            raise HTTPException(status_code=404, detail="Pending registration not found")
        
        # Update user's wallet address
        db_user = db.query(User).filter(User.id == pending.user_id).first()
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check if wallet address is still unique
        existing_user = db.query(User).filter(
            User.wallet_address == pending.wallet_address,
            User.id != db_user.id
        ).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Wallet address is already associated with another user")
        
        db_user.wallet_address = pending.wallet_address
        db.delete(pending)
        db.commit()
        db.refresh(db_user)
        logger.info(f"Confirmed registration for {db_user.username}, wallet: {db_user.wallet_address}")
        return {"message": f"Registration confirmed for {db_user.username}"}
    except Exception as e:
        logger.error(f"Error in confirm_registration: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/user/dashboard", response_model=dict)
async def user_dashboard(current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    """User dashboard with registration status."""
    try:
        pending = db.query(PendingRegistration).filter(PendingRegistration.user_id == current_user.id).first()
        status = "registered" if current_user.wallet_address else ("pending" if pending else "not_registered")
        return {
            "message": f"Welcome to the User Dashboard, {current_user.username}!",
            "registration_status": status,
            "wallet_address": current_user.wallet_address
        }
    except Exception as e:
        logger.error(f"Error in user_dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/dashboard", response_model=dict)
async def isp_dashboard(current_user: User = Depends(get_isp)):
    return {"message": f"Welcome to the ISP Dashboard, {current_user.username}!"}

@app.post("/data-usage")
async def log_data_usage(data: DataUsageRequest, current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    try:
        if data.usage_mb <= 0:
            raise HTTPException(status_code=400, detail="Usage must be positive")
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        data_usage = DataUsage(user_id=current_user.id, usage_mb=data.usage_mb, timestamp=timestamp)
        db.add(data_usage)
        db.commit()
        logger.info(f"Logged {data.usage_mb} MB usage for user {current_user.username}")
        return {"message": "Data usage logged successfully"}
    except Exception as e:
        logger.error(f"Error in log_data_usage: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/data-usage", response_model=List[dict])
async def get_data_usage(current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    try:
        usage = db.query(DataUsage).filter(DataUsage.user_id == current_user.id).all()
        return [{"usage_mb": u.usage_mb, "timestamp": u.timestamp} for u in usage]
    except Exception as e:
        logger.error(f"Error in get_data_usage: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/update-wallet")
async def update_wallet(wallet_data: WalletUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        db_user = db.query(User).filter(User.id == current_user.id).first()
        if not db_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        
        # Check if wallet address is already used by another user or pending
        if wallet_data.wallet_address:
            existing_user = db.query(User).filter(
                User.wallet_address == wallet_data.wallet_address,
                User.id != current_user.id
            ).first()
            if existing_user:
                logger.warning(f"Wallet address {wallet_data.wallet_address} already associated with another user")
                raise HTTPException(status_code=400, detail="Wallet address is already associated with another user")
            existing_pending = db.query(PendingRegistration).filter(
                PendingRegistration.wallet_address == wallet_data.wallet_address
            ).first()
            if existing_pending:
                raise HTTPException(status_code=400, detail="Wallet address is already pending registration")

        db_user.wallet_address = wallet_data.wallet_address
        db.commit()
        db.refresh(db_user)
        logger.info(f"Updated wallet address for user {current_user.username} to {wallet_data.wallet_address}")
        return {"message": "Wallet address updated successfully"}
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error in update_wallet: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/users", response_model=List[UserSchema])
async def get_all_users_endpoint(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    try:
        users = get_all_users(db)
        return users
    except Exception as e:
        logger.error(f"Error in get_all_users_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/users", response_model=List[UserSchema])
async def get_all_isp_users_endpoint(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    try:
        users = get_all_users(db)
        return users
    except Exception as e:
        logger.error(f"Error in get_all_isp_users_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/data-usage", response_model=List[dict])
async def get_total_data_usage(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
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
async def isp_log_data_usage(
    data: dict,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
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

@app.get("/isp/wifi-plans", response_model=List[WifiPlan])
async def get_wifi_plans_isp(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    try:
        plans = db.query(WifiPlanModel).filter(WifiPlanModel.isp_id == current_user.id).all()
        return plans
    except Exception as e:
        logger.error(f"Error in get_wifi_plans_isp: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/isp/wifi-plans", response_model=WifiPlan)
async def create_wifi_plan(
    plan: WifiPlanCreate,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
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
async def update_wifi_plan(
    plan_id: int,
    plan: WifiPlanUpdate,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db),
):
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
async def delete_wifi_plan(
    plan_id: int,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
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

@app.get("/wifi-plans", response_model=List[WiFiPlan])
async def get_wifi_plans(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        logger.info(f"Fetching WiFi plans for user {current_user.username}")
        plans = db.query(WifiPlanModel).all()
        return [
            {
                "id": plan.id,
                "name": plan.name,
                "duration": plan.duration.value,  # Convert Enum to string
                "price_kes": plan.price_kes,
                "data_mb": plan.data_mb
            } for plan in plans
        ]
    except Exception as e:
        logger.error(f"Error in get_wifi_plans: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch WiFi plans: {str(e)}")

@app.post("/purchase-plan")
async def purchase_plan(purchase: PlanPurchase, db: Session = Depends(get_db), current_user: User = Depends(get_user)):
    try:
        logger.info(f"Recording plan purchase for user {current_user.username}, plan_id {purchase.plan_id}")
        # Verify the plan exists
        db_plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == purchase.plan_id).first()
        if not db_plan:
            raise HTTPException(status_code=404, detail="WiFi plan not found")
        
        # Record the purchase in UserPlanPurchase table
        purchase_record = UserPlanPurchase(
            user_id=current_user.id,
            plan_id=purchase.plan_id,
            purchase_date=datetime.utcnow()
        )
        db.add(purchase_record)
        db.commit()
        db.refresh(purchase_record)
        
        logger.info(f"Plan ID {purchase.plan_id} purchased by user {current_user.username}")
        return {"message": f"Plan {db_plan.name} purchased successfully"}
    except Exception as e:
        logger.error(f"Error in purchase_plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to record plan purchase: {str(e)}")

# Optional: Endpoint to add test WiFi plans for debugging
@app.post("/wifi-plans/test")
async def add_test_wifi_plan(db: Session = Depends(get_db)):
    try:
        # Ensure an ISP exists
        isp = db.query(User).filter(User.role == "wifi_provider").first()
        if not isp:
            raise HTTPException(status_code=400, detail="No ISP user found. Please register an ISP first.")
        
        existing_plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == 1).first()
        if not existing_plan:
            plan = WifiPlanModel(
                id=1,
                name="Daily 1GB",
                duration=PlanDuration.DAILY,
                price_kes=100.0,
                data_mb=1000,
                isp_id=isp.id
            )
            db.add(plan)
            db.commit()
            db.refresh(plan)
            logger.info("Added test WiFi plan: Daily 1GB")
        return {"message": "Test WiFi plan added or already exists"}
    except Exception as e:
        logger.error(f"Error in add_test_wifi_plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to add test WiFi plan: {str(e)}")