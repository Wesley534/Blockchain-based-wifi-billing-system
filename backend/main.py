from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import Base, engine, get_db
from models import User, DataUsage
from schemas import UserCreate, UserLogin, Token, DataUsageRequest, WalletUpdate
from auth import get_password_hash, authenticate_user, create_access_token, get_current_user
import time
import random
import threading
import requests
from datetime import datetime

app = FastAPI()

# Add CORS middleware to allow requests from any origin during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create the database tables
Base.metadata.create_all(bind=engine)

# Function to get all users with role "user" from the database
def get_all_users(db: Session):
    return db.query(User).filter(User.role == "user").all()

# Function to simulate data usage for all users
def simulate_data_usage():
    # Get a database session
    db = next(get_db())

    # Fetch all users with role "user"
    users = get_all_users(db)
    if not users:
        print("No users found in the database. Please register some users to simulate data usage.")
        db.close()
        return

    # Dictionary to store JWT tokens for each user
    user_tokens = {}

    # Log in as each user to get their JWT token
    for user in users:
        login_data = {"username": user.username, "password": "pass123"}  # Assuming all users have the same password for simplicity
        try:
            response = requests.post("http://127.0.0.1:8000/login", json=login_data)
            if response.status_code == 200:
                token = response.json().get("access_token")
                user_tokens[user.username] = token
                print(f"Logged in as {user.username} for simulation.")
            else:
                print(f"Failed to log in as {user.username}: {response.json()}")
        except Exception as e:
            print(f"Error logging in as {user.username}: {e}")

    # Close the database session
    db.close()

    # If no users were successfully logged in, exit the simulation
    if not user_tokens:
        print("No users were successfully logged in for simulation.")
        return

    # Simulate data usage for each user every 10 seconds
    while True:
        for username, token in user_tokens.items():
            usage_mb = random.randint(1, 100)
            headers = {"Authorization": f"Bearer {token}"}
            try:
                response = requests.post(
                    "http://127.0.0.1:8000/data-usage",
                    json={"usage_mb": usage_mb},
                    headers=headers,
                )
                if response.status_code == 200:
                    print(f"Simulated {usage_mb} MB usage for {username}: {response.json()}")
                else:
                    print(f"Failed to simulate usage for {username}: {response.json()}")
            except Exception as e:
                print(f"Error simulating usage for {username}: {e}")
        time.sleep(10)  # Simulate usage every 10 seconds for all users

# Start the simulation in a background thread when the app starts
@app.on_event("startup")
async def startup_event():
    simulation_thread = threading.Thread(target=simulate_data_usage, daemon=True)
    simulation_thread.start()
    print("Started data usage simulation for all users in the background.")

@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    """Register a new user or WiFi provider."""
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    db_user = User(username=user.username, hashed_password=hashed_password, role=user.role)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    access_token = create_access_token(data={"sub": user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": db_user.role
    }

@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    """Log in a user or WiFi provider and return a JWT token and role."""
    db_user = authenticate_user(db, user.username, user.password)
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": db_user.role
    }

# Define helper functions to create role-specific dependencies
def get_user(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "user":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have the required role: user",
        )
    return current_user

def get_isp(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "isp":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have the required role: wifi_provider",
        )
    return current_user

@app.get("/user/dashboard")
def user_dashboard(current_user: User = Depends(get_user)):
    """Protected endpoint for the user dashboard."""
    return {"message": f"Welcome to the User Dashboard, {current_user.username}!"}

@app.get("/isp/dashboard")
def isp_dashboard(current_user: User = Depends(get_isp)):
    """Protected endpoint for the ISP (WiFi provider) dashboard."""
    return {"message": f"Welcome to the ISP Dashboard, {current_user.username}!"}

@app.post("/data-usage")
def log_data_usage(data: DataUsageRequest, current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    """Log data usage in the database for the authenticated user."""
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    data_usage = DataUsage(user_id=current_user.id, usage_mb=data.usage_mb, timestamp=timestamp)
    db.add(data_usage)
    db.commit()
    return {"message": "Data usage logged successfully"}

@app.get("/data-usage")
def get_data_usage(current_user: User = Depends(get_user), db: Session = Depends(get_db)):
    """Retrieve data usage history for the authenticated user from the database."""
    usage = db.query(DataUsage).filter(DataUsage.user_id == current_user.id).all()
    return [{"usage_mb": u.usage_mb, "timestamp": u.timestamp} for u in usage]

# ISP-specific endpoints
@app.get("/isp/data-usage")
def get_total_data_usage(current_user: User = Depends(get_isp), db: Session = Depends(get_db)):
    """Retrieve aggregated data usage history for all users (ISP only)."""
    # Fetch all data usage entries
    all_usage = db.query(DataUsage).all()
    
    # Aggregate data usage by timestamp
    usage_by_time = {}
    for entry in all_usage:
        # Truncate timestamp to seconds for aggregation
        timestamp = entry.timestamp[:19]
        if timestamp not in usage_by_time:
            usage_by_time[timestamp] = 0
        usage_by_time[timestamp] += entry.usage_mb
    
    # Convert to list for the frontend
    total_usage = [
        {"timestamp": timestamp, "total_usage_mb": usage_mb}
        for timestamp, usage_mb in usage_by_time.items()
    ]
    
    # Sort by timestamp
    return sorted(total_usage, key=lambda x: x["timestamp"])

@app.post("/isp/log-data-usage")
def isp_log_data_usage(
    data: dict,
    current_user: User = Depends(get_isp),
    db: Session = Depends(get_db)
):
    """Log data usage for a specific user (ISP only)."""
    username = data.get("username")
    usage_mb = data.get("usage_mb")

    # Validate input
    if not username or not isinstance(usage_mb, (int, float)) or usage_mb <= 0:
        raise HTTPException(status_code=400, detail="Invalid username or usage_mb")

    # Find the user
    target_user = db.query(User).filter(User.username == username, User.role == "user").first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Log the data usage
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    data_usage = DataUsage(user_id=target_user.id, usage_mb=usage_mb, timestamp=timestamp)
    db.add(data_usage)
    db.commit()
    return {"message": f"Data usage of {usage_mb} MB logged successfully for {username}"}

app.post("/update-wallet")
def update_wallet(wallet_data: schemas.WalletUpdate, current_user: schemas.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == current_user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db_user.wallet_address = wallet_data.wallet_address
    db.commit()
    db.refresh(db_user)
    return {"message": "Wallet address updated successfully"}