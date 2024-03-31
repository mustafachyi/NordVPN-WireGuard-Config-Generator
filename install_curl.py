import os
import shutil
import subprocess

# Create a temporary directory to store the downloaded ZIP file
temp_dir = os.path.join(os.environ['TEMP'], 'curl_install_temp')
os.makedirs(temp_dir, exist_ok=True)

# Download the cURL ZIP file using wget
curl_url = 'https://curl.se/windows/dl-8.7.1_5/curl-8.7.1_5-win64-mingw.zip'
curl_zip_path = os.path.join(temp_dir, 'curl.zip')
subprocess.run(['wget', curl_url, '-O', curl_zip_path])

# Extract the ZIP file contents using PowerShell Expand-Archive cmdlet
extract_cmd = f'Expand-Archive -Path "{curl_zip_path}" -DestinationPath "{os.path.join(os.environ["ProgramFiles"], "curl_temp")}" -Force'
subprocess.run(['powershell', '-Command', extract_cmd], shell=True)

# Move files from the subfolder to the parent directory
subfolder_path = os.path.join(os.environ['ProgramFiles'], 'curl_temp', 'curl-8.7.1_5-win64-mingw')
for item in os.listdir(subfolder_path):
    shutil.move(os.path.join(subfolder_path, item), os.path.join(os.environ['ProgramFiles'], 'curl', item))

# Remove the temporary subfolder
shutil.rmtree(os.path.join(os.environ['ProgramFiles'], 'curl_temp'))

# Add the cURL executable path to the system's PATH environment variable
os.environ['Path'] += f';{os.path.join(os.environ["ProgramFiles"], "curl", "bin")}'
subprocess.run(['setx', 'Path', os.environ['Path']], shell=True)

# Clean up by removing the downloaded ZIP file
os.remove(curl_zip_path)

print('cURL installation completed.')