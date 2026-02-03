let activeSession = null, questions = [], qIndex = 0, qTimer, totalTimer, autoSaveInterval, questionDurationTimer;
let totalSeconds = 0, qSecondsLeft = 0;
let recentHistory = JSON.parse(localStorage.getItem("QUIZ_HISTORY") || "[]");

window.onload = () => {
    renderRecentQuizzes();
    document.querySelector('.app-container').classList.remove('quiz-mode');
};

/* --- ROBUST VISIBILITY HANDLER --- */
function handleAppVisibility() {
    if (document.hidden) {
        // User left the tab -> Pause
        pauseAllTimers();
    } else {
        // User is back -> Resume (only if quiz is in progress)
        if (activeSession && activeSession.status === "in-progress") {
            // Small delay ensures browser is fully ready
            setTimeout(() => resumeAllTimers(), 100);
        }
    }
}

document.addEventListener('visibilitychange', handleAppVisibility);

// Backup: Ensure timers resume when window regains focus (fixes frozen timer bug)
window.addEventListener('focus', () => {
    if (!document.hidden && activeSession && activeSession.status === "in-progress") {
        resumeAllTimers();
    }
});

function pauseAllTimers() { clearInterval(qTimer); clearInterval(totalTimer); clearInterval(questionDurationTimer); }
function resumeAllTimers() { startTotalTimer(); trackQuestionTime(); resumeQuestionTimer(); }
function updateFileName(input, displayId) { 
    if(input.files.length > 1) document.getElementById(displayId).innerText = `${input.files.length} Files Selected`;
    else document.getElementById(displayId).innerText = input.files[0]?.name || "Select File"; 
}

/* --- UI PREFERENCES & TOGGLES --- */
function toggleSidebarView() {
    const container = document.querySelector('.app-container');
    const showBtn = document.getElementById('showSidebarBtn');
    container.classList.toggle('collapsed');
    if (container.classList.contains('collapsed')) {
        showBtn.classList.remove('hidden');
    } else {
        showBtn.classList.add('hidden');
    }
}

function changeFontSize(size) {
    if(!size || size < 10) return;
    document.documentElement.style.setProperty('--q-font-size', size + 'px');
}

function changeExpFontSize(size) {
    if(!size || size < 10) return;
    document.documentElement.style.setProperty('--exp-font-size', size + 'px');
}

function changeFontFamily(font) {
    document.documentElement.style.setProperty('--q-font-family', font);
}

// NEW: Dynamically adjust Sidebar Width
function changeSidebarWidth(val) {
    // Validate input (prevent breaking layout completely)
    if (!val || val < 5 || val > 90) return;
    
    // Calculate Question Panel Width (100 - Side Width)
    const qpWidth = 100 - val;
    
    document.documentElement.style.setProperty('--qp-width', qpWidth + '%');
}

/* --- HELPER: SMART FILENAME GENERATOR --- */
function generateSmartFilename(source) {
    let names = [];
    
    // 1. Handle Input: Can be FileList (from upload) or Array of Strings (from questions)
    if (source instanceof FileList) {
        names = Array.from(source).map(f => f.name.replace(/\.[^/.]+$/, ""));
    } else if (Array.isArray(source)) {
        names = source;
    } else {
        return "Quiz_Session";
    }

    // 2. Process each name
    const abbreviations = names.map(name => {
        const cleanName = name.trim();
        if(!cleanName) return "Q";

        // A. Get First Letter (The Subject Code: P, G, E, C)
        const firstLetter = cleanName.charAt(0).toUpperCase();
        
        // B. Check for Numbers
        const numbers = cleanName.match(/\d+/g);

        if (numbers) {
            // Case 1: Numbers found (Polity_CH1 -> P1, Geo_CH-14 -> G14)
            return firstLetter + numbers.join('');
        } else {
            // Case 2: No numbers (CA_july -> C + J + y -> CJy)
            const parts = cleanName.split('_');
            
            if (parts.length > 1) {
                // Has underscore: use suffix logic
                const suffix = parts[parts.length - 1]; // "july"
                const sFirst = suffix.charAt(0).toUpperCase(); // "J"
                const sLast = suffix.slice(-1); // "y"
                return firstLetter + sFirst + sLast;
            } else {
                // Single word (History -> H + y -> Hy)
                return firstLetter + cleanName.slice(-1);
            }
        }
    });

    return abbreviations.join('_');
}

/* --- SESSION MGMT --- */
function startNewSession() {
  const fileInput = document.getElementById("fileInput");
  const files = fileInput.files;
  if (files.length === 0) return alert("Please select at least one JSON file.");

  const limitInput = document.getElementById("limitInput").value;
  const shouldShuffle = document.getElementById("shuffleToggle").checked;
  
  // 1. Capture the new toggle state
  const showOutdatedOnly = document.getElementById("outdatedOnlyToggle").checked;

  const userMark = parseFloat(document.getElementById("markInput").value) || 1.33;
  const userNeg = parseFloat(document.getElementById("negInput").value) || 0.45;

  let allQuestions = [];
  
  // LOGIC: Smart Name Generation
  const smartName = generateSmartFilename(files);

  const readFile = (file) => {
      return new Promise((resolve) => {
          const r = new FileReader();
       r.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                let rawList = [];

                if (Array.isArray(json)) rawList = json;
                else if (json.questions && Array.isArray(json.questions)) rawList = json.questions;
                else if (json.data && Array.isArray(json.data)) rawList = json.data;
                
                // --- MODIFIED BLOCK START ---
                
                // 1. Capture the universal 'section' key from the file root (if it exists)
                const rootSection = json.section || null;
                
                // 2. Capture the filename base
                const fileNameBase = file.name.replace(/\.[^/.]+$/, ""); 

                const formatted = rawList.map(q => {
                    // 3. PRIORITY ASSIGNMENT:
                    // First check 'q.section' (per question)
                    // Then check 'rootSection' (universal file key)
                    // Finally fallback to 'fileNameBase'
                    let rawSection = q.section || rootSection || fileNameBase;

                // --- MODIFIED BLOCK END ---

                    if (rawSection && typeof rawSection === 'string') {
                        const parts = rawSection.split(/[\s_-]+/).filter(Boolean);
                        rawSection = parts.join('_');
                    }

                    return {
                        q: q.q || q.question,
                        options: q.options,
                        answer: (q.answer || q.answer_key || "").toUpperCase(),
                        explanation: q.explanation || "",
                        section: rawSection, 
                        source: q.source || q.src || "", 
                        sel: null, flag: false, guess: false,
                        outdated: q.outdated || false, // Ensure boolean
                        isEdited: q.isEdited || false,
                        notes: "", timeSpent: 0
                    };
                })
                // 2. UPDATED FILTER LOGIC
                .filter(q => {
                    if (showOutdatedOnly) {
                        return q.outdated === true; // Show ONLY outdated
                    } else {
                        return q.outdated !== true; // Show ONLY fresh (default)
                    }
                });

                resolve(formatted);
            } catch (err) {
                console.error("Error parsing JSON:", file.name, err);
                resolve([]);
            }
        };
          r.readAsText(file);
      });
  };

  Promise.all(Array.from(files).map(readFile)).then(results => {
      allQuestions = results.flat();
      
      // Alert specific to the mode
      if (allQuestions.length === 0) {
          if (showOutdatedOnly) return alert("No outdated questions found in selected files.");
          return alert("No valid questions found.");
      }

      if (shouldShuffle) shuffleArray(allQuestions);
      
      let activeQ = [], unusedQ = [];
      const limit = parseInt(limitInput);
      if (!isNaN(limit) && limit > 0 && limit < allQuestions.length) {
          activeQ = allQuestions.slice(0, limit);
          unusedQ = allQuestions.slice(limit);
      } else {
          activeQ = [...allQuestions];
          unusedQ = [];
      }

      activeSession = { 
          status: "in-progress", 
          // 3. Update Title to reflect mode
          title: (files.length > 1 ? "Multi-Section Session" : smartName) + (showOutdatedOnly ? " [OUTDATED]" : ""),
          originalFileName: smartName, 
          questions: activeQ,
          unusedQuestions: unusedQ,
          qIndex: 0, totalSeconds: 0,
          settings: { time: 60, mark: userMark, neg: userNeg }
      };
      saveAndLoad();
  });
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/* --- RESUME LOGIC --- */
function initiateSyncImport() {
    const input = document.getElementById('importInput');
    updateFileName(input, 'syncNameDisplay');
}

function startResumeSession() {
    const f = document.getElementById('importInput').files[0];
    if(!f) return alert("Please select a Sync File first.");

    const r = new FileReader();
    r.onload = (e) => {
        try {
            const tempSyncData = JSON.parse(e.target.result);
            const mode = document.querySelector('input[name="resumeMode"]:checked').value;
            const doShuffle = document.getElementById('resumeShuffle').checked;
            const resumeLimitInput = document.getElementById('resumeLimit').value; 

            let previousActive = tempSyncData.questions || [];
            let previousUnused = tempSyncData.unusedQuestions || [];
            
            const fallbackSection = (!tempSyncData.originalFileName || !tempSyncData.originalFileName.includes("_")) ? (tempSyncData.originalFileName || "General") : "General";
            const patchSection = (q) => { if(!q.section) q.section = fallbackSection; return q; };
            previousActive = previousActive.map(patchSection);
            previousUnused = previousUnused.map(patchSection);

            const masterPool = [...previousActive, ...previousUnused].filter(q => q.outdated !== true);
            let candidateQ = [];
            let remainingPool = [];

            if (mode === 'fresh') {
                candidateQ = masterPool.filter(q => q.sel === null);
                remainingPool = masterPool.filter(q => q.sel !== null);
            } 
            else if (mode === 'all_attempted') {
                candidateQ = masterPool;
                remainingPool = []; 
            }
            else if (mode === 'weakness') {
                candidateQ = masterPool.filter(q => (q.sel && q.sel !== q.answer) || q.guess === true);
                remainingPool = masterPool.filter(q => !((q.sel && q.sel !== q.answer) || q.guess === true));
            }

            if(candidateQ.length === 0) return alert("No questions match your selection criteria!");
            
            if (mode === 'weakness' || mode === 'all_attempted') {
                candidateQ.forEach(q => {
                    q.sel = null;
                    q.flag = false;
                    q.guess = false;
                    q.timeSpent = 0;
                });
            }

            if (doShuffle) shuffleArray(candidateQ);

            let activeQ = [];
            const limit = parseInt(resumeLimitInput);
            
            if (!isNaN(limit) && limit > 0 && limit < candidateQ.length) {
                activeQ = candidateQ.slice(0, limit);
                const overflow = candidateQ.slice(limit);
                remainingPool = [...remainingPool, ...overflow];
            } else {
                activeQ = candidateQ;
            }

            activeSession = {
                ...tempSyncData, 
                status: "in-progress", 
                questions: activeQ,
                unusedQuestions: remainingPool,
                qIndex: 0
            };
            saveAndLoad();
        } catch(err) { console.error(err); alert("Invalid Sync File"); }
    };
    r.readAsText(f);
}

function saveAndLoad() { saveToHistory(); loadSession(); }

function loadSession() {
  document.querySelector('.app-container').classList.add('quiz-mode');
  questions = activeSession.questions; qIndex = activeSession.qIndex || 0; totalSeconds = activeSession.totalSeconds || 0;
  startTotalTimer(); loadQuestion();
  clearInterval(autoSaveInterval);
  autoSaveInterval = setInterval(autoSave, 5000); 
}

/* --- FORMATTING & TEXT --- */
function formatQuestionText(text) {
    if (!text) return "";
    
    // ============================================================
    // 1. MATCH LIST LOGIC (PRESERVED)
    // ============================================================
    if (/match/gi.test(text) && /list[- ]?I/gi.test(text)) {
        let headerText = "", processingText = text;
        const colonIdx = processingText.indexOf(':');
        if (colonIdx > -1 && colonIdx < processingText.length - 1) {
             headerText = processingText.substring(0, colonIdx + 1); 
             processingText = processingText.substring(colonIdx + 1); 
        }
        processingText = processingText.replace(/<br>/gi, '\n');
        const bulletRegex = /(\s*-\s*|\s+)(\(?([A-Za-z]+|\d+|[IVXivx]+)[\.\)])/g;
        processingText = processingText.replace(bulletRegex, '\n$2');

        let lines = processingText.split('\n');
        let col1 = [], col2 = [], otherText = [];
        let list1Type = null;
        const getBulletType = (str) => {
            str = str.trim();
            if (/^\(?\d+[\.\)]/.test(str)) return "numeric";
            if (/^\(?[IVXivx]+[\.\)]/.test(str)) return "roman";
            if (/^\(?[A-Za-z]+[\.\)]/.test(str)) return "alpha";
            return null;
        };

        lines.forEach(line => {
            let trimmed = line.trim()
                .replace(/^["“'”]\s*>/, "").replace(/&quot;\s*>/, "").replace(/^>\s*/, "").trim();
            if (!trimmed) return;
            let currentType = getBulletType(trimmed);
            if (currentType) {
                if (!list1Type) list1Type = currentType;
                if (currentType === list1Type) col1.push(trimmed.replace(/\s*-\s*$/, '')); 
                else col2.push(trimmed);
            } else otherText.push(line);
        });

        if (col1.length > 0 && col2.length > 0) {
            let matchHtml = '<div class="match-container"><div class="match-column">';
            col1.forEach(item => matchHtml += `<div>${item}</div>`);
            matchHtml += '</div><div class="match-column">';
            col2.forEach(item => matchHtml += `<div>${item}</div>`);
            matchHtml += '</div></div>';
            return headerText + (headerText ? '<br>' : '') + matchHtml + (otherText.length ? '<br>' + otherText.join('<br>') : '');
        }
    }

    // ============================================================
    // 2. HELPER: SMART LINE BREAKER (Character-by-Character)
    // ============================================================
    // Scans string and inserts <br> after sentences, respecting quotes/brackets.
    function insertSmartBreaks(str) {
        let res = "";
        let inDouble = false;   // "..."
        let inSingle = false;   // '...' or ‘...’
        let inParen = 0;        // (...)
        let inBracket = 0;      // [...]
        
        const len = str.length;
        // Common abbreviations to protect (don't break at "Mr.")
        const abbrs = ['mr', 'ms', 'dr', 'prof', 'st', 'lt', 'capt', 'col', 'gen', 'vs', 'eg', 'ie', 'etc', 'no'];

        for (let i = 0; i < len; i++) {
            const char = str[i];
            res += char; // Always add the current character

            // 1. Update State (Are we inside a protected zone?)
            if (char === '"' || char === '“' || char === '”') { if(!inSingle) inDouble = !inDouble; }
            else if (char === "'" || char === '‘' || char === '’') { if(!inDouble) inSingle = !inSingle; }
            else if (char === '(') { if(!inDouble && !inSingle) inParen++; }
            else if (char === ')') { if(!inDouble && !inSingle && inParen > 0) inParen--; }
            else if (char === '[') { if(!inDouble && !inSingle) inBracket++; }
            else if (char === ']') { if(!inDouble && !inSingle && inBracket > 0) inBracket--; }

            // 2. Check for Sentence End (. ? !)
            // Only if we are NOT inside any quote/paren/bracket
            if (!inDouble && !inSingle && inParen === 0 && inBracket === 0) {
                if (char === '.' || char === '?' || char === '!') {
                    
                    // A. Abbreviation Check (Look behind)
                    let isAbbr = false;
                    for (let word of abbrs) {
                        // Check if previous chars match abbreviation (e.g. " Mr" or "No")
                        // str[i] is '.', so look at str[i-word.length ... i]
                        if (i >= word.length) {
                            const sub = str.substring(i - word.length, i).toLowerCase();
                            // Ensure it's the whole word (preceded by space or start)
                            const charBefore = str[i - word.length - 1];
                            if (sub === word && (!charBefore || /\s/.test(charBefore))) {
                                isAbbr = true;
                                break;
                            }
                        }
                    }
                    if (isAbbr) continue; // Don't break for "Mr."

                    // B. Look Ahead (Don't break if next char is not a Space + Capital/Number)
                    // This prevents breaking decimals "3.14" or "A.B.C" logic
                    // We only want to break if it looks like a new sentence follows.
                    // However, user asked specifically for "line break at end of sentences".
                    // The safest bet is: If followed by Space, insert <br>
                    if (i + 1 < len && /\s/.test(str[i+1])) {
                        res += "<br>"; 
                        // Note: The space loop will add the space after <br>, which is fine (HTML collapses it)
                    }
                }
            }
        }
        return res;
    }

    // ============================================================
    // 3. BULLET-FIRST PARSER
    // ============================================================
    
    // 1. Define Bullet Patterns
    const bulletRegex = /(?:^|\n|\s+)(\(?\d+\.|\(?I{1,3}\.|IV\.|V\.|VI{0,3}\.|IX\.|X\.|\(?[a-zA-Z]\)|\([A-Z]\))\s+/g;
    
    // 2. Scan for all bullets
    const matches = [];
    let match;
    while ((match = bulletRegex.exec(text)) !== null) {
        matches.push({
            symbol: match[1],
            start: match.index, 
            contentStart: match.index + match[0].length 
        });
    }

    // 3. Fallback: No bullets -> Just run Smart Breaker on whole text
    if (matches.length === 0) {
        let simple = text.replace(/(:)\s+/g, '$1<br>');
        simple = insertSmartBreaks(simple);
        return simple.replace(/(<br>){2,}/g, '<br>').replace(/^<br>/, '');
    }

    // 4. Construct Output
    let result = "";

    // A. Intro Text (Before first bullet)
    let intro = text.substring(0, matches[0].start).trim();
    if (intro) {
        intro = intro.replace(/(:)\s+/g, '$1<br>');
        result += intro;
    }

    // B. Loop Bullets
    matches.forEach((m, i) => {
        // Content goes until the NEXT bullet starts
        let nextStart = (i < matches.length - 1) ? matches[i+1].start : text.length;
        
        // Extract content
        let rawContent = text.substring(m.contentStart, nextStart).trim();
        
        // Apply Smart Line Breaks INSIDE the bullet content
        let processedContent = insertSmartBreaks(rawContent);
        
        // Append
        result += `<br><span class="q-point">${m.symbol}&nbsp;</span>${processedContent}`;
    });

    return result.replace(/^(<br>)+/, "");
}

function smartHighlight(text) {
    if (!text) return "";
    let processed = text;

    // 1. HEADING LOGIC (Refined for Case 1-4 + Leading Spaces)
    // - (^\s*): Matches start of text, IGNORING any initial spaces (Fixes "Important Tips..." issue)
    // - ([\.\?!]\s+): Matches after a sentence end
    // - (>\s*): Matches after an HTML tag like <br>
    processed = processed.replace(/(^\s*|[\.\?!]\s+|>\s*)([A-Z][^.:\n<]*?\s*:)(?=\s|<|$)/g, '$1<br><strong class="highlight-term">$2</strong><br>');

    // 2. Format Assertion & Reason (Make them Bold)
    processed = processed.replace(/(Assertion\s*\(?[A-Z]?\)?\s*[:.-]|Reason\s*\(?[A-Z]?\)?\s*[:.-])/gi, '<strong class="highlight-term">$1</strong>');

    // 3. Format Bullet Points
    processed = processed.replace(/([^\n>])\s*([•\-\*])\s+/g, '$1<br><span class="highlight-statement">$2</span> ');
    
    // 4. Format Roman Numerals
    processed = processed.replace(/(\s|^)((?:I{1,3}|IV|V|VI{0,3}|IX|X)\.)\s+/g, '<br><strong>$2</strong> ');

    // 5. Highlight Acts, Articles, Sections
    processed = processed.replace(/(\b\d{4}\b|Article \d+|Section \d+|Schedule \d+|Amendment|Act \d{4})/gi, '<span class="highlight-term">$1</span>');

    // 6. Highlight "Option X is correct"
    processed = processed.replace(/(Option [a-d] is [a-z ]*correct(?: answer)?|Statement \d+ is [a-z ]*correct(?: answer)?|Pair [IVX\d]+ is [a-z ]*correct(?: answer)?|Pair [IVX\d]+ is [a-z ]*incorrect(?: answer)?)/gi, '<span class="highlight-statement">$1</span>');

    // 7. Highlight definitions (Fallback)
    // IMPORTANT: Keep this as fallback, but rely on Logic #1 for the main "Heading: Value" cases.
    processed = processed.replace(/\b([A-Z][a-z]+:)/g, '<span class="definition-header">$1</span>');

    return processed;
}

function processTextSmartly(text) {
    if (!text) return "";
    let processed = text;
    
    // 1. Isolate Formulas
    processed = processed.replace(/([a-zA-Z\s\(\)\$\.]+=[a-zA-Z0-9\s\(\)\+\-\$\.]+)(?=\.|\n|<|$)/g, '||LOGIC_SPLIT||<div class="formula-box">$1</div>||LOGIC_SPLIT||');

    // 2. Isolate Options/Statements
    processed = processed.replace(/(Pair [IVX\d]+ is (?:in)?correct(?: answer)?|Statement \d+ is (?:in)?correct(?: answer)?|Option [a-d] is (?:in)?correct(?: answer)?)/gi, '||LOGIC_SPLIT||$1');

    // 3. Isolate Assertion & Reason
    processed = processed.replace(/(Assertion\s*\(?[A-Z]?\)?\s*[:.-]|Reason\s*\(?[A-Z]?\)?\s*[:.-])/gi, '||LOGIC_SPLIT||$1');

    return processed.split('||LOGIC_SPLIT||').map(s => s.trim()).filter(s => s).map(p => {
        if(p.startsWith('<div')) return p;

        // CHECK LENGTH: If paragraph is huge (>350 chars), break it into sub-paragraphs
        if (p.length > 350) {
            // ---------------------------------------------------------
            // FIX: Protect dots inside parentheses so "c." doesn't break the line
            // We temporarily replace '.' with '{{DOT}}' ONLY inside (...) 
            // ---------------------------------------------------------
            let safeP = p.replace(/\([^)]+\)/g, (m) => m.replace(/\./g, "{{DOT}}"));

            // Now safely split into sentences
            let sentences = safeP.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g);
            
            if(sentences) {
                let chunks = [];
                let currentChunk = "";
                
                sentences.forEach(sent => {
                    // RESTORE the dots immediately for the actual text
                    let realSent = sent.replace(/{{DOT}}/g, ".");
                    
                    if ((currentChunk.length + realSent.length) > 350 && currentChunk.length > 50) {
                        chunks.push(`<p>${smartHighlight(currentChunk)}</p>`);
                        currentChunk = realSent;
                    } else {
                        currentChunk += realSent;
                    }
                });
                
                if(currentChunk) {
                    chunks.push(`<p>${smartHighlight(currentChunk)}</p>`);
                }
                return chunks.join("");
            }
        }

        return `<p>${smartHighlight(p)}</p>`;
    }).join('');
}

function loadQuestion() {
  document.getElementById("home").classList.add("hidden");
  document.getElementById("quiz").classList.remove("hidden");
  document.getElementById("sidebar").classList.remove("hidden");
  document.getElementById("reportView").classList.add("hidden");
  
  const q = questions[qIndex];
  if (typeof q.timeSpent === 'undefined') q.timeSpent = 0;

  // 1. Question Text & Header
  document.getElementById("questionCounter").innerText = `Q${qIndex + 1} / ${questions.length}`;
  const sectionName = q.section || 'General';
const badge = document.getElementById("sectionBadge");
badge.innerText = sectionName;
badge.title = sectionName;
  
  // Add Flag Icon to text if flagged
  let qHtml = (q.flag ? "🚩 " : "") + formatQuestionText(q.q);
  if(q.source && q.source.trim() !== "") qHtml += `<span class="source-tag">Source: ${q.source}</span>`;
  document.getElementById("question").innerHTML = qHtml;

  // 2. Options Generation
  const optionsContainer = document.getElementById("optionsContainer");
  optionsContainer.innerHTML = "";
  
  Object.keys(q.options).forEach(key => {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.innerText = q.options[key];
      const normalizedKey = key.toUpperCase();
      
      // A. Always show "Selected" state (Blue in CSS) if user clicked this
      if (q.sel === normalizedKey) btn.classList.add("selected");
      
      // B. ONLY show Correct/Wrong colors if NOT flagged (Not in Doubt Mode)
      if (q.sel && !q.flag) {
          if (normalizedKey === q.answer) btn.classList.add("correct");
          else if (normalizedKey === q.sel) btn.classList.add("wrong");
      }
      
      // Disable buttons if an option is chosen (prevent changing answer)
      btn.disabled = (q.sel !== null); 
      btn.onclick = () => selectOption(normalizedKey);
      optionsContainer.appendChild(btn);
  });

  // 3. Mark as Guess Checkbox UI
  const guessCheck = document.getElementById("guessCheck");
  guessCheck.checked = q.guess || false;
  guessCheck.disabled = false;

  // 2. Mark as Outdated UI (NEW)
    const outdatedCheck = document.getElementById("outdatedCheck");
    outdatedCheck.checked = q.outdated || false;
    outdatedCheck.disabled = false;

  // 4. Notes UI
  const noteVal = q.notes || "";
  const words = noteVal.trim() ? noteVal.trim().split(/\s+/).length : 0;
  const setNoteUI = (id, countId) => {
      document.getElementById(id).value = noteVal;
      document.getElementById(countId).innerText = `${words}/100`;
  };
  setNoteUI("noteInput", "sidebarWordCount");
  setNoteUI("mobileNoteInput", "mobileWordCount");

  // 5. Feedback / Explanation Section
  const fb = document.getElementById("feedback");
  
  // LOGIC: Show feedback ONLY if an option is selected AND the question is NOT flagged.
  if (q.sel && !q.flag) {
    document.getElementById("feedbackStatus").innerHTML = `<strong class="${q.sel===q.answer?'text-success':'text-danger'}">${q.sel === q.answer ? "✅ Correct" : "❌ Incorrect"}</strong>`;
    
    const fbBody = document.getElementById("feedbackBody");

    // CHECK: Is it a long/complex explanation that hasn't been edited yet?
    // We add '!q.isEdited' because if a user edited it, we ALWAYS want to show their version, regardless of length.
    if (q.explanation && (q.explanation.length > 300 || q.explanation.includes("||TIPS||"))) {
         // Show "Open Full" Link
         fbBody.innerHTML = "<p><i>See detailed analysis below...</i></p>";
         document.getElementById("feedbackLink").innerHTML = `<span class="exp-link" onclick="openExplanationInTab(questions[qIndex].explanation, ${qIndex+1})">📖 Open Full Explanation</span>`;
    } else {
        // RENDER: Either raw beautified text OR user's saved HTML
        if (q.isEdited) {
            // User edited this before -> Trust the HTML exactly (preserves <s> tags and prevents regex breaking them)
            fbBody.innerHTML = q.explanation;
        } else {
            // Never touched -> Apply Smart Beautifier (Regex)
            fbBody.innerHTML = `<div class="beautified-explanation">${processTextSmartly(q.explanation)}</div>`;
        }
        document.getElementById("feedbackLink").innerHTML = ""; 
    }
    fb.classList.remove("hidden");
  } else {
    // Hide feedback if unattempted OR if user is in Flag/Doubt Mode
    fb.classList.add("hidden");
  }

  // 6. Final UI Updates
  updateSidebar(); 
  updateNav(); 
  startQuestionTimer(); 
  trackQuestionTime();
}

function openExplanationInTab(fullExplanation, qNum) {
    const parts = fullExplanation.split("||TIPS||");
    const mainExp = parts[0];
    const tips = parts.length > 1 ? parts[1] : null;

    const win = window.open("", "_blank");
    
    if (!win) {
        return alert("Please allow popups to view the explanation.");
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Q${qNum} Analysis</title>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
    /* GLOBAL RESET */
    * { box-sizing: border-box; }
    
    :root {
        --bg-color: #f8f9fa; --text-color: #2c3e50; --card-bg: #ffffff;
        --highlight-term: #d35400; --highlight-stmt-bg: rgba(39,174,96,0.1); --highlight-stmt-text: #27ae60;
        --tips-bg: #E8F8F5; --tips-border: #1abc9c;
        --btn-bg: #34495e; --danger: #ef4444;
    }
    
    [data-theme="dark"] {
        --bg-color: #0f172a; --text-color: #e2e8f0; --card-bg: #1e293b;
        --highlight-term: #818cf8; --highlight-stmt-bg: rgba(16,185,129,0.2); --highlight-stmt-text: #34d399;
        --tips-bg: #1e293b; --tips-border: #10b981; --btn-bg: #4f46e5;
    }
    
    body { background: var(--bg-color); color: var(--text-color); font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; margin: 0; padding: 20px 0; line-height: 1.6; font-size: 18px; }
    .container { width: 96%; max-width: none; margin: 0 auto; background: var(--card-bg); padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    .header-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; padding-bottom:15px; border-bottom:1px solid #444; }
    h1 { margin:0; font-size:1.4rem; }
    
    .btn { cursor:pointer; padding:6px 12px; border-radius:6px; border:1px solid #555; background:transparent; color:var(--text-color); font-weight:bold; font-size: 0.9rem; }
    .btn:hover { background: rgba(255,255,255,0.1); }
    
    .btn-save { background: transparent; color: #10b981; border: 1px solid #10b981; }
    .btn-save:hover { background: rgba(9, 201, 25, 0.25); }

    /* TOOLBAR BUTTONS */
    .btn-tool {
        background: transparent;           
        border: 1px solid #555;
        color: var(--text-color);            
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.75rem;
        transition: all 0.2s ease;
        margin-right: 5px;
    }
    .btn-tool:hover { background: rgba(255, 255, 255, 0.05); }

    /* Ensure highlights look good */
    span[style*="background-color"] { border-radius: 2px; padding: 0 2px; }
    strike, s, del { text-decoration: line-through; opacity: 0.8; } /* Removed fixed red color */

    .hidden { display: none !important; }
    #editable-content[contenteditable="true"] { border: 2px dashed #666; padding: 10px; border-radius: 8px; outline: none; }
    #editable-content[contenteditable="true"]:focus { border-color: #6366f1; }

    .highlight-term { color:var(--highlight-term); font-weight:bold; }
    .highlight-statement { color:var(--highlight-stmt-text); background:var(--highlight-stmt-bg); padding:2px 6px; border-radius:4px; font-weight:bold; }
    .tips-box { margin-top:25px; background:var(--tips-bg); border-left:5px solid var(--tips-border); padding:15px; border-radius:4px; }
    .toolbar-group { display: flex; gap: 8px; align-items: center; }

    @media (max-width: 600px) { body { font-size: 16px; padding: 10px 0; } .container { width: 96%; padding: 15px; } .btn { padding: 4px 8px; font-size: 0.8rem; } }
</style>
</head>
<body data-theme="dark">
    <div class="container">
        <div class="header-row">
            <h1>Q${qNum} Analysis</h1>
            <div class="toolbar-group">
                <div id="editTools" class="hidden toolbar-group" style="align-items:center;">
                    
                    <button class="btn btn-tool" onclick="applyStrike()" title="Strikethrough"><s>S</s></button>
                    <button class="btn btn-tool" onclick="applyHighlight()" title="Highlight (Acts Style)">🖊</button>
                    
                    <button class="btn btn-save" onclick="saveChildChanges()">✅ Save</button>
                </div>
                
                <button id="editToggleBtn" class="btn" onclick="toggleChildEdit()">✏️ Edit</button>
                <button class="btn" onclick="document.body.setAttribute('data-theme',document.body.getAttribute('data-theme')==='dark'?'light':'dark')">🌗 Theme</button>
            </div>
        </div>

        <div id="editable-content">
            <div>${processTextSmartly(mainExp)}</div>
            ${tips ? `<div class="tips-box"><strong>💡 TIPS:</strong> ${processTextSmartly(tips)}</div>` : ''}
        </div>

        <button class="btn" style="width:100%; margin-top:30px; background:var(--btn-bg); color:white; padding:12px; font-size:1rem;" onclick="window.close()">Close Tab</button>
    </div>

    <script>
        function toggleChildEdit() {
            const el = document.getElementById('editable-content');
            const tools = document.getElementById('editTools');
            const btn = document.getElementById('editToggleBtn');
            const isEditing = el.getAttribute('contenteditable') === 'true';
            
            if(isEditing) {
                el.setAttribute('contenteditable', 'false');
                tools.classList.add('hidden');
                btn.innerText = "✏️ Edit";
            } else {
                el.setAttribute('contenteditable', 'true');
                tools.classList.remove('hidden');
                btn.innerText = "✕ Cancel";
                el.focus();
            }
        }

        // 1. MONOCHROME STRIKETHROUGH (CHILD)
        function applyStrike() {
            document.execCommand('strikeThrough', false, null);
            document.getElementById('editable-content').focus();
        }

        // 2. HIGHLIGHT (ACTS STYLE CHILD)
        function applyHighlight() {
            document.execCommand('bold', false, null);
            document.execCommand('foreColor', false, '#818cf8');
            document.getElementById('editable-content').focus();
        }

        function saveChildChanges() {
            const fullHTML = document.getElementById('editable-content').innerHTML;
            if (window.opener && !window.opener.closed) {
                const success = window.opener.handleChildSave(${qNum}, fullHTML);
                if(success) {
                    toggleChildEdit();
                    alert("✅ Changes saved to main Quiz Session!");
                } else {
                    alert("Error: Could not find question in parent window.");
                }
            } else {
                alert("Error: Main Quiz window seems to be closed. Cannot save.");
            }
        }
    <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(htmlContent);
    win.document.close();
}

function saveCurrentNote(val) { 
    const words = val.trim().split(/\s+/);
    if (words.length > 100) { val = words.slice(0, 100).join(" "); document.getElementById("noteInput").value = val; document.getElementById("mobileNoteInput").value = val; }
    questions[qIndex].notes = val;
    const currentCount = val.trim() ? val.trim().split(/\s+/).length : 0;
    document.getElementById("sidebarWordCount").innerText = `${currentCount}/100`;
    document.getElementById("mobileWordCount").innerText = `${currentCount}/100`;
}

function selectOption(o) { 
    if(questions[qIndex].sel) return; 
    questions[qIndex].sel = o; 
    // REMOVED: questions[qIndex].flag = false; 
    loadQuestion(); 
}
function toggleGuessState() { questions[qIndex].guess = document.getElementById("guessCheck").checked; }
function toggleOutdatedState() {
    const cb = document.getElementById("outdatedCheck");
    
    // CASE 1: User is trying to Check the box (Mark as Outdated)
    if (cb.checked) {
        if (confirm("Mark this question as Outdated?")) {
            // User clicked "OK" - Commit the change
            questions[qIndex].outdated = true;
        } else {
            // User clicked "Cancel" - Revert the visual change immediately
            cb.checked = false; 
            questions[qIndex].outdated = false;
        }
    } 
    // CASE 2: User is Unchecking the box (Removing the tag)
    else {
        // No confirmation needed to remove the tag
        questions[qIndex].outdated = false;
    }
}   

function toggleFlag() { 
    const q = questions[qIndex];
    
    if (q.flag) {
        // UNFLAGGING: If user selected something while flagged, reset it entirely.
        if (q.sel) {
            q.sel = null;   
            q.guess = false; 
        }
        q.flag = false;
    } else {
        // FLAGGING: Turn mode on
        q.flag = true;
    }
    loadQuestion(); 
}
function next() { if(qIndex < questions.length - 1) { qIndex++; loadQuestion(); } }
function prev() { if(qIndex > 0) { qIndex--; loadQuestion(); } }

function startTotalTimer() { clearInterval(totalTimer); totalTimer = setInterval(() => { totalSeconds++; document.getElementById("totalTimer").innerText = `${Math.floor(totalSeconds/60)}:${(totalSeconds%60).toString().padStart(2,'0')}`; }, 1000); }
function startQuestionTimer() { 
    clearInterval(qTimer); 
    
    // Check if currently on the last question
    const isLastQuestion = qIndex === questions.length - 1;
    
    // Apply 5x multiplier if last, otherwise use normal setting
    qSecondsLeft = isLastQuestion ? (activeSession.settings.time * 5) : activeSession.settings.time; 
    
    resumeQuestionTimer(); 
}
function resumeQuestionTimer() { 
    clearInterval(qTimer); 
    qTimer = setInterval(() => { 
        qSecondsLeft--; 
        document.getElementById("questionTimer").innerText = qSecondsLeft + "s"; 
        
        if(qSecondsLeft <= 1) {
            clearInterval(qTimer);
            if (qIndex === questions.length - 1) {
                // If last question, force auto-submit
                finishQuiz(true); 
            } else {
                // Otherwise, move to next question
                next(); 
            }
        }
    }, 1000); 
}
function trackQuestionTime() { clearInterval(questionDurationTimer); questionDurationTimer = setInterval(() => { if(questions[qIndex]) questions[qIndex].timeSpent = (questions[qIndex].timeSpent || 0) + 1; }, 1000); }

function updateNav() { 
    const isLast = qIndex === questions.length - 1; 
    document.getElementById("submitBtn").classList.toggle("hidden", !isLast); 
    document.getElementById("nextBtn").classList.toggle("hidden", isLast); 
    document.getElementById("progressBar").style.width = ((qIndex+1)/questions.length*100) + "%"; 
}

function updateSidebar() { 
  const flagList = document.getElementById("flaggedList"); 
  const unattemptedList = document.getElementById("unattemptedList");
  flagList.innerHTML = ""; unattemptedList.innerHTML = "";
  let fCount = 0, uCount = 0;
  questions.forEach((q, i) => { 
    if (q.flag) { fCount++; createSidebarItem(flagList, i); } 
    else if (!q.sel) { uCount++; createSidebarItem(unattemptedList, i); }
  });
  document.getElementById("flagCount").innerText = fCount;
  document.getElementById("unattemptedCount").innerText = uCount;
}

function createSidebarItem(container, i) {
    const d = document.createElement("div"); d.className = "flag-pill"; d.innerText = `Q${i+1}`; 
    d.onclick = () => { qIndex = i; loadQuestion(); }; container.appendChild(d);
}

function toggleSection(id, btn) {
    const el = document.getElementById(id); el.classList.toggle("hidden");
    btn.innerText = el.classList.contains("hidden") ? "+" : "_";
}

function finishQuiz(force = false) {
  if (!force && !confirm("Submit answers?")) return;
  
  pauseAllTimers(); 
  clearInterval(autoSaveInterval);
  
  // 1. Force "Guess" status for Flagged Attempts (Any Reason)
  questions.forEach(q => {
      if (q.sel && q.flag) {
          q.guess = true; 
      }
  });

  let c=0, w=0, u=0; 
  // NEW: Initialize Guess Counters
  let correctG = 0, totalG = 0;
  
  let sectionStats = {};

  questions.forEach(q => { 
      const sec = q.section || "General";
      // Initialize Section Stats (Now includes correctG and totalG)
      if(!sectionStats[sec]) sectionStats[sec] = { c:0, w:0, u:0, total:0, time:0, correctG:0, totalG:0 };
      
      sectionStats[sec].total++;
      sectionStats[sec].time += (q.timeSpent || 0);

      // NEW: Track Guess Metrics
      if (q.sel && q.guess) {
          totalG++;
          sectionStats[sec].totalG++;
          if (q.sel === q.answer) {
              correctG++;
              sectionStats[sec].correctG++;
          }
      }

      // Standard Stats
      if(!q.sel) { u++; sectionStats[sec].u++; } 
      else if(q.sel === q.answer) { c++; sectionStats[sec].c++; } 
      else { w++; sectionStats[sec].w++; }
  });
  
  const s = activeSession.settings;
  const rawScore = (c * s.mark) - (w * s.neg);
  
  // Save expanded report
  activeSession.report = { 
      c, w, u, 
      correctG, totalG, // New Data
      score: Number(rawScore.toFixed(2)), 
      total: questions.length, 
      sections: sectionStats 
  };
  activeSession.status = "completed";
  
  saveToHistory();
  showReport(); 
  
  try {
      generateAnalyticPDF();
      downloadSyncFile("completed");
  } catch (e) {
      console.warn("Auto-download blocked. Please download manually.");
  }
}

// UPDATED: downloadSyncFile now takes an argument for suffix
function downloadSyncFile(fileType = "sync") {
    // 1. Get unique sections from current session for accuracy
    // (This ensures even if you uploaded "Polity_CH1.json", if the internal keys say "Polity", we use that)
    const uniqueSections = [...new Set(activeSession.questions.map(q => q.section))];
    const smartName = generateSmartFilename(uniqueSections);

    // 2. Generate Timestamp: DD-MM-YYYY_HH-MM
    const now = new Date();
    const datePart = String(now.getDate()).padStart(2, '0') + "-" + 
                     String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                     now.getFullYear();
    const timePart = String(now.getHours()).padStart(2, '0') + "-" + 
                     String(now.getMinutes()).padStart(2, '0');
    
    const timestamp = `${datePart}_${timePart}`;

    // 3. Construct Final Name
    const finalName = `${smartName}_${fileType}_${timestamp}.json`;

    // 4. Download Process
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeSession));
    const dlNode = document.createElement('a');
    dlNode.setAttribute("href", dataStr);
    dlNode.setAttribute("download", finalName);
    document.body.appendChild(dlNode);
    dlNode.click();
    dlNode.remove();
}

function showReport() {
  const r = activeSession.report;
  const s = activeSession.settings;
  document.getElementById("quiz").classList.add("hidden");
  document.getElementById("sidebar").classList.add("hidden");
  document.getElementById("reportView").classList.remove("hidden");
  
  const fmt = (n) => Number.isInteger(n) ? n : n.toFixed(2);
  const attempted = r.c + r.w;
  const accuracy = attempted > 0 ? (r.c / attempted) * 100 : 0;
  const maxScore = r.total * s.mark;
  const percentage = maxScore > 0 ? (r.score / maxScore) * 100 : 0;
  const avgTime = r.total > 0 ? totalSeconds / r.total : 0;

  let html = `
  <table class="dark-table" style="margin-bottom: 30px; width: 100%;">
    <thead><tr><th colspan="2" style="text-align:center; font-size: 1.1rem;">🏁 Overall Summary</th></tr></thead>
    <tbody>
        <tr><td>Total Questions</td><td>${r.total}</td></tr>
        <tr><td>Attempted</td><td>${attempted}</td></tr>
        <tr><td>Accuracy</td><td>${fmt(accuracy)}%</td></tr>
        <tr><td>Percentage</td><td>${fmt(percentage)}%</td></tr>
        <tr><td>Avg Time / Question</td><td>${fmt(avgTime)}s</td></tr>
        <tr><td>Correct (+${fmt(s.mark)})</td><td class="text-success">${r.c}</td></tr>
        <tr><td>Wrong (-${fmt(s.neg)})</td><td class="text-danger">${r.w}</td></tr>
        <tr style="background:rgba(99, 102, 241, 0.1); font-weight:bold;"><td>FINAL SCORE</td><td>${fmt(r.score)} / ${fmt(maxScore)}</td></tr>
    </tbody>
  </table>
  
  <h3 class="subsection-title">📂 Sectional Breakdown</h3>
  <div style="overflow-x:auto;">
  <table class="dark-table" style="font-size:0.85rem;">
    <thead><tr><th>Section</th><th>Total</th><th>Att.</th><th>Acc%</th><th>%</th><th>Time/Q</th><th>Corr</th><th>Wrong</th><th>Score</th></tr></thead>
    <tbody>`;

  Object.keys(r.sections).forEach(secName => {
      const sec = r.sections[secName];
      const sAtt = sec.c + sec.w;
      const sAcc = sAtt > 0 ? (sec.c / sAtt) * 100 : 0;
      const sMaxScore = sec.total * s.mark;
      const sScore = (sec.c * s.mark) - (sec.w * s.neg);
      const sPerc = sMaxScore > 0 ? (sScore / sMaxScore) * 100 : 0;
      const sAvgTime = sec.total > 0 ? sec.time / sec.total : 0;

      html += `<tr>
        <td>${secName}</td><td>${sec.total}</td><td>${sAtt}</td><td>${fmt(sAcc)}%</td><td>${fmt(sPerc)}%</td><td>${fmt(sAvgTime)}s</td>
        <td class="text-success">${sec.c}</td><td class="text-danger">${sec.w}</td><td style="font-weight:bold">${fmt(sScore)}</td>
      </tr>`;
  });
  html += `</tbody></table></div>`;

  document.getElementById("statSummary").innerHTML = html;
}

async function generateAnalyticPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const r = activeSession.report;
  const s = activeSession.settings;
  const fmt = (n) => Number.isInteger(n) ? n : n.toFixed(2);

  const attempted = r.c + r.w;
  const accuracyVal = attempted > 0 ? (r.c / attempted) * 100 : 0;
  const maxScoreVal = r.total * s.mark;
  const percentageVal = maxScoreVal > 0 ? (r.score / maxScoreVal) * 100 : 0;
  const avgTimeVal = r.total > 0 ? activeSession.totalSeconds / r.total : 0; // Fixed var name reference
  const correctScoreVal = r.c * s.mark;
  const wrongScoreVal = r.w * s.neg;

  // NEW: Calculate Overall Guess Accuracy
  const guessAccVal = r.totalG > 0 ? (r.correctG / r.totalG) * 100 : 0;
  const guessAccStr = r.totalG > 0 ? `${r.correctG}/${r.totalG} (${guessAccVal.toFixed(1)}%)` : "N/A";

  doc.setFillColor(44, 62, 80); 
  doc.rect(0, 0, 210, 40, 'F');
  doc.setTextColor(255);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("Performance Report", 105, 18, { align: "center" });
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 105, 30, { align: "center" });

  const overallData = [ 
      ['Total Questions', r.total], 
      ['Attempted', attempted], 
      ['Accuracy', `${fmt(accuracyVal)}%`], 
      ['Guess Accuracy', guessAccStr], // <--- NEW ROW
      ['Percentage', `${fmt(percentageVal)}%`], 
      ['Avg Time / Question', `${fmt(avgTimeVal)}s`], 
      ['Correct (+'+fmt(s.mark)+')', `${r.c} (+${fmt(correctScoreVal)})`], 
      ['Wrong (-'+fmt(s.neg)+')', `${r.w} (-${fmt(wrongScoreVal)})`], 
      ['FINAL SCORE', `${fmt(r.score)} / ${fmt(maxScoreVal)}`] 
  ];
  
  doc.autoTable({ 
      startY: 50, 
      head: [['Metric', 'Value']], 
      body: overallData, 
      theme: 'grid', 
      headStyles: { fillColor: [52, 73, 94], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 3, lineColor: [0,0,0], lineWidth: 0.1 }
  });

  // Update Section Rows to include Guess Accuracy
  const sectionRows = Object.keys(r.sections).map(k => {
      const sec = r.sections[k];
      const sAtt = sec.c + sec.w;
      const sAcc = sAtt > 0 ? (sec.c / sAtt) * 100 : 0;
      const sScore = (sec.c * s.mark) - (sec.w * s.neg);
      const sPerc = (sec.total * s.mark) > 0 ? (sScore / (sec.total * s.mark)) * 100 : 0;
      const sAvg = sec.total > 0 ? sec.time / sec.total : 0;
      
      // NEW: Sectional Guess Calc
      const secGuessAcc = sec.totalG > 0 ? ((sec.correctG / sec.totalG) * 100).toFixed(0) + '%' : '-';

      // Added secGuessAcc to the row array below
      return [k, sec.total, sAtt, `${fmt(sAcc)}%`, secGuessAcc, `${fmt(sPerc)}%`, `${fmt(sAvg)}s`, sec.c, sec.w, fmt(sScore)];
  });

  doc.text("Section-Wise Analysis", 14, doc.lastAutoTable.finalY + 15);
  doc.autoTable({ 
      startY: doc.lastAutoTable.finalY + 20, 
      // Added 'G.Acc' to header
      head: [['Section', 'Tot', 'Att', 'Acc', 'G.Acc', '% Marks', 'Time', 'Cor', 'Wro', 'Score']], 
      body: sectionRows, 
      theme: 'grid', 
      headStyles: { fillColor: [41, 128, 185], textColor: 255 }, 
      styles: { fontSize: 9, lineColor: [0,0,0], lineWidth: 0.1 } 
  });

  doc.addPage();
  // ... (Rest of the function remains the same: Detailed Question Review & Notes) ...
  doc.setFillColor(44, 62, 80); doc.rect(0, 0, 210, 20, 'F');
  doc.setTextColor(255); doc.setFontSize(14); doc.text("Detailed Question Review", 14, 13);
  
  // ... (Existing QRows logic) ...
  const qRows = questions.map((q, i) => {
      let status = "UNATTEMPTED";
      if (q.sel) status = (q.sel === q.answer) ? "PASS" : "FAIL";
      return [`Q${i+1}`, q.q, q.sel || '-', q.answer, status, q.timeSpent + "s"];
  });

  doc.autoTable({
      startY: 30,
      head: [['#', 'Question Text', 'Your Ans', 'Correct', 'Status', 'Time']],
      body: qRows,
      theme: 'grid',
      headStyles: { fillColor: [44, 62, 80], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { cellWidth: 15 }, 1: { cellWidth: 95 }, 2: { cellWidth: 20 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20 }, 5: { cellWidth: 15 } },
      styles: { fontSize: 9, valign: 'middle', overflow: 'linebreak', cellPadding: 3, lineColor: [0,0,0], lineWidth: 0.1 },
      didParseCell: function(data) {
          if (data.section === 'body' && data.column.index === 4) {
              if (data.cell.raw === 'PASS') data.cell.styles.textColor = [39, 174, 96];
              else if (data.cell.raw === 'FAIL') data.cell.styles.textColor = [192, 57, 43];
              else data.cell.styles.textColor = [127, 140, 141];
          }
      }
  });
  
  // ... (Notes section and save/download logic) ...
  const notesQ = questions.filter(q => q.notes && q.notes.trim() !== "");
  if (notesQ.length > 0) {
      doc.addPage(); 
      doc.setFontSize(16); doc.setTextColor(0); doc.text("Personal Notes", 14, 20);
      let y = 30;
      notesQ.forEach(q => {
          doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text(`Q: ${q.q.substring(0, 80)}...`, 14, y);
          doc.setFont("helvetica", "normal"); 
          doc.setFontSize(10);
          const txt = doc.splitTextToSize(q.notes, 180); 
          doc.text(txt, 14, y+6); 
          y += (txt.length*5)+18; 
          if(y>270){ doc.addPage(); y=20; }
      });
  }

  // 1. Generate Timestamp: DD-MM-YYYY_HH-MM
  const now = new Date();
  const datePart = String(now.getDate()).padStart(2, '0') + "-" + 
                   String(now.getMonth() + 1).padStart(2, '0') + "-" + 
                   now.getFullYear();
  const timePart = String(now.getHours()).padStart(2, '0') + "-" + 
                   String(now.getMinutes()).padStart(2, '0');
  
  const timestamp = `${datePart}_${timePart}`;

  // 2. Generate Smart Name from Unique Sections
  // This ensures the filename matches the content (e.g. P1_G14)
  const uniqueSections = [...new Set(questions.map(q => q.section))];
  const smartName = generateSmartFilename(uniqueSections);

  // 3. Save with new nomenclature
  // Format: [SmartName]_Report_[Timestamp].pdf
  doc.save(`${smartName}_Report_${timestamp}.pdf`);
}

function autoSave() { activeSession.qIndex = qIndex; activeSession.totalSeconds = totalSeconds; saveToHistory(); }
function saveToHistory() { recentHistory = [activeSession, ...recentHistory.filter(q => q.title !== activeSession.title)].slice(0, 5); localStorage.setItem("QUIZ_HISTORY", JSON.stringify(recentHistory)); }
function renderRecentQuizzes() {
  const list = document.getElementById("recentQuizzesList");
  list.innerHTML = recentHistory.length ? "" : "<p class='empty-text' style='color:#64748b;text-align:center'>No recent sessions.</p>";
  document.getElementById("clearAllBtn").classList.toggle("hidden", recentHistory.length === 0);
  recentHistory.forEach((item, index) => {
    const div = document.createElement("div"); div.className = "recent-item";
    div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;background:#28364d;padding:12px;border-radius:8px;margin-bottom:8px"><span style="font-weight:500;font-size:0.9rem">${item.title}</span><div style="display:flex;gap:8px"><button class="btn-exit" onclick="loadHistoryItem(${index})" style="background:#6366f1;color:white">Resume</button><button class="btn-exit" onclick="deleteHistory(${index})" style="background:#ef4444;color:white">✕</button></div></div>`;
    list.appendChild(div);
  });
}
function loadHistoryItem(i) { activeSession = recentHistory[i]; loadSession(); }
function deleteHistory(i) { recentHistory.splice(i, 1); localStorage.setItem("QUIZ_HISTORY", JSON.stringify(recentHistory)); renderRecentQuizzes(); }
function clearAllHistory() { recentHistory = []; localStorage.removeItem("QUIZ_HISTORY"); renderRecentQuizzes(); }

function exitSession(autoDownload = false) { 
    if(!autoDownload && !confirm("Save progress and exit?")) return;
    autoSave();
    downloadSyncFile(); // Defaults to "sync" type
    if(!autoDownload) location.reload(); 
}

/* --- EXPLANATION EDITING FUNCTIONS --- */

function toggleExplanationEdit() {
    const body = document.getElementById("feedbackBody");
    const toolbar = document.getElementById("editorToolbar");
    const editBtn = document.getElementById("editExpBtn");
    
    // Check if currently editing
    const isEditing = body.getAttribute("contenteditable") === "true";

    if (isEditing) {
        // CANCEL Action: Turn off edit mode without saving
        body.setAttribute("contenteditable", "false");
        toolbar.classList.add("hidden");
        editBtn.innerText = "✏️";
        loadQuestion(); // Re-load to discard unsaved visual changes
    } else {
        // EDIT Action: Turn on edit mode
        body.setAttribute("contenteditable", "true");
        toolbar.classList.remove("hidden");
        editBtn.innerText = "✕"; // Change icon to Cancel
        body.focus();
    }
}

// 1. MONOCHROME STRIKETHROUGH
// Just executes standard strikethrough (inherits text color)
function applyStrike() {
    document.execCommand('strikeThrough', false, null);
    document.getElementById("feedbackBody").focus(); 
}

// 2. HIGHLIGHT (ACTS STYLE)
// Applies #818cf8 Color + Bold (mimics existing Acts logic)
function applyHighlight() {
    document.execCommand('bold', false, null);
    document.execCommand('foreColor', false, '#818cf8');
    document.getElementById("feedbackBody").focus();
}

function saveExplanationEdit() {
    const body = document.getElementById("feedbackBody");
    
    // 1. Capture HTML (Includes <s> tags and new text)
    const newHTML = body.innerHTML;
    
    // 2. Overwrite Original Data
    questions[qIndex].explanation = newHTML;
    questions[qIndex].isEdited = true; // Prevents regex from breaking tags later
    
    // 3. Turn off Edit Mode
    body.setAttribute("contenteditable", "false");
    document.getElementById("editorToolbar").classList.add("hidden");
    document.getElementById("editExpBtn").innerText = "✏️";
    
    // 4. Visual Confirmation
    const status = document.getElementById("feedbackStatus");
    const originalStatus = status.innerHTML;
    status.innerHTML = "<span style='color:#10b981; font-weight:bold;'>✅ Saved!</span>";
    setTimeout(() => status.innerHTML = originalStatus, 1500);
}

/* --- CHILD WINDOW COMMUNICATION --- */
// This allows the separate tab to send saved data back to the main app
window.handleChildSave = function(qNum, newHTML) {
    // qNum is 1-based index (displayed to user), convert to array index
    const index = qNum - 1;
    
    if (questions[index]) {
        questions[index].explanation = newHTML;
        questions[index].isEdited = true;
        
        // If the main window is currently looking at this question, refresh it
        if (qIndex === index) {
            loadQuestion();
        }
        return true;
    }
    return false;
};