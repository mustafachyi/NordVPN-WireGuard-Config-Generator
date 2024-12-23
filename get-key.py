import subprocess
import sys

def install_packages(packages):
    print("Installing required packages...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", *packages], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    import requests
except ImportError:
    install_packages(['requests'])
    import requests

def validate_token(token):
    if len(token) != 64 or not all(c in '0123456789abcdefABCDEF' for c in token):
        return False
    return True

def get_key(token):
    if not token:
        print("Error: Token is empty. Please provide a valid token.")
        return

    if not validate_token(token):
        print("Invalid token. Token must be a 64-character hexadecimal string.")
        return

    headers = {
        'Authorization': f'token:{token}'
    }

    try:
        response = requests.get("https://api.nordvpn.com/v1/users/services/credentials", headers=headers)
        if response.status_code == 401:
            print("Unauthorized access. Please check your token permissions.")
            return
        response.raise_for_status()
        data = response.json()
        key = data.get('nordlynx_private_key')

        if key:
            print(f"Key: {key}")
        else:
            print("Key not found in the response")

    except Exception as e:
        print(f"Error fetching key: {e}")

if __name__ == "__main__":
    token = input("Enter your token: ").strip()
    get_key(token)
