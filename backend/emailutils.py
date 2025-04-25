import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import random
import string
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)

def generate_otp(length=6):
    """Generate a random OTP."""
    return ''.join(random.choices(string.digits, k=length))

def send_otp_email(email: str, otp: str):
    """Send OTP to the user's email."""
    try:
        sender_email = "peterwesley484@gmail.com"  # Replace with your email
        sender_password = "euegulfxytzyymqi"  # Replace with your app-specific password
        subject = "Your OTP for Login"
        body = f"Your OTP is {otp}. It is valid for 5 minutes."

        msg = MIMEMultipart()
        msg['From'] = sender_email
        msg['To'] = email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        server.sendmail(sender_email, email, msg.as_string())
        server.quit()
        logger.info(f"OTP sent to {email}")
    except Exception as e:
        logger.error(f"Failed to send OTP to {email}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to send OTP")