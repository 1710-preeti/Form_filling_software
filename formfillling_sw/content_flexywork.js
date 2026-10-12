// content_flexywork.js

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('FlexyWork Content Script received action:', message.action);
    
    if (message.action === 'ping') {
        sendResponse({ status: 'pong' });
        return true;
    }

    if (message.action === 'extractResumeText') {
        try {
            const text = extractResumeText();
            sendResponse({ text: text });
        } catch (err) {
            sendResponse({ error: err.message });
        }
    } else if (message.action === 'fillForm') {
        try {
            fillForm(message.data);
            sendResponse({ status: 'filled' });
        } catch (err) {
            sendResponse({ error: err.message });
        }
    }
    return true;
});

function extractResumeText() {
    const walker = document.createTreeWalker(document.body || document, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const tag = node.parentElement ? node.parentElement.tagName : '';
            const skip = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS'];
            return skip.includes(tag) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
    }, false);

    let node;
    let gathered = "";
    while (node = walker.nextNode()) {
        const val = node.textContent.trim();
        if (val.length > 1) gathered += val + " ";
    }
    return { text: gathered.trim() };
}

async function fillForm(data) {
    if (!data) return;
    console.log('--- STARTING ROBUST FORM FILL ---');
    
    const fillLogs = [];
    const report = () => {
        console.table(fillLogs);
        const failed = fillLogs.filter(l => l.status === 'FAILED');
        if (failed.length > 0) console.warn('Failures:', failed.map(f => f.field).join(', '));
    };

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

    const setValue = (el, value, fieldName) => {
        if (!el || value === undefined) return;
        const val = (value === "NA" || value === null) ? "" : String(value).trim();
        
        try {
            el.focus();
            el.click();
            
            if (el.tagName === 'SELECT') {
                const options = Array.from(el.options);
                const valLower = val.toLowerCase();
                let match = options.find(o => o.text.toLowerCase().trim() === valLower || o.value.toLowerCase().trim() === valLower);
                if (!match) match = options.find(o => o.text.toLowerCase().includes(valLower) || o.value.toLowerCase().includes(valLower));
                
                if (match) {
                    el.value = match.value;
                    fillLogs.push({ field: fieldName, status: 'SUCCESS', value: val, method: 'Select' });
                } else if (el.required && options.length > 1) {
                    el.selectedIndex = 1;
                    fillLogs.push({ field: fieldName, status: 'WARNING', value: val, method: 'SelectDefault' });
                } else {
                    fillLogs.push({ field: fieldName, status: 'FAILED', value: val, method: 'NoMatch' });
                }
            } else {
                const setter = el.tagName === 'TEXTAREA' ? nativeTextAreaValueSetter : nativeInputValueSetter;
                if (setter) setter.call(el, val); else el.value = val;
                fillLogs.push({ field: fieldName, status: 'SUCCESS', value: val, method: 'Direct' });
            }

            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch (e) {
            fillLogs.push({ field: fieldName, status: 'ERROR', value: val, detail: e.message });
        }
    };

    const findElementByLabel = (doc, labelText) => {
        const cleanLabel = labelText.toLowerCase().trim().replace(/:$/, '');
        
        const labels = Array.from(doc.querySelectorAll('label'));
        for (const label of labels) {
            const text = label.innerText.toLowerCase().trim().replace(/:$/, '');
            if (text === cleanLabel || text.includes(cleanLabel)) {
                if (label.htmlFor) {
                    const el = doc.getElementById(label.htmlFor);
                    if (el) return el;
                }
                const input = label.querySelector('input, select, textarea');
                if (input) return input;
                
                let next = label.nextElementSibling;
                for (let i = 0; i < 3 && next; i++) {
                    const found = next.querySelector('input, select, textarea') || (['INPUT', 'SELECT', 'TEXTAREA'].includes(next.tagName) ? next : null);
                    if (found) return found;
                    next = next.nextElementSibling;
                }
            }
        }
        
        const potential = Array.from(doc.querySelectorAll('div, span, b, strong, td, th, p, h1, h2, h3, h4, h5, h6'));
        for (const el of potential) {
            const text = el.innerText.toLowerCase().trim().replace(/:$/, '');
            if (text === cleanLabel || (text.length < 40 && text.includes(cleanLabel))) {
                let curr = el;
                for (let i = 0; i < 3 && curr; i++) {
                    const found = curr.querySelector('input, select, textarea');
                    if (found && found !== el) return found;
                    let sib = curr.nextElementSibling;
                    for (let j = 0; j < 2 && sib; j++) {
                        const sInput = sib.querySelector('input, select, textarea') || (['INPUT', 'SELECT', 'TEXTAREA'].includes(sib.tagName) ? sib : null);
                        if (sInput) return sInput;
                        sib = sib.nextElementSibling;
                    }
                    curr = curr.parentElement;
                }
            }
        }
        return null;
    };

    const fieldMapping = {
        'first_name': ['First Name', 'Firstname', 'fname'],
        'middle_name': ['Middle Name', 'Middlename', 'mname'],
        'last_name': ['Last Name', 'Lastname', 'lname'],
        'dob': ['Date Of Birth', 'DOB', 'Birth'],
        'gender': ['Gender', 'Sex'],
        'nationality': ['Nationality'],
        'marital_status': ['Marital Status', 'Marriage'],
        'passport': ['Passport'],
        'hobbies': ['Hobbies'],
        'languages_known': ['Language Known', 'Languages'],
        'address': ['Address', 'Permanent Address'],
        'landmark': ['Landmark'],
        'city': ['City'],
        'state': ['State'],
        'pincode': ['Pincode', 'Pin Code', 'Zip'],
        'mobile': ['Mobile', 'Phone', 'Contact'],
        'email': ['Email'],
        'ssc_result': ['SSC Result', '10th Result', 'SSC Percentage', 'SSC Marks'],
        'ssc_board': ['SSC Board', '10th Board'],
        'ssc_year': ['SSC Pass Year', 'SSC Year', '10th Year'],
        'hsc_result': ['HSC Result', '12th Result', 'Diploma Result'],
        'hsc_board': ['HSC Board', '12th Board', 'Diploma Board'],
        'hsc_year': ['HSC Pass Year', 'HSC Year', '12th Year'],
        'graduation_degree': ['Graduation Degree', 'Grad Degree'],
        'graduation_result': ['Graduation Result', 'Graduation Percentage'],
        'graduation_university': ['Graduation University', 'Grad Univ', 'University'],
        'graduation_year': ['Graduation Pass Year', 'Graduation Year'],
        'post_graduation_degree': ['Post Graduation Degree', 'PG Degree'],
        'post_graduation_result': ['Post Graduation Result', 'PG Result'],
        'post_graduation_university': ['Post Graduation University', 'PG Univ'],
        'post_graduation_year': ['Post Graduation Pass Year', 'Post Graduation Year'],
        'higher_level_education': ['Higher Level Education', 'Highest Level'],
        'total_work_experience': ['Total Work Experience In'],
        'total_work_experience_months': ['Total Work Experience (in months)', 'Experience in Months'],
        'no_of_companies': ['No Of Companies'],
        'last_employer': ['Last Employer', 'Current Employer'],
        'objective': ['Objective', 'Goal', 'Summary']
    };

    const normalize = (s) => String(s).toLowerCase().replace(/[\s_-]/g, '');
    const normalizedData = {};
    for (const [k, v] of Object.entries(data)) normalizedData[normalize(k)] = v;

    const docs = [document];
    document.querySelectorAll('iframe').forEach(iframe => {
        try {
            const ifDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (ifDoc) docs.push(ifDoc);
        } catch(e) {}
    });

    for (const [key, keywords] of Object.entries(fieldMapping)) {
        const value = normalizedData[normalize(key)];
        if (value && value !== "NA") {
            let element = null;
            for (const doc of docs) {
                for (const kw of keywords) {
                    element = findElementByLabel(doc, kw);
                    if (element) break;
                }
                if (!element) {
                    for (const kw of keywords) {
                        const sel = `input[name*="${kw}" i], input[id*="${kw}" i], input[placeholder*="${kw}" i], select[name*="${kw}" i], select[id*="${kw}" i], textarea[name*="${kw}" i], textarea[id*="${kw}" i]`;
                        try { element = doc.querySelector(sel); } catch(e) {}
                        if (element) break;
                    }
                }
                if (element) break;
            }

            if (element) {
                setValue(element, value, key);
            } else {
                fillLogs.push({ field: key, status: 'FAILED', value: value, method: 'NotFound' });
            }
            await new Promise(r => setTimeout(r, 100)); // 100ms delay for stability
        }
    }
    report();
    
    setTimeout(() => {
        const saveBtn = Array.from(document.querySelectorAll('button, input[type="button"], a.btn'))
            .find(btn => (btn.innerText + (btn.value || '')).toLowerCase().includes('save resume'));
        if (saveBtn) saveBtn.click();
    }, 2000);
}
