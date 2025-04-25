import requests
from bs4 import BeautifulSoup
import time

def fill_google_form(form_url, form_data):
    """
    Fills a Google Form with the provided data.
    
    Args:
        form_url (str): The URL of the Google Form.
        form_data (dict): Dictionary with field names and values to submit.
    """
    try:
        # Set headers to mimic a browser
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,/;q=0.8',
            'Referer': form_url
        }

        # Get the form page
        response = requests.get(form_url, headers=headers)
        response.raise_for_status()

        # Parse the HTML content
        soup = BeautifulSoup(response.text, 'html.parser')

        # Find the form action URL
        form = soup.find('form')
        if not form:
            raise ValueError("No form found on the page")
        
        action_url = form.get('action')
        if not action_url:
            raise ValueError("Form action URL not found")

        print(f"Form action URL: {action_url}")

        # Initialize payload with form_data
        payload = form_data.copy()  # Use form_data directly

        # Find hidden fields (e.g., fbzx, fvv)
        hidden_inputs = soup.find_all('input', {'type': 'hidden'})
        for hidden in hidden_inputs:
            name = hidden.get('name')
            value = hidden.get('value')
            if name and value:
                payload[name] = value

        # Debug: Print payload before submission
        print(f"Payload: {payload}")

        # Submit the form
        submit_response = requests.post(action_url, data=payload, headers=headers)
        submit_response.raise_for_status()

        print("Form submitted successfully!")
        return True
        
    except requests.exceptions.RequestException as e:
        print(f"Error submitting form: {e}")
        return False
    except ValueError as e:
        print(f"Error: {e}")
        return False

# Example usage
if __name__ == "__main__":
    # Google Form URL
    form_url = "https://docs.google.com/forms/d/e/1FAIpQLScs8x_aj7pF_8RYvC_6GZs_fXKt1EkDw7uWtc5gCHOVNmpfLw/viewform"

    # Form data with field names from the provided HTML
    form_data = {
        # Question 1: Satisfaction with current Wi-Fi billing accuracy (required)
        "entry.2134470431": "Satisfied",
        # Question 2: Clarity of billing statements (required)
        "entry.1884428485": "Sometimes",
        # Question 3: Importance of real-time monitoring
        "entry.401425390": "Very important",
        # Question 4: Openness to real-time billing notifications
        "entry.1854073141": "Yes, definitely",
        # Question 5: Importance of easy-to-use dashboard
        "entry.951259350": "Very important",
        # Question 6: Trust in blockchain-based billing
        "entry.945418159": "Maybe, if I understand how it works",
        # Question 7: Likelihood to subscribe due to secure billing (1-5)
        "entry.1222507515": "4",
        # Question 8: Concerns about blockchain for Wi-Fi billing
        "entry.23440739": "I'm worried about the complexity of blockchain and whether it might slow down the billing process.",
        # Question 9: Suggestions for convenient, secure Wi-Fi payments
        "entry.912868835": "Offer a mobile app with biometric authentication and real-time usage tracking."
    }

    # Loop to submit 100 responses
    num_submissions = 100
    success_count = 0
    delay_seconds = 2  # Delay between submissions to avoid rate limits

    print(f"Starting submission of {num_submissions} form responses...")
    for i in range(num_submissions):
        print(f"\nAttempting submission {i + 1}/{num_submissions}")
        if fill_google_form(form_url, form_data):
            success_count += 1
        else:
            print(f"Submission {i + 1} failed.")
        time.sleep(delay_seconds)  # Delay to avoid rate limits

    print(f"\nCompleted! Successfully submitted {success_count}/{num_submissions} responses.")