import requests
from bs4 import BeautifulSoup
import random
import time
import re

def extract_entry_ids(html_content):
    """
    Extracts entry IDs and question details from the Google Form HTML.
    
    Args:
        html_content (str): The HTML content of the Google Form.
    
    Returns:
        dict: A dictionary mapping question indices to their entry IDs and types.
    """
    soup = BeautifulSoup(html_content, 'html.parser')
    entry_map = {}

    # Find all question containers
    questions = soup.find_all('div', class_='Qr7Oae')
    
    for idx, question in enumerate(questions):
        # Extract question text
        question_text_elem = question.find('span', class_='M7eMe')
        question_text = question_text_elem.get_text(strip=True) if question_text_elem else f"Question {idx+1}"

        # Extract entry ID from hidden input
        entry_input = question.find('input', {'name': re.compile(r'entry\.\d+_sentinel')})
        entry_id = entry_input['name'].replace('_sentinel', '') if entry_input else None

        # Skip email question (if presentthe question_text.lower() checks for "email" might need adjustment based on actual form
        if "email" in question_text.lower():
            continue

        # Determine question type
        if question.find('div', role='radiogroup'):
            q_type = 'radio'
        elif question.find('div', role='list'):
            q_type = 'checkbox'
        elif question.find('textarea'):
            q_type = 'text'
        elif question.find('div', class_='N9Qcwe'):
            q_type = 'scale'
        else:
            q_type = 'unknown'

        # Check for "Other" option
        other_input = question.find('input', {'name': re.compile(r'entry\.\d+\.other_option_response')})
        other_entry_id = other_entry_id = other_input['name'] if other_input else None

        entry_map[idx] = {
            'question': question_text,
            'entry_id': entry_id,
            'type': q_type,
            'other_entry_id': other_entry_id
        }

    return entry_map

def fill_google_form(form_url, form_data, max_retries=3):
    """
    Fills a Google Form with the provided data, with retries on failure.
    
    Args:
        form_url (str): The URL of the Google Form.
        form_data (dict): Dictionary with field names and values to submit.
        max_retries (int): Maximum number of retries for failed submissions.
    """
    for attempt in range(max_retries):
        try:
            session = requests.Session()
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Referer': form_url,
                'Origin': 'https://docs.google.com',
                'Accept-Language': 'en-US,en;q=0.9',
                'DNT': '1'
            }
            session.headers.update(headers)

            response = session.get(form_url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            form = soup.find('form')
            if not form:
                raise ValueError("No form found on the page")
            
            action_url = form.get('action')
            if not action_url:
                raise ValueError("Form action URL not found")

            print(f"Attempt {attempt + 1}/{max_retries} - Form action сезона URL: {action_url}")

            payload = form_data.copy()
            hidden_inputs = soup.find_all('input', {'type': 'hidden'})
            for hidden in hidden_inputs:
                name = hidden.get('name')
                value = hidden.get('value')
                if name and value:
                    payload[name] = value

            print(f"Payload keys: {list(payload.keys())}")

            submit_response = session.post(action_url, data=payload)
            submit_response.raise_for_status()

            print(f"Submission successful on attempt {attempt + 1}/{max_retries}!")
            return True
            
        except requests.exceptions.RequestException as e:
            print(f"Error submitting form on attempt {attempt + 1}/{max_retries}: {e}")
            print(f"Response content: {submit_response.text if 'submit_response' in locals() else 'No response'}")
            if attempt + 1 < max_retries:
                print("Retrying after delay...")
                time.sleep(random.uniform(5, 10))
            else:
                print("Max retries reached. Submission failed.")
                return False
        except ValueError as e:
            print(f"Error: {e}")
            return False

def generate_random_form_data(entry_map):
    """
    Generates randomized form data based on the extracted entry map for the specified questions.
    
    Args:
        entry_map (dict): Dictionary containing question details and entry IDs.
    
    Returns:
        dict: Randomized form data with correct entry IDs.
    """
    other_contexts = ["Personal project", "Visa application", "Professional certification"]
    challenges = [
        "Slow response from institution",
        "Missing documents",
        "Technical issues with online system",
        "Unclear instructions"
    ]
    concerns = [
        "Privacy of personal data",
        "Security of blockchain system",
        "Complexity of using blockchain",
        "Lack of understanding about blockchain"
    ]

    form_data = {}
    assigned_questions = []

    for idx, q_info in entry_map.items():
        entry_id = q_info['entry_id']
        q_type = q_info['type']
        other_entry_id = q_info['other_entry_id']
        question = q_info['question'].lower()

        if not entry_id:
            print(f"Warning: No entry ID for question {idx+1}: {q_info['question']}")
            continue

        # Q1: In what context did you need verification? (Checkbox)
        if q_type == 'checkbox' and "context did you need verification" in question:
            context_options = ["Internship", "Job Application", "Scholarship", "University Transfer"]
            num_contexts = random.randint(1, 3)
            selected_contexts = random.sample(context_options, num_contexts)
            form_data[entry_id] = selected_contexts
            if random.random() > 0.7 and other_entry_id:
                form_data[other_entry_id] = random.choice(other_contexts)
            assigned_questions.append(question)

        # Q2: How was the verification done? (Radio)
        elif q_type == 'radio' and "how was the verification done" in question:
            choice = random.choices(
                ["Printed document submission", "Email from institution", "Online system", "I don’t know"],
                weights=[30, 30, 30, 10], k=1)[0]
            form_data[entry_id] = choice
            assigned_questions.append(question)

        # Q3: Did the process involve delays or challenges? (Text, Yes/No with optional explanation)
        elif q_type == 'text' and "delays or challenges" in question:
            choice = random.choices(["Yes", "No"], weights=[40, 60], k=1)[0]
            form_data[entry_id] = choice
            if choice == "Yes" and other_entry_id:
                form_data[other_entry_id] = random.choice(challenges)
            assigned_questions.append(question)

        # Q4: How long did the verification take? (Radio)
        elif q_type == 'radio' and "how long did the verification take" in question:
            choice = random.choices(
                ["Less than 1 day", "1–3 days", "4–7 days", "More than a week"],
                weights=[20, 40, 30, 10], k=1)[0]
            form_data[entry_id] = choice
            assigned_questions.append(question)

        # Q5: Would you be comfortable with your certificate being stored...? (Radio)
        elif q_type == 'radio' and "comfortable with your certificate being stored" in question:
            choice = random.choices(
                ["Yes", "No", "Maybe"],
                weights=[30, 20, 50], k=1)[0]
            form_data[entry_id] = choice
            assigned_questions.append(question)

        # Q6: Any concerns about using blockchain...? (Text, Optional)
        elif q_type == 'text' and "concerns about using blockchain" in question:
            if random.random() > 0.3:  # 70% chance of providing a concern
                form_data[entry_id] = random.choice(concerns)
            assigned_questions.append(question)

        # Q7: Do you believe blockchain can help reduce certificate fraud? (Radio)
        elif q_type == 'radio' and "reduce certificate fraud" in question:
            choice = random.choices(
                ["Yes", "No", "Maybe"],
                weights=[40, 10, 50], k=1)[0]
            form_data[entry_id] = choice
            assigned_questions.append(question)

    print(f"Assigned questions: {assigned_questions}")
    return form_data

# Example usage
if __name__ == "__main__":
    # Google Form URL
    form_url = "https://docs.google.com/forms/d/e/1FAIpQLSdFx89xENPqUC4Zb3MA21DBqIR1QGq2-ocUaa_wgVLr13eddw/viewform"

    # Read the HTML content
    with open('form.html', 'r', encoding='utf-8') as file:
        html_content = file.read()

    # Extract entry IDs
    entry_map = extract_entry_ids(html_content)
    print("Extracted Entry Map:")
    for idx, q_info in entry_map.items():
        print(f"Q{idx+1}: {q_info['question']}")
        print(f"  Entry ID: {q_info['entry_id']}, Type: {q_info['type']}, Other Entry ID: {q_info['other_entry_id']}")

    # Loop for 60 responses
    target_responses = 60
    successful_submissions = 0

    print(f"\nAttempting to submit {target_responses} responses...")

    for i in range(target_responses):
        print(f"\nSubmission {i+1}/{target_responses}")
        form_data = generate_random_form_data(entry_map)
        if fill_google_form(form_url, form_data):
            successful_submissions += 1
        time.sleep(random.uniform(3, 5))

    print(f"\nCompleted! Successfully submitted {successful_submissions}/{target_responses} responses.")