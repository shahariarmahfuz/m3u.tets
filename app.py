# App.py

from flask import Flask, render_template, request, jsonify
import requests
import re
# concurrent.futures is not strictly needed for the synchronous check_status_api,
# but kept imports as they were in original if future async is planned.
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import os # For secret key
import io # Added for handling bytes

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
                    'status': 'Pending' # Initial status (handled by JS)
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


def check_stream_status_sync(url, timeout=8): # Increased timeout slightly for stream check
    """
    Synchronous status check for a single URL.
    Attempts to verify if it's a reachable URL serving M3U/M3U8 content based on initial bytes.
    Returns status string.
    """
    if not url:
        return "N/A"

    # Define a small chunk size to read just the beginning
    CHUNK_SIZE = 1024 # Read first 1KB, should be enough for headers

    try:
        # Use requests.get with stream=True to avoid downloading the whole file
        # and allow reading just the beginning.
        # Added User-Agent to better simulate a browser/player request.
        with requests.get(url, timeout=timeout, stream=True, allow_redirects=True,
                          headers={'User-Agent': 'Mozilla/5.0'}) as response:

            # Check HTTP status code first
            if not response.ok:
                 # Close the connection if not OK
                 response.close()
                 return f"Not Working (HTTP Error {response.status_code})"

            # If status is OK (2xx) or Redirect (3xx)
            try:
                # Read the first chunk of the response body
                # Use response.raw.read() for getting raw bytes before decoding
                first_chunk = response.raw.read(CHUNK_SIZE, decode_content=False)

                # Close the connection immediately after reading the first chunk
                response.close()

                # Try to decode the chunk and check for M3U signature
                try:
                    # Assuming UTF-8 encoding is most common for M3U/M3U8
                    # Use errors='ignore' to handle potential decoding issues in the first chunk
                    decoded_chunk = first_chunk.decode('utf-8', errors='ignore')

                    # Check if the M3U signature is present in the decoded chunk
                    if '#EXTM3U' in decoded_chunk:
                        return "Working (Stream)"
                    else:
                        # URL is reachable (2xx/3xx) but initial bytes don't look like M3U/M3U8
                        return "Working (Other Content)" # Or "Working (Not Stream)"

                except Exception:
                    # Error decoding the chunk (e.g., not valid UTF-8)
                    # The URL was reachable and returned data, but couldn't verify type
                    return "Working (Decode Error)"

            except requests.exceptions.StreamConsumedError:
                 # This can happen if the stream was somehow consumed before raw.read()
                 return "Working (Stream Error)" # Reachable, but stream read failed
            except Exception as e:
                 # Any other error during chunk reading/processing after successful connection
                 print(f"Error reading stream chunk from {url}: {e}") # Log the error
                 return "Working (Processing Error)" # Reachable, but couldn't process

    except requests.exceptions.Timeout:
        return "Timeout"
    except requests.exceptions.RequestException as e:
        # Catch network errors like connection refused, DNS errors, etc.
        # print(f"Request error for {url}: {e}") # Optional: Log the error
        return "Connection Error"
    except Exception as e:
        # Catch any other unexpected errors
        print(f"Unexpected error checking {url}: {e}") # Log the error
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
        # Increased timeout for fetching the M3U file itself
        response = requests.get(m3u_url, timeout=30)
        response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)
        print("API: M3U content fetched.")

        # Decode content safely - try utf-8 first, then fallback
        try:
             content = response.content.decode('utf-8')
        except UnicodeDecodeError:
             # If utf-8 fails, try ISO-8859-1 or response's suggested encoding
             content = response.content.decode(response.encoding or 'ISO-8859-1', errors='ignore')


        grouped_channels = parse_m3u(content)

        if not grouped_channels:
             # Check if content was fetched but no channels found
             if content and len(content.strip()) > 0:
                  return jsonify({'groups': {}, 'message': 'M3U ফাইল পাওয়া গেছে, কিন্তু কোনো চ্যানেল পাওয়া যায়নি বা ফরম্যাট অপ্রত্যাশিত।'}), 200
             else:
                  return jsonify({'groups': {}, 'message': 'M3U ফাইল খালি বা ডেটা পাওয়া যায়নি।'}), 200


        return jsonify({'groups': grouped_channels})

    except requests.exceptions.Timeout:
        print(f"API: Timeout fetching M3U from {m3u_url}")
        return jsonify({'error': f"M3U ফাইল আনতে সময় লেগেছে (Timeout): {m3u_url}"}), 504 # Gateway Timeout
    except requests.exceptions.RequestException as e:
        print(f"API: Request error fetching M3U from {m3u_url}: {e}")
        return jsonify({'error': f"M3U ফাইল আনতে সমস্যা হয়েছে: {e}"}), 502 # Bad Gateway or appropriate error
    except Exception as e:
        print(f"API: Unexpected error during processing: {e}")
        # Log the traceback in debug mode
        import traceback
        traceback.print_exc()
        return jsonify({'error': f"একটি অপ্রত্যাশিত সার্ভার ত্রুটি ঘটেছে: {e}"}), 500


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
    # Use host='0.0.0.0' to make it accessible externally (e.g., from Docker or another machine)
    # debug=True is good for development, set to False for production
    app.run(host='0.0.0.0', port=8080, debug=True)
