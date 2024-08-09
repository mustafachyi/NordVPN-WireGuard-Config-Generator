import requests

def get_key(token):
    if not token:
        print("Error: Token is empty. Please provide a valid token.")
        return

    headers = {
        'Authorization': f'token:{token}'
    }

    try:
        response = requests.get("https://api.nordvpn.com/v1/users/services/credentials", headers=headers)
        response.raise_for_status()  # Check if the request was successful
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
