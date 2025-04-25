// script.js

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('m3u-form');
    const urlInput = document.getElementById('m3u_url');
    const resultsContainer = document.getElementById('results');
    const loadingIndicator = document.getElementById('loading');
    const errorMessageDiv = document.getElementById('error-message');
    const submitButton = document.getElementById('submit-button');

    // --- Utility Functions ---
    const showLoading = (isLoading) => {
        loadingIndicator.style.display = isLoading ? 'block' : 'none';
        submitButton.disabled = isLoading; // Disable button while loading
    };

    const showError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
    };

    const clearResultsAndErrors = () => {
        resultsContainer.innerHTML = '';
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
    };

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // --- Event Listener for Form Submission ---
    form.addEventListener('submit', async (event) => {
        event.preventDefault(); // Prevent default page reload
        clearResultsAndErrors();
        showLoading(true);

        const m3uUrl = urlInput.value.trim();
        if (!m3uUrl) {
            showError("দয়া করে একটি M3U URL দিন।");
            showLoading(false);
            return;
        }

        try {
            // 1. Fetch and Parse M3U via Flask API
            const processResponse = await fetch('/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ m3u_url: m3uUrl }),
            });

            // Note: Flask API now returns 200 even if no channels found, with a message
            // So check for !processResponse.ok only for actual HTTP errors (like 4xx, 5xx)
            if (!processResponse.ok) {
                let errorMsg = `সার্ভার থেকে ত্রুটি: ${processResponse.status}`;
                try { // Try to get error details from response body
                    const errorData = await processResponse.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) { /* Ignore if response body isn't JSON */ }
                throw new Error(errorMsg);
            }

            const data = await processResponse.json();

             if (data.error) { // Handle errors returned in JSON payload (e.g., M3U fetch timeout)
                throw new Error(data.error);
            }


            if (!data.groups || Object.keys(data.groups).length === 0) {
                 showError(data.message || "কোনো চ্যানেল খুঁজে পাওয়া যায়নি বা ফাইল ফরম্যাট অপ্রত্যাশিত।");
                 showLoading(false);
                 return;
            }

            // 2. Render Initial Channel List by Group
            renderChannels(data.groups);
            showLoading(false); // Hide loading after initial render

            // 3. Start Asynchronous Status Checking
            // Added a small delay before starting checks so UI is responsive first
            await delay(50);
            checkAllChannelStatuses(); // No need to await this if you want it to run in background

        } catch (error) {
            console.error("ফর্ম সাবমিট করার সময় ত্রুটি:", error);
            showError(`একটি ত্রুটি ঘটেছে: ${error.message}`);
            showLoading(false);
        }
    });

    // --- Rendering Function ---
    function renderChannels(groups) {
        resultsContainer.innerHTML = ''; // Clear again just in case

        // Sort group names (optional, but nice)
        const sortedGroupNames = Object.keys(groups).sort((a, b) => {
             if (a === 'Unknown Group') return 1; // Push Unknown Group to end
             if (b === 'Unknown Group') return -1;
             return a.localeCompare(b); // Alphabetical sort otherwise
        });


        for (const groupName of sortedGroupNames) {
            const channels = groups[groupName];
            if (channels && channels.length > 0) {
                const groupContainer = document.createElement('div');
                groupContainer.className = 'channel-group';

                const groupTitle = document.createElement('h2');
                groupTitle.className = 'group-title';
                groupTitle.textContent = groupName;
                groupContainer.appendChild(groupTitle);

                channels.forEach(channel => {
                    const card = document.createElement('div');
                    card.className = 'channel-card';
                    card.id = channel.id; // Use the ID from backend
                    card.dataset.streamUrl = channel.url || ''; // Store URL for status check

                    // Add a wrapper div for logo and info to control layout better (especially on smaller screens)
                    const cardHeader = document.createElement('div');
                    cardHeader.className = 'card-header';


                    // Logo
                    const logoImg = document.createElement('img');
                    logoImg.src = channel.logo || 'static/placeholder.png'; // Default placeholder
                    logoImg.alt = `${channel.name} লোগো`;
                    logoImg.onerror = () => { logoImg.src = 'static/placeholder.png'; }; // Fallback
                    cardHeader.appendChild(logoImg); // Append to header

                    // Channel Info
                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'channel-info';
                    const nameH3 = document.createElement('h3');
                    nameH3.textContent = channel.name || 'নাম নেই';
                    infoDiv.appendChild(nameH3);

                    if (channel.url) {
                        const urlP = document.createElement('p');
                        urlP.className = 'link';
                        urlP.id = `url-${channel.id}`; // ID for copy target
                        urlP.textContent = channel.url;
                        infoDiv.appendChild(urlP);
                    }
                    // Display logo URL if available (optional, but good for debugging/checking)
                    if (channel.logo) {
                         const logoUrlP = document.createElement('p');
                         logoUrlP.className = 'logo-link';
                         logoUrlP.id = `logo-url-${channel.id}`; // ID for copy target
                         logoUrlP.textContent = `লোগো: ${channel.logo}`;
                         infoDiv.appendChild(logoUrlP);
                    }
                    cardHeader.appendChild(infoDiv); // Append info to header


                    // Status Indicator (Initial: Pending)
                    const statusSpan = document.createElement('span');
                    // Initial status text and class handled by updateStatusUI
                    updateStatusUI(statusSpan, 'Pending');
                    statusSpan.id = `status-${channel.id}`; // ID for update target


                    // Button Group
                    const buttonGroup = document.createElement('div');
                    buttonGroup.className = 'button-group';

                    // Copy Stream Link Button
                    if (channel.url) {
                        const copyButton = document.createElement('button');
                        copyButton.className = 'copy-button';
                        copyButton.textContent = 'লিঙ্ক কপি';
                        copyButton.dataset.targetId = `url-${channel.id}`; // Target the <p> tag's ID
                        buttonGroup.appendChild(copyButton);
                    }

                    // Copy Logo Link Button
                    if (channel.logo) {
                        const copyLogoButton = document.createElement('button');
                        copyLogoButton.className = 'copy-logo-button';
                        copyLogoButton.textContent = 'লোগো কপি';
                        copyLogoButton.dataset.logourl = channel.logo; // Store logo URL directly
                        buttonGroup.appendChild(copyLogoButton);
                    }


                    // Assemble Card
                    card.appendChild(cardHeader); // Add the header wrapper
                    card.appendChild(statusSpan); // Add status span outside header
                    if(buttonGroup.hasChildNodes()) { // Only add button group if there are buttons
                        card.appendChild(buttonGroup);
                    }


                    groupContainer.appendChild(card);
                });
                resultsContainer.appendChild(groupContainer);
            }
        }
         // Add event listeners after rendering
         addCopyButtonListeners();
    }

     // --- Function to Update Status UI (Modified for new status strings) ---
    function updateStatusUI(statusSpanElement, statusText) {
        if (!statusSpanElement) return;

        statusSpanElement.textContent = statusText;

        // Remove all previous status classes except the base 'status' class
        // This is safer than removing specific known classes
        const classesToRemove = Array.from(statusSpanElement.classList).filter(c => c !== 'status');
        statusSpanElement.classList.remove(...classesToRemove);


        // Add specific classes for styling based on the status type received from backend
        // Using simpler, consistent class names for styling
        if (statusText === 'Pending') {
             statusSpanElement.classList.add('pending');
        } else if (statusText === 'Checking') {
             statusSpanElement.classList.add('checking');
        } else if (statusText === 'Working (Stream)') {
            statusSpanElement.classList.add('working-stream'); // Good stream found
        } else if (statusText === 'Working (Other Content)') {
             statusSpanElement.classList.add('working-other'); // Reachable but not recognized as stream
        } else if (statusText === 'N/A') {
              statusSpanElement.classList.add('not-available'); // No URL provided
        }
        // Group all failure/error states into a single styling class
        else { // Covers 'Not Working', 'Timeout', 'Connection Error', various 'Error' statuses
             statusSpanElement.classList.add('not-working');
        }

        // Optional: Add the raw status text as a class (sanitized) for potential specific styling if needed
        // const rawStatusClass = statusText.replace(/[\s()]/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
        // if (rawStatusClass) {
        //     statusSpanElement.classList.add(rawStatusClass);
        // }

         // You will need to define CSS rules in your style.css for these classes:
         // .status.pending { ... }
         // .status.checking { ... }
         // .status.working-stream { background-color: #d4edda; color: #155724; } /* Greenish */
         // .status.working-other { background-color: #fff3cd; color: #856404; } /* Orange/Yellowish - Warning */
         // .status.not-available { background-color: #e9ecef; color: #495057; } /* Greyish */
         // .status.not-working { background-color: #f8d7da; color: #721c24; } /* Reddish - Error */
    }

     // --- Asynchronous Status Checking Function ---
    async function checkAllChannelStatuses() {
        console.log("Starting status checks...");
        const channelCards = document.querySelectorAll('.channel-card');
        let checkedCount = 0;

        // Sequentially check status with a small delay between requests
        for (const card of channelCards) {
            const streamUrl = card.dataset.streamUrl;
            // Find the status span element dynamically by ID
            const channelId = card.id;
            const statusSpan = document.getElementById(`status-${channelId}`);


            if (streamUrl && statusSpan) {
                // Update UI to "Checking" immediately
                updateStatusUI(statusSpan, 'Checking');


                try {
                    const response = await fetch('/check_status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ stream_url: streamUrl }),
                    });

                    if (!response.ok) {
                        // Handle HTTP errors from the /check_status endpoint itself
                        console.error(`Status check API failed for ${streamUrl}: Server error ${response.status}`);
                         updateStatusUI(statusSpan, `API Error ${response.status}`); // Indicate API failure
                    } else {
                        const result = await response.json();
                        // Update UI with the status returned by the API
                        updateStatusUI(statusSpan, result.status || 'Unknown Error');
                    }
                } catch (error) {
                    console.error(`Status check fetch failed for ${streamUrl}:`, error);
                    // Handle network errors during the fetch request to /check_status
                    updateStatusUI(statusSpan, 'Fetch Error');
                }

                checkedCount++;
                // Optional: Update a progress indicator if needed
                // console.log(`Checked ${checkedCount}/${channelCards.length}`);

                // Wait a short time before the next request to avoid overwhelming server/network
                // Increased delay slightly to be gentler
                await delay(200); // Adjust delay as needed (e.g., 100-500ms)
            } else {
                 // If no URL was available for this channel
                 if(statusSpan) updateStatusUI(statusSpan, 'N/A');
            }
        }
        console.log("Status checks complete.");
    }

    // --- Event Delegation for Copy Buttons ---
    // Moved this into a function to call after rendering channels
    function addCopyButtonListeners() {
         resultsContainer.querySelectorAll('.copy-button, .copy-logo-button').forEach(button => {
             // Remove previous listeners if any (important if rendering happens multiple times)
             // Note: A more robust approach for SPA would be full event delegation on resultsContainer
             // But for this example, simple iteration after render is okay if render is triggered once per URL.
             // Let's stick to delegation as it's more efficient.
             // This function can be simplified, the event listener is attached ONCE to resultsContainer.
         });
         // The main event listener for resultsContainer is already outside this function,
         // ensuring delegation works for newly added buttons.
         // So this addCopyButtonListeners function isn't strictly needed if delegation is used.
         // Let's keep the delegation logic already present below.
    }


    // --- Event Delegation for Copy Buttons (Already present and correct) ---
    resultsContainer.addEventListener('click', (event) => {
        let textToCopy = null;
        let button = null;

        if (event.target.classList.contains('copy-button')) {
            button = event.target;
            const targetId = button.dataset.targetId;
            // Find the target element anywhere in the document by its ID
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                textToCopy = targetElement.textContent;
            }
        } else if (event.target.classList.contains('copy-logo-button')) {
            button = event.target;
            textToCopy = button.dataset.logourl; // Logo URL is stored directly in dataset
        }

        if (textToCopy && button) {
            copyToClipboard(textToCopy, button);
        }
    });

    // --- Clipboard Copy Function ---
    function copyToClipboard(text, buttonElement) {
        if (!navigator.clipboard) {
            alert('দুঃখিত, আপনার ব্রাউজার ক্লিপবোর্ডে কপি সমর্থন করে না।');
            return;
        }
        // Use the Clipboard API (more modern and secure)
        navigator.clipboard.writeText(text).then(() => {
            const originalText = buttonElement.textContent;
            buttonElement.textContent = 'কপি হয়েছে!';
            buttonElement.classList.add('copied');
            setTimeout(() => {
                buttonElement.textContent = originalText;
                buttonElement.classList.remove('copied');
            }, 1500); // Revert after 1.5 seconds
        }).catch(err => {
            console.error('ক্লিপবোর্ডে কপি করা যায়নি: ', err);
            // Fallback for older browsers or failures (less common now)
            alert('ত্রুটি: ক্লিপবোর্ডে কপি করা যায়নি।');
        });
    }

     // --- Optional: Add a placeholder image to static folder ---
     // Create a small image file named 'placeholder.png' in the 'static' directory.
     // This is used if a channel has no logo URL.
});
                            
