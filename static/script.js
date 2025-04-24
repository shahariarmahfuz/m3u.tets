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

            if (!processResponse.ok) {
                let errorMsg = `সার্ভার থেকে ত্রুটি: ${processResponse.status}`;
                try { // Try to get error details from response body
                    const errorData = await processResponse.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) { /* Ignore if response body isn't JSON */ }
                throw new Error(errorMsg);
            }

            const data = await processResponse.json();

            if (data.error) { // Handle errors returned in JSON
                throw new Error(data.error);
            }

            if (!data.groups || Object.keys(data.groups).length === 0) {
                 showError(data.message || "কোনো চ্যানেল খুঁজে পাওয়া যায়নি।");
                 showLoading(false);
                 return;
            }

            // 2. Render Initial Channel List by Group
            renderChannels(data.groups);
            showLoading(false); // Hide loading after initial render

            // 3. Start Asynchronous Status Checking
            await checkAllChannelStatuses();

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

                    // Logo
                    const logoImg = document.createElement('img');
                    logoImg.src = channel.logo || 'static/placeholder.png'; // Default placeholder
                    logoImg.alt = `${channel.name} লোগো`;
                    logoImg.onerror = () => { logoImg.src = 'static/placeholder.png'; }; // Fallback

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
                    if (channel.logo) { // Display logo URL if available
                         const logoUrlP = document.createElement('p');
                         logoUrlP.className = 'logo-link';
                         logoUrlP.id = `logo-url-${channel.id}`; // ID for copy target
                         logoUrlP.textContent = `লোগো: ${channel.logo}`;
                         infoDiv.appendChild(logoUrlP);
                    }


                    // Status Indicator (Initial: Pending)
                    const statusSpan = document.createElement('span');
                    statusSpan.className = 'status Pending';
                    statusSpan.textContent = 'Pending';
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
                    card.appendChild(logoImg);
                    card.appendChild(infoDiv);
                    card.appendChild(statusSpan); // Add status span
                    if(buttonGroup.hasChildNodes()) { // Only add button group if there are buttons
                        card.appendChild(buttonGroup);
                    }


                    groupContainer.appendChild(card);
                });
                resultsContainer.appendChild(groupContainer);
            }
        }
    }

    // --- Asynchronous Status Checking Function ---
    async function checkAllChannelStatuses() {
        console.log("Starting status checks...");
        const channelCards = document.querySelectorAll('.channel-card');
        let checkedCount = 0;

        // Sequentially check status with a small delay between requests
        for (const card of channelCards) {
            const streamUrl = card.dataset.streamUrl;
            const statusSpan = card.querySelector('.status');
            const channelId = card.id;

            if (streamUrl && statusSpan) {
                // Update UI to "Checking"
                statusSpan.textContent = 'Checking';
                statusSpan.className = 'status Checking';

                try {
                    const response = await fetch('/check_status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ stream_url: streamUrl }),
                    });

                    if (!response.ok) {
                        console.error(`Status check failed for ${streamUrl}: Server error ${response.status}`);
                         updateStatusUI(statusSpan, 'Error');
                    } else {
                        const result = await response.json();
                        updateStatusUI(statusSpan, result.status || 'Unknown');
                    }
                } catch (error) {
                    console.error(`Status check failed for ${streamUrl}:`, error);
                    updateStatusUI(statusSpan, 'Error');
                }

                checkedCount++;
                // Optional: Update a progress indicator if needed
                // console.log(`Checked ${checkedCount}/${channelCards.length}`);

                // Wait a short time before the next request to avoid overwhelming server/network
                await delay(100); // Adjust delay as needed (e.g., 100-500ms)
            } else {
                 // If no URL, mark as N/A
                 if(statusSpan) updateStatusUI(statusSpan, 'N/A');
            }
        }
        console.log("Status checks complete.");
    }

    // --- Function to Update Status UI ---
    function updateStatusUI(statusSpanElement, statusText) {
        if (!statusSpanElement) return;

        statusSpanElement.textContent = statusText;
        // Reset classes and add the correct one based on statusText
        statusSpanElement.className = 'status'; // Base class
        const statusClass = statusText.replace(/[\s()]/g, '.').replace(/[^a-zA-Z0-9.]/g, ''); // Sanitize status for class name
        statusSpanElement.classList.add(statusClass);

         // Add specific classes for styling groups
         if (statusText === 'Working' || statusText === 'Working (Redirect)') {
            statusSpanElement.classList.add('Working');
         } else if (statusText === 'Pending') {
              statusSpanElement.classList.add('Pending');
         } else if (statusText === 'Checking') {
              statusSpanElement.classList.add('Checking');
         } else { // Consider all others (Not Working, Timeout, Error, N/A) as failures for styling
              statusSpanElement.classList.add('Not.Working'); // Use a consistent class for failure states
         }

    }

    // --- Event Delegation for Copy Buttons ---
    resultsContainer.addEventListener('click', (event) => {
        let textToCopy = null;
        let button = null;

        if (event.target.classList.contains('copy-button')) {
            button = event.target;
            const targetId = button.dataset.targetId;
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                textToCopy = targetElement.textContent;
            }
        } else if (event.target.classList.contains('copy-logo-button')) {
            button = event.target;
            textToCopy = button.dataset.logourl;
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
            alert('ত্রুটি: ক্লিপবোর্ডে কপি করা যায়নি।');
        });
    }

     // --- Optional: Add a placeholder image to static folder ---
     // Create a small image file named 'placeholder.png' in the 'static' directory.
});
              
