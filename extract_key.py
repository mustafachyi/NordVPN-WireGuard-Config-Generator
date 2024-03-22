import subprocess
import json

def get_nordlynx_private_key(access_token):
    try:
        output = subprocess.check_output(["curl", "-s", "-u", f"token:{access_token}", "https://api.nordvpn.com/v1/users/services/credentials"])
        data = json.loads(output.decode('utf-8'))
        return data.get('nordlynx_private_key')
    except subprocess.CalledProcessError as e:
        print(f"Error: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON: {e}")
        return None

def main():
    access_token = input("Enter your access token: ")
    private_key = get_nordlynx_private_key(access_token)
    if private_key:
        print(f"Nordlynx Private Key: {private_key}")
    else:
        print("Failed to retrieve Nordlynx Private Key.")

if __name__ == "__main__":
    main()
