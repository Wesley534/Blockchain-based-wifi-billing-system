from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from sqlalchemy.exc import OperationalError
from sqlalchemy import func, cast, DateTime
from typing import List, Dict
from database import Base, engine, get_db, SessionLocal
from models import User, DataUsage, WifiPlan as WifiPlanModel, PlanDuration, PendingRegistration, UserPlanPurchase, HelpRequest, FeedbackRequest
from schemas import (
    UserCreate, UserLogin, Token, DataUsageRequest, WalletUpdate, UserSchema,
    WifiPlan, WifiPlanCreate, WifiPlanUpdate, WiFiPlan, PlanPurchase,
    PendingRegistrationCreate, PendingRegistrationRequest, PendingRegistrationResponse,
    ConfirmRegistrationRequest, OTPVerificationRequest, HelpRequestCreate, HelpRequestResponse,
    FeedbackRequestCreate, FeedbackRequestResponse
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
                with simulation_lock:
                    users_to_simulate = active_simulations.copy()
                
                if not users_to_simulate:
                    logger.debug("No users with active simulations")
                else:
                    for user_id in users_to_simulate:
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

                        user = db.query(User).filter(User.id == user_id).first()
                        plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == active_purchase.plan_id).first()
                        if not user or not plan:
                            logger.warning(f"User {user_id} or plan {active_purchase.plan_id} not found")
                            with simulation_lock:
                                active_simulations.discard(user_id)
                            continue

                        total_used_mb = (
                            db.query(func.sum(DataUsage.usage_mb))
                            .filter(
                                DataUsage.user_id == user_id,
                                DataUsage.timestamp >= active_purchase.purchase_date
                            )
                            .scalar() or 0
                        )

                        if total_used_mb >= plan.data_mb:
                            logger.info(
                                f"User {user.username} has depleted plan {plan.name} "
                                f"({total_used_mb:.2f}/{plan.data_mb} MB). Stopping simulation."
                            )
                            with simulation_lock:
                                active_simulations.discard(user_id)
                            continue

                        usage_mb = random.uniform(0.1, min(5.0, plan.data_mb - total_used_mb))
                        if usage_mb <= 0:
                            logger.debug(f"No more data to simulate for user {user.username}")
                            continue

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
        
        time.sleep(30)

@app.on_event("startup")
async def startup_event():
    simulation_thread = threading.Thread(target=simulate_data_usage, daemon=True)
    simulation_thread.start()
    logger.info("Data usage simulation thread started")

async def send_pending_email(email: str, username: str):
    """Send an email to the user indicating their registration is pending."""
    subject = "Registration Pending Approval"
    body = (
        f"Dear {username},\n\n"
        "Thank you for registering with our service. Your registration is currently pending approval by the ISP.\n"
        "You will receive a confirmation email once your registration is approved.\n\n"
        "Best regards,\nThe Team"
    )
    await send_otp_email(email, body, subject=subject)

@app.post("/register")
async def register(user: PendingRegistrationCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        logger.info(f"Register attempt for username: {user.username}")
        # Password strength check
        strength = 0
        if len(user.password) >= 8:
            strength += 1
        if any(c.isupper() for c in user.password):
            strength += 1
        if any(c.islower() for c in user.password):
            strength += 1
        if any(c.isdigit() for c in user.password):
            strength += 1
        if any(c in "!@#$%^&*(),.?\":{}|<>" for c in user.password):
            strength += 1
        if strength < 4:
            raise HTTPException(status_code=400, detail="Password must be strong (at least 8 characters, including uppercase, lowercase, numbers, and special characters)")

        # Check for existing user or pending registration
        if db.query(User).filter(User.username == user.username).first():
            raise HTTPException(status_code=400, detail="Username already registered")
        if db.query(PendingRegistration).filter(PendingRegistration.username == user.username).first():
            raise HTTPException(status_code=400, detail="Username is pending registration")
        if db.query(User).filter(User.email == user.email).first():
            raise HTTPException(status_code=400, detail="Email already registered")
        if db.query(PendingRegistration).filter(PendingRegistration.email == user.email).first():
            raise HTTPException(status_code=400, detail="Email is pending registration")
        if not user.wallet_address or not user.wallet_address.startswith("0x") or len(user.wallet_address) != 42:
            raise HTTPException(status_code=400, detail="Invalid wallet address format")
        if db.query(User).filter(User.wallet_address == user.wallet_address).first():
            raise HTTPException(status_code=400, detail="Wallet address is already associated with another user")
        if db.query(PendingRegistration).filter(PendingRegistration.wallet_address == user.wallet_address).first():
            raise HTTPException(status_code=400, detail="Wallet address is already pending registration")

        # Hash password and create pending registration
        hashed_password = get_password_hash(user.password)
        db_pending = PendingRegistration(
            username=user.username,
            hashed_password=hashed_password,
            email=user.email,
            wallet_address=user.wallet_address
        )
        db.add(db_pending)
        db.commit()
        db.refresh(db_pending)

        # Send pending email
        background_tasks.add_task(send_pending_email, user.email, user.username)
        logger.info(f"Pending registration created for: {user.username}")
        return {"message": "Registration request submitted successfully. Awaiting ISP approval."}
    except Exception as e:
        logger.error(f"Error in register: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/login")
async def login(user: UserLogin, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        logger.info(f"Login attempt for username: {user.username}")
        # Check if user is in PendingRegistration
        db_pending = db.query(PendingRegistration).filter(PendingRegistration.username == user.username).first()
        if db_pending:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your registration is pending ISP approval. Please wait for confirmation."
            )
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
            "message": f"OTP sent to {user.email}"
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
        
        # Check if user is in PendingRegistration
        db_pending = db.query(PendingRegistration).filter(PendingRegistration.username == username).first()
        if db_pending:
            logger.warning(f"User {username} is pending registration")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your registration is pending ISP approval. Please wait for confirmation."
            )
        
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
    """Ensure the user has the 'user' role for accessing user-specific endpoints."""
    logger.debug(f"Checking role for user {current_user.username}: {current_user.role}")
    if current_user.role != "user":
        logger.warning(f"User {current_user.username} does not have required role 'user'")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have the required role: user"
        )
    return current_user

def get_isp(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Ensure the user has the 'wifi_provider' role for accessing ISP-specific endpoints."""
    logger.debug(f"Checking role for user {current_user.username}: {current_user.role}")
    if current_user.role != "wifi_provider":
        logger.warning(f"User {current_user.username} does not have required role 'wifi_provider'")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have the required role: wifi_provider"
        )
    return current_user

@app.post("/request-registration")
async def request_registration(
    request: PendingRegistrationRequest,
    db: Session = Depends(get_db)
):
    try:
        logger.info(f"Update pending registration request with wallet: {request.wallet_address}")
        if not request.wallet_address or not request.wallet_address.startswith("0x") or len(request.wallet_address) != 42:
            raise HTTPException(status_code=400, detail="Invalid wallet address format")
        if db.query(User).filter(User.wallet_address == request.wallet_address).first():
            raise HTTPException(status_code=400, detail="Wallet address is already associated with a user")
        existing_pending = db.query(PendingRegistration).filter(
            PendingRegistration.wallet_address == request.wallet_address
        ).first()
        if existing_pending:
            raise HTTPException(status_code=400, detail="Wallet address is already pending registration")
        # This endpoint assumes the frontend sends the username in a separate field or token
        # For simplicity, we'll need to adjust frontend to support this if needed
        raise HTTPException(status_code=400, detail="This endpoint requires authentication or username context")
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
                "email": p.email,
                "wallet_address": p.wallet_address,
                "created_at": p.created_at
            } for p in pending
        ]
    except Exception as e:
        logger.error(f"Error in get_pending_registrations: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/isp/confirm-registration", response_model=Token)
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
        
        # Check for conflicts
        if db.query(User).filter(User.username == pending.username).first():
            raise HTTPException(status_code=400, detail="Username already registered")
        if db.query(User).filter(User.email == pending.email).first():
            raise HTTPException(status_code=400, detail="Email already registered")
        if db.query(User).filter(User.wallet_address == pending.wallet_address).first():
            raise HTTPException(status_code=400, detail="Wallet address is already associated with another user")

        # Create user
        db_user = User(
            username=pending.username,
            hashed_password=pending.hashed_password,
            email=pending.email,
            wallet_address=pending.wallet_address,
            role="user",
            is_active=True
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)

        # Delete pending registration
        db.delete(pending)
        db.commit()

        # Generate token
        access_token = create_access_token(data={"sub": db_user.username, "role": db_user.role})
        active_users[db_user.username] = access_token
        logger.info(f"Confirmed registration for {db_user.username}, wallet: {db_user.wallet_address}")
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "role": db_user.role
        }
    except Exception as e:
        logger.error(f"Error in confirm_registration: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/user/dashboard", response_model=dict)
async def user_dashboard(current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    try:
        status = "registered" if current_user.wallet_address else "not_registered"
        
        active_purchase = db.query(UserPlanPurchase).filter(UserPlanPurchase.user_id == current_user.id).order_by(UserPlanPurchase.purchase_date.desc()).first()
        remaining_mb = 0
        plan_name = None
        if active_purchase:
            plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == active_purchase.plan_id).first()
            if plan:
                total_used_mb = db.query(DataUsage).filter(
                    DataUsage.user_id == current_user.id,
                    DataUsage.timestamp >= active_purchase.purchase_date
                ).with_entities(func.sum(DataUsage.usage_mb)).scalar() or 0
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
    try:
        return {"message": f"Welcome to the ISP Dashboard, {current_user.username}!"}
    except Exception as e:
        logger.error(f"Error in isp_dashboard: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

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
        ).with_entities(func.sum(DataUsage.usage_mb)).scalar() or 0
        
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
    """Fetch total data usage per user for ISP users with 'wifi_provider' role."""
    try:
        # Query total data usage per user with username
        data_usage = (
            db.query(
                User.username,
                func.sum(DataUsage.usage_mb).label("total_usage_mb"),
                cast(func.min(DataUsage.timestamp), DateTime).label("timestamp")
            )
            .join(DataUsage, User.id == DataUsage.user_id)
            .group_by(User.id, User.username)
            .all()
        )
        
        if not data_usage:
            return []
        
        # Format the response
        result = []
        for entry in data_usage:
            timestamp = entry.timestamp
            # Fallback: Convert string timestamp to datetime if necessary
            if isinstance(timestamp, str):
                try:
                    timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                except ValueError as e:
                    logger.error(f"Invalid timestamp format for user {entry.username}: {timestamp}")
                    timestamp = datetime.utcnow()  # Use current time as fallback
            result.append({
                "username": entry.username,
                "total_usage_mb": float(entry.total_usage_mb),
                "timestamp": timestamp.isoformat()
            })
        logger.info(f"Fetched total data usage for ISP {current_user.username}")
        return result
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
        ).with_entities(func.sum(DataUsage.usage_mb)).scalar() or 0
        
        if total_used_mb + usage_mb > plan.data_mb:
            raise HTTPException(status_code=400, detail="Data limit exceeded for the active plan")
        
        data_usage = DataUsage(user_id=target_user.id, usage_mb=usage_mb, timestamp=datetime.utcnow())
        db.add(data_usage)
        db.commit()
        logger.info(f"Logged {usage_mb} MB usage for {username} by ISP {current_user.username}")
        return {"message": f"Data usage of {usage_mb} MB logged successfully for {username}"}
    except Exception as e:
        logger.error(f"Error in isp_log_data_usage: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/wifi-plans", response_model=List[WifiPlan])
async def get_wifi_plans_isp(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    try:
        plans = db.query(WifiPlanModel).filter(WifiPlanModel.isp_id == current_user.id).all()
        logger.info(f"Fetched WiFi plans for ISP {current_user.username}")
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

@app.post("/help")
async def submit_help_request(request: HelpRequestCreate, db: Session = Depends(get_db)):
    try:
        db_request = HelpRequest(
            subject=request.subject,
            message=request.message,
            created_at=datetime.utcnow()
        )
        db.add(db_request)
        db.commit()
        db.refresh(db_request)
        logger.info(f"Help request submitted: {request.subject}")
        return {"message": "Help request submitted successfully"}
    except Exception as e:
        logger.error(f"Error in submit_help_request: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/feedback")
async def submit_feedback_request(request: FeedbackRequestCreate, db: Session = Depends(get_db)):
    try:
        db_request = FeedbackRequest(
            feedback=request.feedback,
            created_at=datetime.utcnow()
        )
        db.add(db_request)
        db.commit()
        db.refresh(db_request)
        logger.info(f"Feedback submitted")
        return {"message": "Feedback submitted successfully"}
    except Exception as e:
        logger.error(f"Error in submit_feedback_request: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/help-requests", response_model=List[HelpRequestResponse])
async def get_help_requests(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    try:
        logger.info(f"Fetching help requests for ISP {current_user.username}")
        requests = db.query(HelpRequest).all()
        return requests
    except Exception as e:
        logger.error(f"Error in get_help_requests: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/isp/feedback-requests", response_model=List[FeedbackRequestResponse])
async def get_feedback_requests(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    try:
        logger.info(f"Fetching feedback requests for ISP {current_user.username}")
        requests = db.query(FeedbackRequest).all()
        return requests
    except Exception as e:
        logger.error(f"Error in get_feedback_requests: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

async def send_admin_confirmation_email(email: str, username: str):
    """Send a confirmation email to the admin after registration."""
    subject = "Admin Registration Successful"
    body = (
        f"Dear {username},\n\n"
        "Congratulations! Your admin account has been successfully registered as a WiFi Provider.\n"
        "You can now log in to manage WiFi plans and user requests.\n\n"
        "Best regards,\nThe Team"
    )
    await send_otp_email(email, body, subject=subject)

@app.post("/register-admin", response_model=Token)
async def register_admin(user: UserCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        logger.info(f"Admin register attempt for username: {user.username}")
        # Password strength check
        strength = 0
        if len(user.password) >= 8:
            strength += 1
        if any(c.isupper() for c in user.password):
            strength += 1
        if any(c.islower() for c in user.password):
            strength += 1
        if any(c.isdigit() for c in user.password):
            strength += 1
        if any(c in "!@#$%^&*(),.?\":{}|<>" for c in user.password):
            strength += 1
        if strength < 4:
            raise HTTPException(
                status_code=400,
                detail="Password must be strong (at least 8 characters, including uppercase, lowercase, numbers, and special characters)"
            )

        # Check for existing user or pending registration
        if db.query(User).filter(User.username == user.username).first():
            raise HTTPException(status_code=400, detail="Username already registered")
        if db.query(PendingRegistration).filter(PendingRegistration.username == user.username).first():
            raise HTTPException(status_code=400, detail="Username is pending registration")
        if db.query(User).filter(User.email == user.email).first():
            raise HTTPException(status_code=400, detail="Email already registered")
        if db.query(PendingRegistration).filter(PendingRegistration.email == user.email).first():
            raise HTTPException(status_code=400, detail="Email is pending registration")
        if not user.wallet_address or not user.wallet_address.startswith("0x") or len(user.wallet_address) != 42:
            raise HTTPException(status_code=400, detail="Invalid wallet address format")
        if db.query(User).filter(User.wallet_address == user.wallet_address).first():
            raise HTTPException(status_code=400, detail="Wallet address is already associated with another user")
        if db.query(PendingRegistration).filter(PendingRegistration.wallet_address == user.wallet_address).first():
            raise HTTPException(status_code=400, detail="Wallet address is already pending registration")

        # Hash password and create user
        hashed_password = get_password_hash(user.password)
        db_user = User(
            username=user.username,
            hashed_password=hashed_password,
            email=user.email,
            wallet_address=user.wallet_address,
            role="wifi_provider",
            is_active=True
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)

        # Generate token
        access_token = create_access_token(data={"sub": user.username, "role": "wifi_provider"})
        active_users[user.username] = access_token

        # Send confirmation email
        background_tasks.add_task(send_admin_confirmation_email, user.email, user.username)
        logger.info(f"Admin registered: {user.username}")

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "role": "wifi_provider"
        }
    except Exception as e:
        logger.error(f"Error in register_admin: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/user/active-plan", response_model=dict)
async def get_active_plan(current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    try:
        # Get the most recent plan purchase for the user
        active_purchase = (
            db.query(UserPlanPurchase)
            .filter(UserPlanPurchase.user_id == current_user.id)
            .order_by(UserPlanPurchase.purchase_date.desc())
            .first()
        )
        
        if not active_purchase:
            raise HTTPException(status_code=404, detail="No active plan found")
        
        # Get the associated plan
        plan = db.query(WifiPlanModel).filter(WifiPlanModel.id == active_purchase.plan_id).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        
        # Calculate total data usage since purchase
        total_used_mb = (
            db.query(func.sum(DataUsage.usage_mb))
            .filter(
                DataUsage.user_id == current_user.id,
                DataUsage.timestamp >= active_purchase.purchase_date
            )
            .scalar() or 0
        )
        
        # Calculate remaining MBs
        remaining_mb = max(0, plan.data_mb - total_used_mb)
        
        return {
            "plan_name": plan.name,
            "purchase_date": active_purchase.purchase_date,
            "remaining_mb": remaining_mb
        }
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Error in get_active_plan: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")