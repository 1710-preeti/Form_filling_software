document.getElementById('autoFillBtn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = 'Analyzing page...';
    statusDiv.style.color = '#fff';
    
    try {
        chrome.runtime.sendMessage({ action: 'startAutomation' });
    } catch (err) {
        statusDiv.textContent = 'Error: ' + err.message;
        statusDiv.style.color = '#ff6b6b';
    }
});

document.getElementById('debugExtractBtn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = 'Extracting for debug...';
    
    chrome.runtime.sendMessage({ action: 'debugExtraction' }, (response) => {
        if (response && response.text) {
            navigator.clipboard.writeText(response.text).then(() => {
                statusDiv.textContent = 'Text copied to clipboard! (Length: ' + response.text.length + ')';
                statusDiv.style.color = '#28a745';
            });
        } else {
            statusDiv.textContent = 'Extraction failed: ' + (response ? response.error : 'Unknown error');
            statusDiv.style.color = '#ff6b6b';
        }
    });
});

// Listen for status updates from background
chrome.runtime.onMessage.addListener((message) => {
    const statusDiv = document.getElementById('status');
    if (message.action === 'statusUpdate' && statusDiv) {
        statusDiv.textContent = message.text;
        if (message.isError) statusDiv.style.color = '#ff6b6b';
        else statusDiv.style.color = '#fff';
    }
});

document.getElementById('manualPasteBtn').addEventListener('click', () => {
    const area = document.getElementById('manualInputArea');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('processManualBtn').addEventListener('click', () => {
    const text = document.getElementById('manualText').value;
    const statusDiv = document.getElementById('status');
    if (!text.trim()) {
        statusDiv.textContent = 'Please paste some text first.';
        return;
    }
    
    statusDiv.textContent = 'Processing manual text...';
    chrome.runtime.sendMessage({ action: 'startManualAutomation', text: text }, (response) => {
        if (chrome.runtime.lastError) {
            statusDiv.textContent = 'Error: ' + chrome.runtime.lastError.message;
        } else {
            statusDiv.textContent = 'Prompt sent to ChatGPT!';
        }
    });
});
