import requests

def extract_ips_with_credentials(url):
    try:
        username = input("Enter your SOCKS username: ")
        password = input("Enter your SOCKS password: ")

        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            ips_with_credentials = []
            for server in data:
                ip = server["station"]
                port = 1080  # Assuming default SOCKS port is 1080
                ip_with_credentials = f"{ip}:{port}:{username}:{password}"
                ips_with_credentials.append(ip_with_credentials)
            return ips_with_credentials
        else:
            print("Failed to fetch data. Status code:", response.status_code)
            return None
    except Exception as e:
        print("An error occurred:", e)
        return None

def save_ips_to_file(ips_with_credentials, filename):
    try:
        with open(filename, "w") as file:
            for ip_with_credentials in ips_with_credentials:
                file.write(ip_with_credentials + "\n")
        print(f"IPs with credentials saved to {filename} successfully!")
    except Exception as e:
        print("An error occurred while saving IPs:", e)

def save_urls_to_file(ips_with_credentials, filename, protocol="socks5"):
    try:
        with open(filename, "w") as file:
            for ip_with_credentials in ips_with_credentials:
                ip, port, username, password = ip_with_credentials.split(":")
                url = f"{protocol}://{username}:{password}@{ip}:{port}"
                file.write(url + "\n")
        print(f"URLs saved to {filename} successfully!")
    except Exception as e:
        print("An error occurred while saving URLs:", e)

url = "https://api.nordvpn.com/v1/servers?limit=100&filters[servers_technologies][identifier]=socks"
ips_with_credentials = extract_ips_with_credentials(url)

if ips_with_credentials:
    save_ips_to_file(ips_with_credentials, "socks_ips.txt")
    save_urls_to_file(ips_with_credentials, "socks_urls.txt", protocol="socks5")
else:
    print("Failed to extract IPs. Please check the URL or try again later.")