window.onload = function() {
    document.getElementById('token').value = '';
}

async function getKey() {
    const CORS_PROXY = "https://corsproxy.io/?";
    const token = document.getElementById('token').value;
    const url = `${CORS_PROXY}https://api.nordvpn.com/v1/users/services/credentials`;
    const headers = new Headers({
        'Authorization': `token:${token}`
    });

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const key = data.nordlynx_private_key;
        document.getElementById('output').innerText = key;
        document.getElementById('output').classList.add('glow');
        document.getElementById('output').addEventListener('click', function() {
            navigator.clipboard.writeText(key);
            document.getElementById('output').innerText = 'Copied!';
            document.getElementById('output').classList.remove('glow');
            setTimeout(function() {
                let text = document.getElementById('output').innerText;
                let intervalId = setInterval(function() {
                    text = text.slice(0, -1);
                    document.getElementById('output').innerText = text;
                    if (text.length === 0) {
                        clearInterval(intervalId);
                        let inputText = document.getElementById('token').value;
                        let inputIntervalId = setInterval(function() {
                            inputText = inputText.slice(0, -1);
                            document.getElementById('token').value = inputText;
                            if (inputText.length === 0) {
                                clearInterval(inputIntervalId);
                            }
                        }, 35); // 35 milliseconds = 0.035 seconds
                    }
                }, 200); // 200 milliseconds = 0.2 seconds
            }, 1500); // 1500 milliseconds = 1.5 seconds
        });
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('output').innerText = 'Error fetching key';
        setTimeout(() => {
            document.getElementById('output').innerText = '';
        }, 800); // 800 milliseconds = 0.8 seconds
    }
}