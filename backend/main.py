from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from sqlalchemy import func
from typing import List, Dict
from database import Base, engine, get_db, SessionLocal
from models import User, DataUsage, WifiPlan as WifiPlanModel, PlanDuration, PendingRegistration, UserPlanPurchase
from schemas import (
    UserCreate, UserLogin, Token, DataUsageRequest, WalletUpdate, UserSchema,
    WifiPlan, WifiPlanCreate, WifiPlanUpdate, WiFiPlan, PlanPurchase,
    PendingRegistrationRequest, PendingRegistrationResponse, ConfirmRegistrationRequest, OTPVerificationRequest
)
from auth import get_password_hash, authenticate_user, create_access_token, get_current_user
from emailutils import generate_otp, send_otp_email
import time
import logging
import threading
import random
from datetime import datetime, timedelta

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler("app.log"), logging.StreamHandler()]
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

# In-memory store for OTPs (user_id: {otp, expiry})
otp_store: Dict[int, Dict[str, any]] = {}

# OAuth2 scheme for token validation
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")
SECRET_KEY = "your-secret-key"  # Replace with a secure key
ALGORITHM = "HS256"

# Set to track users with active simulations
active_simulations: set = set()
simulation_lock = threading.Lock()

def simulate_data_usage():
    """Simulate data usage for users with active plans until data is depleted."""
    logger.info("Started data usage simulation thread")
    while True:
        try:
            db = SessionLocal()
            try:
                # Get a copy of active simulations to avoid holding the lock during DB operations
                with simulation_lock:
                    users_to_simulate = active_simulations.copy()
                
                if not users_to_simulate:
                    logger.debug("No users with active simulations")
                else:
                    for user_id in users_to_simulate:
                        # Fetch the latest active plan purchase for the user
                        active_purchase = (
                            db.query(UserPlanPurchase)
                            .filter(UserPlanPurchase.user_id == user_id)
                            .order_by(UserPlanPurchase.purchase_date.desc())
                            .first()
                        )
                        
                        if not active_purchase:
                            logger.info(f"No active plan for user_id {user_id}. Stopping simulation.")
                            with simulation_lock:
                                active_simulations.discard(user_id)
                            continue

                        # Fetch user and plan details
                        user = db.query(User).filter(User.id == user_id).first()
                        plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == active_purchase.plan_id).first()
                        if not user or not plan:
                            logger.warning(f"User {user_id} or plan {active_purchase.plan_id} not found")
                            with simulation_lock:
                                active_simulations.discard(user_id)
                            continue

                        # Calculate total data used since the purchase date
                        total_used_mb = (
                            db.query(func.sum(DataUsage.usage_mb))
                            .filter(
                                DataUsage.user_id == user_id,
                                DataUsage.timestamp >= active_purchase.purchase_date
                            )
                            .scalar() or 0
                        )

                        # Check if data is depleted
                        if total_used_mb >= plan.data_mb:
                            logger.info(
                                f"User {user.username} has depleted plan {plan.name} "
                                f"({total_used_mb:.2f}/{plan.data_mb} MB). Stopping simulation."
                            )
                            with simulation_lock:
                                active_simulations.discard(user_id)
                            continue

                        # Simulate data usage
                        usage_mb = random.uniform(0.1, min(5.0, plan.data_mb - total_used_mb))
                        if usage_mb <= 0:
                            logger.debug(f"No more data to simulate for user {user.username}")
                            continue

                        # Record the simulated data usage
                        data_usage = DataUsage(
                            user_id=user_id,
                            usage_mb=usage_mb,
                            timestamp=datetime.utcnow()
                        )
                        db.add(data_usage)
                        logger.info(
                            f"Simulated {usage_mb:.2f} MB usage for {user.username} "
                            f"on plan {plan.name} (Remaining: {plan.data_mb - total_used_mb - usage_mb:.2f} MB)"
                        )
                    
                    db.commit()
            except OperationalError as db_err:
                logger.error(f"Database error in simulation: {str(db_err)}")
                db.rollback()
            except Exception as e:
                logger.error(f"Unexpected error in simulation for user_id {user_id}: {str(e)}")
                db.rollback()
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Error in simulation thread: {str(e)}")
        
        # Sleep to avoid excessive CPU usage
        time.sleep(30)

@app.on_event("startup")
async def startup_event():
    simulation_thread = threading.Thread(target=simulate_data_usage, daemon=True)
    simulation_thread.start()
    logger.info("Data usage simulation thread started")

@app.post("/register", response_model=Token)
async def register(user: UserCreate, db: Session = Depends(get_db)):
    try:
        logger.info(f"Register attempt for username: {user.username}")
        db_user = db.query(User).filter(User.username == user.username).first()
        if db_user:
            raise HTTPException(status_code=400, detail="Username already registered")
        db_pending = db.query(PendingRegistration).filter(PendingRegistration.username == user.username).first()
        if db_pending:
            raise HTTPException(status_code=400, detail="Username is pending registration")
        if db.query(User).filter(User.email == user.email).first():
            raise HTTPException(status_code=400, detail="Email already registered")
        hashed_password = get_password_hash(user.password)
        db_user = User(
            username=user.username,
            hashed_password=hashed_password,
            role=user.role,
            email=user.email
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        access_token = create_access_token(data={"sub": user.username, "role": user.role})
        active_users[user.username] = access_token
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
async def login(user: UserLogin, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        logger.info(f"Login attempt for username: {user.username}")
        db_user = authenticate_user(db, user.username, user.password)
        if not db_user:
            logger.warning(f"Authentication failed for username: {user.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username, password, or email",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if db_user.email != user.email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email does not match",
            )
        temp_token = create_access_token(
            data={"sub": user.username, "role": db_user.role, "temp": True},
            expires_delta=timedelta(minutes=10)
        )
        otp = generate_otp()
        expiry = datetime.utcnow() + timedelta(minutes=5)
        otp_store[db_user.id] = {"otp": otp, "expiry": expiry}
        background_tasks.add_task(send_otp_email, db_user.email, otp)
        logger.info(f"OTP sent for user {user.username}")
        return {
            "temp_token": temp_token,
            "message": "OTP sent to your email. Please verify to complete login."
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error in login: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/verify-otp")
async def verify_otp(otp_data: OTPVerificationRequest, temp_token: str = Depends(oauth2_scheme), db: Session = Depends(get_db), request: Request = None):
    try:
        logger.info(f"Received /verify-otp request: headers={request.headers}, body={await request.json()}")
        logger.info(f"Parsed OTP: {otp_data.otp}, temp_token={temp_token[:10]}...")
        payload = jwt.decode(temp_token, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("temp"):
            logger.warning("Token is not a temporary token")
            raise HTTPException(status_code=400, detail="Invalid token")
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if not username or not role:
            logger.warning("Token missing username or role")
            raise HTTPException(status_code=400, detail="Invalid token")
        
        db_user = db.query(User).filter(User.username == username).first()
        if not db_user:
            logger.warning(f"User not found: {username}")
            raise HTTPException(status_code=404, detail="User not found")
        
        otp_data_store = otp_store.get(db_user.id)
        if not otp_data_store:
            logger.warning(f"OTP not found for user: {username}")
            raise HTTPException(status_code=400, detail="OTP not found or expired")
        if otp_data_store["expiry"] < datetime.utcnow():
            logger.warning(f"OTP expired for user: {username}")
            del otp_store[db_user.id]
            raise HTTPException(status_code=400, detail="OTP expired")
        if otp_data_store["otp"] != otp_data.otp:
            logger.warning(f"Invalid OTP for user: {username}")
            raise HTTPException(status_code=400, detail="Invalid OTP")
        
        access_token = create_access_token(data={"sub": username, "role": role})
        active_users[username] = access_token
        del otp_store[db_user.id]
        logger.info(f"OTP verified for user {username}")
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "role": role
        }
    except jwt.JWTError as jwt_err:
        logger.error(f"JWT validation failed: {str(jwt_err)}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        logger.error(f"Error in verify_otp: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/verify-token")
async def verify_token(current_user: User = Depends(get_current_user)):
    try:
        logger.info(f"Verifying token for user: {current_user.username}")
        return {
            "message": "Token is valid",
            "username": current_user.username,
            "role": current_user.role
        }
    except Exception as e:
        logger.error(f"Error in verify_token: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
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
    try:
        logger.info(f"Registration request for user: {current_user.username}, wallet: {request.wallet_address}")
        if not request.wallet_address or not request.wallet_address.startswith("0x") or len(request.wallet_address) != 42:
            raise HTTPException(status_code=400, detail="Invalid wallet address format")
        existing_user = db.query(User).filter(User.wallet_address == request.wallet_address).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Wallet address is already associated with another user")
        existing_pending = db.query(PendingRegistration).filter(
            PendingRegistration.wallet_address == request.wallet_address
        ).first()
        if existing_pending:
            raise HTTPException(status_code=400, detail="Wallet address is already pending registration")
        existing_request = db.query(PendingRegistration).filter(
            PendingRegistration.username == current_user.username
        ).first()
        if existing_request:
            raise HTTPException(status_code=400, detail="User already has a pending registration")
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
    try:
        logger.info(f"Confirming registration for pending_id: {request.pending_id} by ISP {current_user.username}")
        pending = db.query(PendingRegistration).filter(PendingRegistration.id == request.pending_id).first()
        if not pending:
            raise HTTPException(status_code=404, detail="Pending registration not found")
        db_user = db.query(User).filter(User.id == pending.user_id).first()
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")
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
    try:
        pending = db.query(PendingRegistration).filter(PendingRegistration.user_id == current_user.id).first()
        status = "registered" if current_user.wallet_address else ("pending" if pending else "not_registered")
        
        active_purchase = db.query(UserPlanPurchase).filter(UserPlanPurchase.user_id == current_user.id).order_by(UserPlanPurchase.purchase_date.desc()).first()
        remaining_mb = 0
        plan_name = None
        if active_purchase:
            plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == active_purchase.plan_id).first()
            if plan:
                total_used_mb = db.query(DataUsage).filter(
                    DataUsage.user_id == current_user.id,
                    DataUsage.timestamp >= active_purchase.purchase_date
                ).withEntities(func.sum(DataUsage.usage_mb)).scalar() or 0
                remaining_mb = max(0, plan.data_mb - total_used_mb)
                plan_name = plan.name

        return {
            "message": f"Welcome to the User Dashboard, {current_user.username}!",
            "registration_status": status,
            "wallet_address": current_user.wallet_address,
            "active_plan": plan_name,
            "remaining_mb": remaining_mb
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
        
        active_purchase = db.query(UserPlanPurchase).filter(UserPlanPurchase.user_id == current_user.id).order_by(UserPlanPurchase.purchase_date.desc()).first()
        if not active_purchase:
            raise HTTPException(status_code=400, detail="No active plan found. Purchase a plan to log data usage.")
        
        plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == active_purchase.plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        
        total_used_mb = db.query(DataUsage).filter(
            DataUsage.user_id == current_user.id,
            DataUsage.timestamp >= active_purchase.purchase_date
        ).withEntities(func.sum(DataUsage.usage_mb)).scalar() or 0
        
        if total_used_mb + data.usage_mb > plan.data_mb:
            raise HTTPException(status_code=400, detail="Data limit exceeded for the active plan")
        
        data_usage = DataUsage(user_id=current_user.id, usage_mb=data.usage_mb, timestamp=datetime.utcnow())
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
        users = db.query(User).filter(User.role == "user").all()
        return users
    except Exception as e:
        logger.error(f"Error in get_all_users_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/users", response_model=List[UserSchema])
async def get_all_isp_users_endpoint(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    try:
        users = db.query(User).filter(User.role == "user").all()
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
            timestamp = entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")
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
        
        active_purchase = db.query(UserPlanPurchase).filter(UserPlanPurchase.user_id == target_user.id).order_by(UserPlanPurchase.purchase_date.desc()).first()
        if not active_purchase:
            raise HTTPException(status_code=400, detail="User has no active plan")
        
        plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == active_purchase.plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        
        total_used_mb = db.query(DataUsage).filter(
            DataUsage.user_id == target_user.id,
            DataUsage.timestamp >= active_purchase.purchase_date
        ).withEntities(func.sum(DataUsage.usage_mb)).scalar() or 0
        
        if total_used_mb + usage_mb > plan.data_mb:
            raise HTTPException(status_code=400, detail="Data limit exceeded for the active plan")
        
        data_usage = DataUsage(user_id=target_user.id, usage_mb=usage_mb, timestamp=datetime.utcnow())
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
                "duration": plan.duration.value,
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
        db_plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == purchase.plan_id).first()
        if not db_plan:
            raise HTTPException(status_code=404, detail="WiFi plan not found")
        if not purchase.user_address or not purchase.user_address.startswith("0x") or len(purchase.user_address) != 42:
            raise HTTPException(status_code=400, detail="Invalid wallet address format")
        if purchase.price_kes <= 0 or purchase.price_eth <= 0:
            raise HTTPException(status_code=400, detail="Invalid price values")
        
        purchase_record = UserPlanPurchase(
            user_id=current_user.id,
            plan_id=purchase.plan_id,
            user_address=purchase.user_address,
            price_kes=purchase.price_kes,
            price_eth=purchase.price_eth,
            purchase_date=datetime.utcnow()
        )
        db.add(purchase_record)
        db.commit()
        db.refresh(purchase_record)
        
        # Start simulation for this user
        with simulation_lock:
            active_simulations.add(current_user.id)
        logger.info(f"Started data usage simulation for user {current_user.username} after purchasing plan {db_plan.name}")
        
        return {"message": f"Plan {db_plan.name} purchased successfully", "purchase_id": purchase_record.id}
    except Exception as e:
        logger.error(f"Error in purchase_plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to record plan purchase: {str(e)}")

@app.post("/wifi-plans/test")
async def add_test_wifi_plan(db: Session = Depends(get_db)):
    try:
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