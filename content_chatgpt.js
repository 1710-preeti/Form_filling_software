// content_chatgpt.js

const EXTRACTION_PROMPT_TEMPLATE = `
You are a strict rule-based resume extraction engine. Extract data ONLY from the attached resume content. 

STRICT RULES:
1. first_name & last_name: Write as given. If both Capital and Small case exist, choose any one.
2. middle_name: Extract from Full Name. If Father's Name exists, use Father's First Name as Middle Name.
3. dob: Format DD-MM-YYYY or DD/MM/YYYY only.
4. gender: Infer from name if not given.
5. nationality & landmark: Use "NA" if not found.
6. marital_status: Extract from resume. If "Marriage Date" exists, set to "Married".
7. passport: Number only.
8. hobbies & languages_known: One line, separated by comma and space.
9. address: DO NOT include Post Office, Taluka, Tehsil, City, State, Pincode, or Country. Use Permanent Address if multiples exist.
10. city, state, pincode: Extract from Permanent Address.
11. mobile: 10-digit number only. If multiple, separate with comma and space.
12. email: Use exactly as given. If multiple, separate with comma and space.
13. SSC, HSC, Graduation, Post-Graduation:
    - Result: Preference order: Percentage > Grade > Division/Class. If "Passed" mentioned, use "PASS".
    - Board/University: Use full name. NO School/College name.
    - Year: Passing year only (4 digits). Remove Month/Date.
    - For HSC: Include Diploma details if present. If both exist, separate with comma and space.
    - Multiple Grad/PG: Separate each with comma and space.
14. higher_level_education: The highest degree attained.
15. total_work_experience: Calculate from resume (Years or Months). Use 0 for freshers.
16. no_of_companies: Number of companies worked for. Use 0 for freshers.
17. last_employer: Preference: Currently working company > Last working company.
18. objective: Use Resume Objective, vision, or goal info.

IMPORTANT: Use "NA" for unavailable fields. Return VALID JSON ONLY. No markdown, no notes.

JSON Structure:
{
"first_name":"", "middle_name":"", "last_name":"", "dob":"", "gender":"", "nationality":"", "marital_status":"", "passport":"", "hobbies":"", "languages_known":"", "address":"", "landmark":"", "city":"", "state":"", "pincode":"", "mobile":"", "email":"", "ssc_result":"", "ssc_board":"", "ssc_year":"", "hsc_result":"", "hsc_board":"", "hsc_year":"", "graduation_degree":"", "graduation_result":"", "graduation_university":"", "graduation_year":"", "post_graduation_degree":"", "post_graduation_result":"", "post_graduation_university":"", "post_graduation_year":"", "higher_level_education":"", "total_work_experience":"", "total_work_experience_months":"", "no_of_companies":"", "last_employer":"", "objective":""
}

RESUME CONTENT:
[RESUME_TEXT_HERE]
`;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('ChatGPT Content Script received action:', message.action);
    
    if (message.action === 'ping') {
        sendResponse({ status: 'pong' });
        return true;
    }

    if (message.action === 'injectPrompt') {
        try {
            injectPrompt(message.resumeText);
            sendResponse({ status: 'injected' });
            watchForResponse();
        } catch (err) {
            console.error('Injection error:', err);
            sendResponse({ error: err.message });
        }
    }
    return true;
});

function injectPrompt(resumeText) {
    console.log('Injecting prompt...');
    const fullPrompt = EXTRACTION_PROMPT_TEMPLATE.replace('[RESUME_TEXT_HERE]', resumeText);
    
    const selectors = [
        '#prompt-textarea', 
        'textarea[placeholder*="ChatGPT"]', 
        'div[contenteditable="true"]',
        '[data-placeholder*="ChatGPT"]'
    ];
    
    let inputEl = null;
    for (const selector of selectors) {
        inputEl = document.querySelector(selector);
        if (inputEl) {
            console.log('Found input element with selector:', selector);
            break;
        }
    }

    if (inputEl) {
        if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
            inputEl.value = fullPrompt;
        } else {
            inputEl.innerText = fullPrompt;
        }
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`Prompt injected successfully (Text length: ${resumeText.length})`);
        console.log('FULL PROMPT:', fullPrompt);
        console.log('Target input element:', inputEl);

        // Trigger the send button after a slightly longer delay for stability
        setTimeout(() => {
            const sendSelectors = [
                'button[data-testid*="send"]',
                'button[aria-label*="Send"]',
                'button:has(svg[viewBox*="24 24"])',
                '[data-placeholder*="ChatGPT"] + button',
                'div[contenteditable="true"] + button',
                'button.absolute.bottom-1.5'
            ];
            
            let sendBtn = null;
            for (const selector of sendSelectors) {
                sendBtn = document.querySelector(selector);
                if (sendBtn && !sendBtn.disabled) {
                    console.log('Found send button with selector:', selector);
                    break;
                }
            }

            if (sendBtn) {
                console.log('Clicking send button...');
                sendBtn.click();
            } else {
                // Fallback: press Enter in the input element
                console.log('Send button not found, trying Enter key fallback...');
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                inputEl.dispatchEvent(enterEvent);
            }
        }, 800);
    } else {
        console.error('ChatGPT input element not found');
    }
}

function watchForResponse() {
    console.log('Started watching for ChatGPT response...');
    let settleTimer = null;
    let lastValidJson = null;
    
    const observer = new MutationObserver((mutations) => {
        // Collect ALL markdown content from the page
        const mdBlocks = Array.from(document.querySelectorAll('.markdown'));
        if (mdBlocks.length === 0) return;

        // We only care about the very last exchange. 
        // We look for a block that isn't the prompt (prompt had "STRICT RULES")
        // Actually, just find the last block that reasonably looks like it contains JSON.
        let text = "";
        for (let i = mdBlocks.length - 1; i >= 0; i--) {
            const content = mdBlocks[i].innerText;
            if (content.includes('{') && content.includes('}')) {
                text = content;
                break;
            }
        }

        if (!text) return;

        // Strip markdown markers
        text = text.replace(/```json/g, '').replace(/```/g, '');
        
        // Find the outermost JSON object
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const potentialJson = text.substring(firstBrace, lastBrace + 1).trim();
            try {
                const jsonData = JSON.parse(potentialJson);
                lastValidJson = jsonData;
                
                if (settleTimer) clearTimeout(settleTimer);
                
                // Once we have a valid JSON, wait for it to stop shifting (settle)
                settleTimer = setTimeout(() => {
                    console.log('Final JSON captured and settled.');
                    observer.disconnect();
                    chrome.runtime.sendMessage({ 
                        action: 'jsonReady', 
                        data: lastValidJson
                    });
                }, 1500); 
            } catch (e) {
                // Incomplete JSON, keep waiting for mutations
            }
        }
    });

    const target = document.querySelector('main') || document.body;
    observer.observe(target, { childList: true, subtree: true, characterData: true });
}
