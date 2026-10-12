// background.js

let flexyWorkTabId = null;
let chatGPTTabId = null;

// Initialize state from storage in case of service worker restart
chrome.runtime.onStartup.addListener(restoreState);
chrome.runtime.onInstalled.addListener(restoreState);

async function restoreState() {
    const data = await chrome.storage.local.get(['flexyWorkTabId', 'chatGPTTabId']);
    if (data.flexyWorkTabId) flexyWorkTabId = data.flexyWorkTabId;
    if (data.chatGPTTabId) chatGPTTabId = data.chatGPTTabId;
    console.log('State restored:', { flexyWorkTabId, chatGPTTabId });
}

// Helper to save state
async function saveState(state) {
    if (state.flexyWorkTabId !== undefined) flexyWorkTabId = state.flexyWorkTabId;
    if (state.chatGPTTabId !== undefined) chatGPTTabId = state.chatGPTTabId;
    await chrome.storage.local.set({ flexyWorkTabId, chatGPTTabId });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startAutomation') {
        startFlow();
        sendResponse({ status: 'started' });
    } else if (message.action === 'startManualAutomation') {
        startFlow(message.text);
        sendResponse({ status: 'started' });
    } else if (message.action === 'jsonReady') {
        handleJsonReady(message.data);
    } else if (message.action === 'debugExtraction') {
        debugExtraction(sendResponse);
    }
    return true;
});

async function debugExtraction(sendResponse) {
    try {
        const tabs = await chrome.tabs.query({ url: '*://dashboard.flexywork.in/*' });
        const flexyTab = tabs.find(t => t.active) || tabs[0];
        if (!flexyTab) {
            sendResponse({ error: 'FlexyWork tab not found' });
            return;
        }
        
        updateStatus('Thorough frame scan...');
        const frames = await chrome.webNavigation.getAllFrames({ tabId: flexyTab.id });
        const results = await Promise.all(frames.map(async (frame) => {
            try {
                const res = await chrome.scripting.executeScript({
                    target: { tabId: flexyTab.id, frameIds: [frame.frameId] },
                    func: () => {
                        if (typeof extractResumeText === 'function') {
                            return extractResumeText();
                        }
                        return null;
                    }
                });
                return res[0] ? res[0].result : null;
            } catch (e) {
                return null;
            }
        }));

        const allTexts = results
            .filter(r => r && r.text)
            .map(r => r.text);
        
        const combinedText = allTexts.join('\n\n').trim();
        sendResponse({ text: combinedText });
    } catch (e) {
        sendResponse({ error: e.message });
    }
}

// Helper to update status
function updateStatus(text, isError = false) {
    console.log(`Status: ${text}`);
    chrome.runtime.sendMessage({ action: 'statusUpdate', text, isError }).catch(() => {
        // Popup might be closed, ignore
    });
}

async function startFlow(manualText = null) {
    updateStatus('Initializing...');
    try {
        // 1. Preparation Delay (3s) - Wait for PDF viewer to settle
        if (!manualText) {
            for (let i = 3; i > 0; i--) {
                updateStatus(`Preparing in ${i}s...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // 2. Identify FlexyWork tab
        const tabs = await chrome.tabs.query({ url: '*://dashboard.flexywork.in/*' });
        const flexyTab = tabs.find(t => t.active) || tabs[0];
        
        if (!flexyTab) {
            updateStatus('Open FlexyWork first', true);
            return;
        }
        flexyWorkTabId = flexyTab.id;
        await saveState({ flexyWorkTabId });

        let resumeText = manualText;

        // 3. Extract Text (if not manual)
        if (!resumeText) {
            updateStatus('Thorough frame scan...');
            const frames = await chrome.webNavigation.getAllFrames({ tabId: flexyWorkTabId });
            const results = await Promise.all(frames.map(async (frame) => {
                try {
                    const res = await chrome.scripting.executeScript({
                        target: { tabId: flexyWorkTabId, frameIds: [frame.frameId] },
                        func: () => {
                            if (typeof extractResumeText === 'function') {
                                return extractResumeText();
                            }
                            return null;
                        }
                    });
                    return res[0] ? res[0].result : null;
                } catch (e) { return null; }
            }));

            const allTexts = results.filter(r => r && r.text).map(r => r.text);
            resumeText = allTexts.join('\n\n').trim();

            if (!resumeText || resumeText.length < 50) {
                updateStatus('Nothing found!', true);
                return;
            }
        }

        // 4. Send to ChatGPT
        updateStatus('Connecting to ChatGPT...');
        const chatTabs = await chrome.tabs.query({ url: '*://chatgpt.com/*' });
        const legacyChatTabs = await chrome.tabs.query({ url: '*://chat.openai.com/*' });
        const allChatTabs = [...chatTabs, ...legacyChatTabs];

        if (allChatTabs.length === 0) {
            updateStatus('Opening ChatGPT...');
            const newTab = await chrome.tabs.create({ url: 'https://chatgpt.com' });
            chatGPTTabId = newTab.id;
        } else {
            chatGPTTabId = allChatTabs[0].id;
        }
        
        await saveState({ chatGPTTabId });
        await chrome.tabs.update(chatGPTTabId, { active: true });
        
        // Wait for tab transition and injection
        await new Promise(resolve => setTimeout(resolve, 2000));
        await ensureContentScriptLoaded(chatGPTTabId);

        updateStatus('Analyzing with AI...');
        await chrome.tabs.sendMessage(chatGPTTabId, { 
            action: 'injectPrompt', 
            resumeText: resumeText 
        });

    } catch (err) {
        updateStatus('Flow Error: ' + err.message, true);
        console.error('Flow Error:', err);
    }
}

async function ensureContentScriptLoaded(tabId) {
    let retries = 5;
    while (retries > 0) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            if (response && response.status === 'pong') return true;
        } catch (e) {
            try {
                const tab = await chrome.tabs.get(tabId);
                const scriptFile = (tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com')) ? 'content_chatgpt.js' : 'content_flexywork.js';
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: [scriptFile]
                });
            } catch (inner) {}
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries--;
    }
    throw new Error(`Content script not ready on tab ${tabId}`);
}

async function handleJsonReady(jsonData) {
    updateStatus('Data received!');
    try {
        // Redirection Delay (3s countdown)
        for (let i = 3; i > 0; i--) {
            updateStatus(`Redirecting in ${i}s...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!flexyWorkTabId) await restoreState();

        if (flexyWorkTabId) {
            const TARGET_URL = 'https://myfreelancer.in/user/new-resume';
            updateStatus('Returning to FlexyWork...');
            
            const tab = await chrome.tabs.get(flexyWorkTabId);
            if (tab.url !== TARGET_URL) {
                await chrome.tabs.update(flexyWorkTabId, { url: TARGET_URL, active: true });
                await new Promise((resolve) => {
                    const listener = (tabId, info) => {
                        if (tabId === flexyWorkTabId && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            resolve();
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 8000);
                });
            } else {
                await chrome.tabs.update(flexyWorkTabId, { active: true });
            }

            await new Promise(resolve => setTimeout(resolve, 3000)); // Framework wait
            updateStatus('Filling form...');
            await chrome.tabs.sendMessage(flexyWorkTabId, { action: 'fillForm', data: jsonData });
            updateStatus('Done!');
        }
    } catch (err) {
        updateStatus('Return Error: ' + err.message, true);
    }
}
