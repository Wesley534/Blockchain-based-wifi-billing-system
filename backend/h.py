from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
password = "Qwerty!234"  # Replace with the desired password
hashed_password = pwd_context.hash(password)
print(hashed_password)