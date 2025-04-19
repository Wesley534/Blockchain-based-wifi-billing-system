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

        # Skip email question (assuming Q1 is email)
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
        other_entry_id = other_input['name'] if other_input else None

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

            print(f"Attempt {attempt + 1}/{max_retries} - Form action URL: {action_url}")

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
    Generates randomized form data based on the extracted entry map.
    
    Args:
        entry_map (dict): Dictionary containing question details and entry IDs.
    
    Returns:
        dict: Randomized form data with correct entry IDs.
    """
    other_freq = ["Never", "Once a year", "When needed"]
    other_source = ["GitHub", "Friend’s recommendation", "USB drives"]
    other_signs = ["System crashes", "Data loss", "Weird error messages"]
    motivations = [
        "High cost of licensed software pushes people to cracked versions.",
        "Lack of access to paid software in some regions.",
        "Testing software before committing to a purchase.",
        "Unawareness of legal or security risks.",
        "Ease of finding cracked software online."
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

        if q_type == 'radio':
            if "how often do you install" in question:
                choice = random.choices(
                    ["Daily", "Weekly", "Monthly", "Rarely", "Other"],
                    weights=[5, 20, 30, 35, 10], k=1)[0]
                form_data[entry_id] = choice
                if choice == "Other" and other_entry_id:
                    form_data[other_entry_id] = random.choice(other_freq)
                assigned_questions.append(question)

            elif "where do you usually download" in question:
                choice = random.choices(
                    ["Official website", "App store", "Third-party websites", "Torrents", "Other"],
                    weights=[40, 30, 20, 5, 5], k=1)[0]
                form_data[entry_id] = choice
                if choice == "Other" and other_entry_id:
                    form_data[other_entry_id] = random.choice(other_source)
                assigned_questions.append(question)

            elif any(s in question for s in ["check the authenticity", "knowingly used cracked software"]):
                choice = random.choices(
                    ["Yes", "No", "Maybe"],
                    weights=[20, 60, 20], k=1)[0]
                form_data[entry_id] = choice
                assigned_questions.append(question)

            elif "used a cracked software detection application" in question:
                choice = random.choices(
                    ["Yes", "No", "Maybe"],
                    weights=[10, 70, 20], k=1)[0]
                form_data[entry_id] = choice
                assigned_questions.append(question)

        elif q_type == 'checkbox' and "common signs" in question:
            signs_options = [
                "Unexpected pop-ups or ads",
                "Slow system performance",
                "Antivirus or firewall alerts",
                "Disabled features",
                "Unknown background processes"
            ]
            num_signs = random.randint(0, 3)
            selected_signs = random.sample(signs_options, num_signs) if num_signs > 0 else []
            form_data[entry_id] = selected_signs
            if random.random() > 0.8 and other_entry_id:
                form_data[other_entry_id] = random.choice(other_signs)
            assigned_questions.append(question)

        elif q_type == 'scale' and "software authenticity" in question:
            choice = random.choices(
                ["0", "1", "2", "3", "4"],
                weights=[10, 15, 30, 30, 15], k=1)[0]
            form_data[entry_id] = choice
            assigned_questions.append(question)

        elif q_type == 'text' and "motivates people" in question:
            choice = random.choice(motivations)
            form_data[entry_id] = choice
            assigned_questions.append(question)

    print(f"Assigned questions: {assigned_questions}")
    return form_data

# Example usage
if __name__ == "__main__":
    # Google Form URL
    form_url = "https://docs.google.com/forms/d/e/1FAIpQLSeq_FdWY6RMcwB3KgPwlsaovq_FUS3U6tLfL1QtHlMaJ5dy8w/viewform"

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