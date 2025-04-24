from flask import Flask, render_template, request, jsonify
import requests
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import os # For secret key

# Regex definitions
extinf_regex = re.compile(r'^#EXTINF:-?\d+(.*),(.*)')
logo_regex = re.compile(r'tvg-logo="([^"]+)"')
group_regex = re.compile(r'group-title="([^"]+)"') # Regex for group-title

# --- Helper Functions ---

def parse_m3u(content):
    """Parses M3U, extracts channel info including group, defaults group if missing."""
    lines = content.splitlines()
    channels = []
    current_channel_info = {}
    count = 0

    for line in lines:
        line = line.strip()
        if line.startswith('#EXTINF:'):
            match = extinf_regex.match(line)
            if match:
                attributes_str = match.group(1).strip()
                channel_name = match.group(2).strip()

                logo = ''
                logo_match = logo_regex.search(attributes_str)
                if logo_match:
                    logo = logo_match.group(1)

                group = 'Unknown Group' # Default group
                group_match = group_regex.search(attributes_str)
                if group_match:
                    group = group_match.group(1).strip()

                current_channel_info = {
                    'id': f'channel-{count}', # Unique ID for JS targeting
                    'name': channel_name,
                    'logo': logo,
                    'group': group,
                    'status': 'Pending' # Initial status
                }
            else:
                 current_channel_info = {}

        elif line and not line.startswith('#') and current_channel_info.get('name'):
            if line.startswith('http://') or line.startswith('https://'):
                current_channel_info['url'] = line
                channels.append(current_channel_info)
                count += 1
            current_channel_info = {}

    # Group channels
    grouped_channels = {}
    for channel in channels:
        group_name = channel['group']
        if group_name not in grouped_channels:
            grouped_channels[group_name] = []
        grouped_channels[group_name].append(channel)

    return grouped_channels

def check_stream_status_sync(url, timeout=5):
    """Synchronous status check for a single URL. Returns status string."""
    if not url:
        return "N/A"
    try:
        # Try HEAD first
        response = requests.head(url, timeout=timeout, allow_redirects=True, stream=False, headers={'User-Agent': 'Mozilla/5.0'})
        if not response.ok:
             response = requests.get(url, timeout=timeout, stream=True, headers={'User-Agent': 'Mozilla/5.0'})
             response.close()

        if 200 <= response.status_code < 300:
            return "Working"
        elif 300 <= response.status_code < 400:
             return "Working (Redirect)"
        else:
            return f"Not Working ({response.status_code})"
    except requests.exceptions.Timeout:
        return "Timeout"
    except requests.exceptions.RequestException:
        return "Not Working (Error)"
    except Exception:
        return "Error"

# --- Flask App Configuration ---

app = Flask(__name__)
# It's better practice to set secret key from environment variable or config file
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'default_secret_key_for_dev')

# --- API Routes ---

@app.route('/process', methods=['POST'])
def process_m3u():
    """API endpoint to fetch, parse, and group M3U content."""
    data = request.get_json()
    m3u_url = data.get('m3u_url', '').strip()

    if not m3u_url:
        return jsonify({'error': 'M3U URL is required.'}), 400

    try:
        print(f"API: Fetching M3U from: {m3u_url}")
        response = requests.get(m3u_url, timeout=20)
        response.raise_for_status()
        print("API: M3U content fetched.")

        grouped_channels = parse_m3u(response.text)

        if not grouped_channels:
             return jsonify({'groups': {}, 'message': 'No channels found or file format incorrect.'})

        return jsonify({'groups': grouped_channels})

    except requests.exceptions.Timeout:
        return jsonify({'error': f"Timeout fetching M3U: {m3u_url}"}), 504 # Gateway Timeout
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f"Error fetching M3U: {e}"}), 502 # Bad Gateway or appropriate error
    except Exception as e:
        print(f"API: Unexpected error during processing: {e}")
        return jsonify({'error': f"An unexpected server error occurred: {e}"}), 500

@app.route('/check_status', methods=['POST'])
def check_status_api():
    """API endpoint to check status of a single stream URL."""
    data = request.get_json()
    stream_url = data.get('stream_url', '').strip()

    if not stream_url:
        return jsonify({'error': 'Stream URL is required.'}), 400

    # Perform the check synchronously within this request
    status = check_stream_status_sync(stream_url)
    # print(f"API: Checked {stream_url} -> {status}") # Optional: for logging
    return jsonify({'status': status})


# --- Main Page Route ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    # The template is now just a shell, JS will handle dynamic content
    return render_template('index.html')

# --- Run the App ---

if __name__ == '__main__':
    print("Flask app starting on http://0.0.0.0:8080")
    app.run(host='0.0.0.0', port=8080, debug=True) # Turn debug=False in production
