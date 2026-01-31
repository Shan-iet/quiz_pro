let activeSession = null, questions = [], qIndex = 0, qTimer, totalTimer, autoSaveInterval, questionDurationTimer;
let totalSeconds = 0, qSecondsLeft = 0;
let recentHistory = JSON.parse(localStorage.getItem("QUIZ_HISTORY") || "[]");

window.onload = () => {
    renderRecentQuizzes();
    document.querySelector('.app-container').classList.remove('quiz-mode');
};

document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseAllTimers();
    else if (activeSession && activeSession.status === "in-progress") resumeAllTimers();
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

function changeFontFamily(font) {
    document.documentElement.style.setProperty('--q-font-family', font);
}

/* --- SESSION MGMT --- */
function startNewSession() {
  const fileInput = document.getElementById("fileInput");
  const files = fileInput.files;
  if (files.length === 0) return alert("Please select at least one JSON file.");

  const limitInput = document.getElementById("limitInput").value;
  const shouldShuffle = document.getElementById("shuffleToggle").checked;
  const userMark = parseFloat(document.getElementById("markInput").value) || 1.66;
  const userNeg = parseFloat(document.getElementById("negInput").value) || 0.55;

  let allQuestions = [];
  const fileNames = Array.from(files).map(f => f.name.replace(/\.[^/.]+$/, "")).join("_");

  const readFile = (file) => {
      return new Promise((resolve) => {
          const r = new FileReader();
          r.onload = (e) => {
              try {
                  const json = JSON.parse(e.target.result);
                  const fileNameAsSection = file.name.replace(/\.[^/.]+$/, ""); 
                  let rawList = Array.isArray(json) ? json : (json.sections ? json.sections.flatMap(s => s.questions) : (json.questions || []));
                  const formatted = rawList.map(q => ({
                      q: q.q || q.question,
                      options: q.options,
                      answer: (q.answer || q.answer_key || "").toUpperCase(),
                      explanation: q.explanation || "",
                      section: fileNameAsSection,
                      source: q.source || q.src || "", 
                      sel: null, flag: false, guess: false, notes: "", timeSpent: 0
                  }));
                  resolve(formatted);
              } catch (err) { console.error("Error", err); resolve([]); }
          };
          r.readAsText(file);
      });
  };

  Promise.all(Array.from(files).map(readFile)).then(results => {
      allQuestions = results.flat();
      if (allQuestions.length === 0) return alert("No valid questions found.");
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
          title: files.length > 1 ? "Multi-Section Session" : fileNames,
          originalFileName: fileNames,
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

            const masterPool = [...previousActive, ...previousUnused];
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
    let formatted = text;
    
    // 1. Force break after Colons
    formatted = formatted.replace(/(:)\s+/g, '$1<br>');

    // 2. Break before "Which of the statements..."
    formatted = formatted.replace(/(\s)(Which\s+of\s+the\s+(?:following\s+)?statements|Select\s+the\s+correct|Choose\s+the\s+correct|Identify\s+the\s+correct)/gi, '<br><br>$2');

    // 3. Bullets & Points
    formatted = formatted.replace(/([^\n>])\s*([“"][^”"]{30,}[”"])/g, '$1<br><span class="q-quote">$2</span>');
    formatted = formatted.replace(/(\s|^)((?:I{1,3}|IV|V|VI{0,3}|IX|X)\.)\s+/g, '<br><span class="q-point">$2&nbsp;</span>');
    formatted = formatted.replace(/(\s|^)(\(?\d+\.)\s+/g, '<br><span class="q-point">$2&nbsp;</span>');
    formatted = formatted.replace(/(\s|^)(\(?[a-z]\)[\.\)])\s+(?![a-z]\.)/gi, '<br><span class="q-point">$2&nbsp;</span>');
    formatted = formatted.replace(/([^\n])\s*([•\-\*])\s+/g, '$1<br><span class="q-point">$2&nbsp;</span>');
    formatted = formatted.replace(/(Assertion\s*\(?A\)?\s*[:.-])/gi, '<br><div class="ar-box"><strong>$1</strong>');
    formatted = formatted.replace(/(Reason\s*\(?R\)?\s*[:.-])/gi, '</div><div class="ar-box"><strong>$1</strong>');
    formatted = formatted.replace(/(<br>){2,}/g, '<br>').replace(/^<br>/, ''); 
    return formatted;
}

// Main smart highlight
function smartHighlight(text) {
    if (!text) return "";
    let processed = text;
    processed = processed.replace(/(\b\d{4}\b|Article \d+|Section \d+|Schedule \d+|Amendment|Act \d{4})/gi, '<span class="highlight-term">$1</span>');
    processed = processed.replace(/(Option [a-d] is [a-z ]*correct(?: answer)?|Statement \d+ is [a-z ]*correct(?: answer)?|Pair [IVX\d]+ is [a-z ]*correct(?: answer)?|Pair [IVX\d]+ is [a-z ]*incorrect(?: answer)?)/gi, '<span class="highlight-statement">$1</span>');
    processed = processed.replace(/\b([A-Z][a-z]+:)/g, '<span class="definition-header">$1</span>');
    return processed;
}

function processTextSmartly(text) {
    if (!text) return "";
    let processed = text;
    
    // 1. Formulas
    processed = processed.replace(/([a-zA-Z\s\(\)\$\.]+=[a-zA-Z0-9\s\(\)\+\-\$\.]+)(?=\.|\n|<|$)/g, '||LOGIC_SPLIT||<div class="formula-box">$1</div>||LOGIC_SPLIT||');
    
    // 2. Headings
    processed = processed.replace(/(?:^|\.\s+|\>\s*)([A-Z][^.:\n<]+:)(?=\\s)/g, '<br><strong class="highlight-term">$1</strong><br>');

    // 3. Logic Splits
    processed = processed.replace(/(Pair [IVX\d]+ is (?:in)?correct(?: answer)?|Statement \d+ is (?:in)?correct(?: answer)?|Option [a-d] is (?:in)?correct(?: answer)?)/gi, '||LOGIC_SPLIT||$1');
    processed = processed.replace(/\b([A-Z][a-z]+:)/g, '||LOGIC_SPLIT||$1');
    
    return processed.split('||LOGIC_SPLIT||').map(s => s.trim()).filter(s => s).map(p => {
        if(p.startsWith('<div')) return p;
        if(p.startsWith('<br>')) return p + smartHighlight(p.replace(/^<br>/, ''));
        
        // Intelligent Paragraph Break
        if (p.length > 350) {
            let sentences = p.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g);
            if(sentences) {
                let chunks = [], currentChunk = "";
                sentences.forEach(sent => {
                    currentChunk += sent;
                    if(currentChunk.length > 300) {
                        chunks.push(`<p>${smartHighlight(currentChunk)}</p>`);
                        currentChunk = "";
                    }
                });
                if(currentChunk) chunks.push(`<p>${smartHighlight(currentChunk)}</p>`);
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

  document.getElementById("questionCounter").innerText = `Q${qIndex + 1} / ${questions.length}`;
  document.getElementById("sectionBadge").innerText = q.section || 'General';
  let qHtml = (q.flag ? "🚩 " : "") + formatQuestionText(q.q);
  if(q.source && q.source.trim() !== "") qHtml += `<span class="source-tag">Source: ${q.source}</span>`;
  document.getElementById("question").innerHTML = qHtml;

  const optionsContainer = document.getElementById("optionsContainer");
  optionsContainer.innerHTML = "";
  Object.keys(q.options).forEach(key => {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.innerText = q.options[key];
      const normalizedKey = key.toUpperCase();
      if (q.sel === normalizedKey) btn.classList.add("selected");
      if (q.sel && !q.flag) {
          if (normalizedKey === q.answer) btn.classList.add("correct");
          else if (normalizedKey === q.sel) btn.classList.add("wrong");
      }
      btn.disabled = (q.sel !== null); 
      btn.onclick = () => selectOption(normalizedKey);
      optionsContainer.appendChild(btn);
  });

  const guessCheck = document.getElementById("guessCheck");
  guessCheck.checked = q.guess || false;
  // UPDATED: Guess check is never disabled now
  guessCheck.disabled = false;

  const noteVal = q.notes || "";
  const words = noteVal.trim() ? noteVal.trim().split(/\s+/).length : 0;
  const setNoteUI = (id, countId) => {
      document.getElementById(id).value = noteVal;
      document.getElementById(countId).innerText = `${words}/100`;
  };
  setNoteUI("noteInput", "sidebarWordCount");
  setNoteUI("mobileNoteInput", "mobileWordCount");

  const fb = document.getElementById("feedback");
  if (q.sel) {
    document.getElementById("feedbackStatus").innerHTML = `<strong class="${q.sel===q.answer?'text-success':'text-danger'}">${q.sel === q.answer ? "✅ Correct" : "❌ Incorrect"}</strong>`;
    if (q.explanation && (q.explanation.length > 300 || q.explanation.includes("||TIPS||"))) {
        document.getElementById("feedbackBody").innerHTML = "<p><i>See detailed analysis below...</i></p>";
         document.getElementById("feedbackLink").innerHTML = `<span class="exp-link" onclick="openExplanationInTab(questions[qIndex].explanation, ${qIndex+1})">📖 Open Full Explanation</span>`;
    } else {
        document.getElementById("feedbackBody").innerHTML = `<div class="beautified-explanation">${processTextSmartly(q.explanation)}</div>`;
        document.getElementById("feedbackLink").innerHTML = "";
    }
    fb.classList.remove("hidden");
  } else fb.classList.add("hidden");

  updateSidebar(); updateNav(); startQuestionTimer(); trackQuestionTime();
}

function openExplanationInTab(fullExplanation, qNum) {
    const parts = fullExplanation.split("||TIPS||");
    const mainExp = parts[0];
    const tips = parts.length > 1 ? parts[1] : null;
    
    // Clean window open
    const win = window.open("", "_blank");
    
    win.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <title>Q${qNum} Analysis</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
    <style>
        * { box-sizing: border-box; }
        :root{--bg-color:#f8f9fa;--text-color:#2c3e50;--card-bg:#ffffff;--highlight-term:#d35400;--highlight-stmt-bg:rgba(39,174,96,0.1);--highlight-stmt-text:#27ae60;--tips-bg:#E8F8F5;--tips-border:#1abc9c;--tips-header:#16a085;--btn-bg:#34495e;}
        [data-theme="dark"]{--bg-color:#0f172a;--text-color:#e2e8f0;--card-bg:#1e293b;--highlight-term:#818cf8;--highlight-stmt-bg:rgba(16,185,129,0.2);--highlight-stmt-text:#34d399;--tips-bg:#1e293b;--tips-border:#10b981;--tips-header:#34d399;--btn-bg:#4f46e5;}
        
        body {
            background:var(--bg-color);
            color:var(--text-color);
            font-family:'Segoe UI',sans-serif;
            margin:0;
            padding: 20px; /* Base padding */
            line-height:1.8;
            font-size: 18px; 
            transition:0.3s;
        }
        
        .container {
            width: 96%; 
            max-width: 96%; /* Explicitly 96% */
            min-height: 100vh;
            margin: 0 auto; 
            background: var(--card-bg); 
            padding: 40px;
            border-radius: 12px; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .header-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap; /* Wrap on narrow screens */
            gap: 10px;
            border-bottom: 2px solid #ccc;
            padding-bottom: 15px;
            margin-bottom: 20px;
        }
        h1 { margin: 0; font-size: 1.5rem; }

        .theme-toggle{background:transparent;border:1px solid var(--text-color);color:var(--text-color);padding:5px 15px;border-radius:20px;cursor:pointer; font-size: 0.9rem;}
        
        .highlight-term{color:var(--highlight-term);font-weight:bold;}
        .highlight-statement{color:var(--highlight-stmt-text);background:var(--highlight-stmt-bg);padding:2px 6px;border-radius:4px;font-weight:bold;}
        
        .tips-box{margin-top:30px;background:var(--tips-bg);border-left:5px solid:var(--tips-border);padding:20px;border-radius:4px;}
        .close-btn{width:100%;margin-top:30px;padding:12px;background:var(--btn-bg);color:white;border:none;border-radius:8px;cursor:pointer;font-size:18px; font-weight:bold;}
        
        .formula-box {
            background: rgba(0,0,0,0.2);
            padding: 12px;
            border-left: 4px solid var(--highlight-stmt-text);
            font-family: 'Consolas', 'Monaco', monospace;
            margin: 15px 0;
            white-space: pre-wrap;
            word-break: break-word; /* Handle normal text wrapping */
            font-size: 0.95em;
            overflow-x: auto; /* SCROLLBAR FOR LONG FORMULAS */
        }
        
        p { margin-bottom: 1.2em; }

        /* PORTRAIT / MOBILE FIXES */
        @media screen and (max-width: 600px) {
            body { padding: 10px; font-size: 16px; }
            .container { padding: 15px; width: 100%; border-radius: 0; box-shadow: none; }
            .header-row { align-items: flex-start; } 
            h1 { font-size: 1.25rem; }
            .formula-box { font-size: 0.85em; white-space: nowrap; } /* Force scroll for formulas on tiny screens */
        }
    </style>
    </head>
    <body data-theme="dark">
        <div class="container">
            <div class="header-row"><h1>Question ${qNum} Analysis</h1><button class="theme-toggle" onclick="document.body.setAttribute('data-theme',document.body.getAttribute('data-theme')==='dark'?'light':'dark')">🌗 Theme</button></div>
            <div>${processTextSmartly(mainExp)}</div>
            ${tips ? `<div class="tips-box"><strong>💡 TIPS:</strong> ${processTextSmartly(tips)}</div>` : ''}
            <button class="close-btn" onclick="window.close()">Close Tab</button>
        </div>
        <script>
            function smartHighlight(t) {
                // 1. ACTS
                t = t.replace(/\\b((?:The\\s|\\d+(?:st|nd|rd|th)?\\s)?[A-Z][\\w\\s\\-]*(?:Act|Amendment|Bill|Rules|Code|Ordinance|Policy)(?:,?\\s\\d{4})?)\\b/g, '<span class="highlight-term">$1</span>');

                // 2. BODIES
                t = t.replace(/\\b([A-Z][\\w\\s\\.]*(?:Committee|Commission|Tribunal|Council|Aayog|Authority|Bench))\\b/g, '<span class="highlight-term">$1</span>');
                t = t.replace(/\\b(\\d+-member\\s(?:bench|committee|panel|body))\\b/gi, '<span class="highlight-term">$1</span>');

                // 3. HISTORY
                t = t.replace(/\\b((?:First|Second|Third|The)?\\s?(?:Battle|Siege|Treaty|War|Revolt|Mutiny)\\s(?:of\\s)?[A-Z][\\w\\s\\-]*(?:\\s\\(\\d{4}(?:-\\d{2,4})?\\))?)\\b/g, '<span class="highlight-term">$1</span>');
                t = t.replace(/\\b([A-Z][\\w\\s\\-]*(?:War|Battle|Revolution|Revolt|Mutiny|Movement)(?:\\s\\(\\d{4}(?:-\\d{2,4})?\\))?)\\b/g, '<span class="highlight-term">$1</span>');

                // 4. DYNASTIES & DIPLOMACY
                t = t.replace(/\\b([A-Z][a-zA-Z\\s\\-]*(?:Dynasty|Empire|Kingdom|Sultanate|Caliphate))\\b/g, '<span class="highlight-term">$1</span>');
                t = t.replace(/\\b([A-Z][\\w\\s\\-]*(?:Conference|Summit|Pact|Accord|Convention|Protocol)(?:\\s\\d{4})?)\\b/g, '<span class="highlight-term">$1</span>');

                // 5. LEGAL CASES
                t = t.replace(/\\b([A-Z][\\w\\s\\.]+\\svs\\.?\\s[A-Z][\\w\\s\\.]+(?:\\s\\(\\d{4}\\))?)\\b/g, '<span class="highlight-term">$1</span>');

                // 6. DATA
                t = t.replace(/\\b(\\d+(?:\\.\\d+)?%\\s(?:[a-zA-Z]+\\s?){1,4})\\b/g, '<span class="highlight-term">$1</span>');
                t = t.replace(/\\b(\\d+(?:\\.\\d+)?\\s(?:Lakh|Lac|Cr|Crore|Million|Billion|Trillion|tonnes|liters|km)\\s[\\w\\s]{2,15})\\b/gi, '<span class="highlight-term">$1</span>');

                // 7. ARTICLES/SECTIONS
                t = t.replace(/(\\b(?:17|18|19|20)\\d{2}\\b|Article \\d+|Section \\d+|Schedule \\d+)/gi, '<span class="highlight-term">$1</span>');

                return t.replace(/(Option [a-d] is [a-z ]*correct(?: answer)?)/gi, '<span class="highlight-statement">$1</span>');
            }

            function processTextSmartly(t) { 
                 // 1. FORMULAS
                 t = t.replace(/([a-zA-Z\\s\\(\\)\\$\\.]+=[a-zA-Z0-9\\s\\(\\)\\+\\-\\$\\.]+)(?=\\.|\\n|<|$)/g, '||LOGIC_SPLIT||<div class="formula-box">$1</div>||LOGIC_SPLIT||');
                 
                 // 2. HEADINGS
                 t = t.replace(/(?:^|\\.\\s+|\\>\\s*)([A-Z][^.:\\n<]+:)(?=\\s)/g, '<br><strong class="highlight-term">$1</strong><br>');

                 // 3. LOGIC SPLITS
                 t = t.replace(/(Option [a-d] is (?:in)?correct(?: answer)?)/gi, '||LOGIC_SPLIT||$1');
                 
                 return t.split('||LOGIC_SPLIT||').map(s=> {
                    if(s.startsWith('<div')) return s;
                    if(s.startsWith('<br>')) return s + smartHighlight(s.replace(/^<br>/, ''));
                    
                    if (s.length > 350) {
                        let sentences = s.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g);
                        if(sentences) {
                            let chunks = [], currentChunk = "";
                            sentences.forEach(sent => {
                                currentChunk += sent;
                                if(currentChunk.length > 300) {
                                    chunks.push('<p>'+smartHighlight(currentChunk)+'</p>');
                                    currentChunk = "";
                                }
                            });
                            if(currentChunk) chunks.push('<p>'+smartHighlight(currentChunk)+'</p>');
                            return chunks.join("");
                        }
                    }
                    return '<p>'+smartHighlight(s)+'</p>';
                 }).join(''); 
            }
        </script>
    </body>
    </html>`);
}

function saveCurrentNote(val) { 
    const words = val.trim().split(/\s+/);
    if (words.length > 100) { val = words.slice(0, 100).join(" "); document.getElementById("noteInput").value = val; document.getElementById("mobileNoteInput").value = val; }
    questions[qIndex].notes = val;
    const currentCount = val.trim() ? val.trim().split(/\s+/).length : 0;
    document.getElementById("sidebarWordCount").innerText = `${currentCount}/100`;
    document.getElementById("mobileWordCount").innerText = `${currentCount}/100`;
}

function selectOption(o) { if(questions[qIndex].sel) return; questions[qIndex].sel = o; questions[qIndex].flag = false; loadQuestion(); }
// UPDATED: Guess toggle now always works
function toggleGuessState() { questions[qIndex].guess = document.getElementById("guessCheck").checked; }
function toggleFlag() { questions[qIndex].flag = !questions[qIndex].flag; loadQuestion(); }
function next() { if(qIndex < questions.length - 1) { qIndex++; loadQuestion(); } }
function prev() { if(qIndex > 0) { qIndex--; loadQuestion(); } }

function startTotalTimer() { clearInterval(totalTimer); totalTimer = setInterval(() => { totalSeconds++; document.getElementById("totalTimer").innerText = `${Math.floor(totalSeconds/60)}:${(totalSeconds%60).toString().padStart(2,'0')}`; }, 1000); }
function startQuestionTimer() { clearInterval(qTimer); qSecondsLeft = activeSession.settings.time; resumeQuestionTimer(); }
function resumeQuestionTimer() { clearInterval(qTimer); qTimer = setInterval(() => { qSecondsLeft--; document.getElementById("questionTimer").innerText = qSecondsLeft + "s"; if(qSecondsLeft<=0) clearInterval(qTimer); }, 1000); }
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

/* --- FINISH & DOWNLOAD --- */
function finishQuiz() {
  if (!confirm("Submit answers?")) return;
  pauseAllTimers(); clearInterval(autoSaveInterval);
  
  let c=0, w=0, u=0, g=0; 
  let sectionStats = {};

  questions.forEach(q => { 
      const sec = q.section || "General";
      if(!sectionStats[sec]) sectionStats[sec] = { c:0, w:0, u:0, total:0, time:0 };
      sectionStats[sec].total++;
      sectionStats[sec].time += (q.timeSpent || 0);

      if(!q.sel) { u++; sectionStats[sec].u++; } 
      else if(q.sel === q.answer) { c++; sectionStats[sec].c++; if(q.guess) g++; } 
      else { w++; sectionStats[sec].w++; }
  });
  
  const s = activeSession.settings;
  const rawScore = (c * s.mark) - (w * s.neg);
  activeSession.report = { c, w, u, g, score: Number(rawScore.toFixed(2)), total: questions.length, sections: sectionStats };
  activeSession.status = "completed";
  
  saveToHistory();
  showReport();

  // 1. AUTO DOWNLOAD PDF
  generateAnalyticPDF();

  // 2. CONDITIONAL SYNC JSON DOWNLOAD
  if (activeSession.unusedQuestions && activeSession.unusedQuestions.length > 0) {
      exitSession(true);
  }
}

function downloadSyncFile() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeSession));
    const dlNode = document.createElement('a');
    
    // Naming: [OriginalNames]_[Timestamp]_sync.json
    const now = new Date();
    const timestamp = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0') + "_" + String(now.getHours()).padStart(2, '0') + "-" + String(now.getMinutes()).padStart(2, '0');
    const baseName = activeSession.originalFileName || activeSession.title || "quiz";
    
    dlNode.setAttribute("href", dataStr);
    dlNode.setAttribute("download", `${baseName}_${timestamp}_sync.json`);
    dlNode.click();
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

  // Overall Summary Table
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
  const avgTimeVal = r.total > 0 ? totalSeconds / r.total : 0;
  const correctScoreVal = r.c * s.mark;
  const wrongScoreVal = r.w * s.neg;

  doc.setFillColor(30, 41, 59); doc.rect(0, 0, 210, 30, 'F'); doc.setTextColor(255); doc.setFontSize(16); doc.text(activeSession.title.substring(0,35), 14, 19);
  doc.setFontSize(10); doc.text(`Score: ${fmt(r.score)} | Accuracy: ${fmt(accuracyVal)}%`, 140, 19);

  // 1. Overall
  const overallData = [ 
      ['Total Questions', r.total], ['Attempted', attempted], ['Accuracy', `${fmt(accuracyVal)}%`], ['Percentage', `${fmt(percentageVal)}%`], ['Avg Time / Question', `${fmt(avgTimeVal)}s`], ['Correct (+'+fmt(s.mark)+')', `${r.c} (+${fmt(correctScoreVal)})`], ['Wrong (-'+fmt(s.neg)+')', `${r.w} (-${fmt(wrongScoreVal)})`], ['FINAL SCORE', `${fmt(r.score)} / ${fmt(maxScoreVal)}`] 
  ];
  doc.autoTable({ startY: 40, head: [['Metric', 'Value']], body: overallData, theme: 'grid', headStyles: { fillColor: [51, 65, 85] } });

  // 2. Sectional
  const sectionRows = Object.keys(r.sections).map(k => {
      const sec = r.sections[k];
      const sAtt = sec.c + sec.w;
      const sAcc = sAtt > 0 ? (sec.c / sAtt) * 100 : 0;
      const sScore = (sec.c * s.mark) - (sec.w * s.neg);
      const sPerc = (sec.total * s.mark) > 0 ? (sScore / (sec.total * s.mark)) * 100 : 0;
      const sAvg = sec.total > 0 ? sec.time / sec.total : 0;
      return [k, sec.total, sAtt, `${fmt(sAcc)}%`, `${fmt(sPerc)}%`, `${fmt(sAvg)}s`, sec.c, sec.w, fmt(sScore)];
  });

  doc.text("Section-Wise Breakdown", 14, doc.lastAutoTable.finalY + 15);
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 20, head: [['Section', 'Tot', 'Att', 'Acc', '%', 'Time/Q', 'Cor', 'Wro', 'Score']], body: sectionRows, theme: 'grid', headStyles: { fillColor: [71, 85, 105] }, styles: { fontSize: 8 } });

  // 3. Questions (Full Text, Reverted Columns)
  const qRows = questions.map((q, i) => [ 
      `Q${i+1}`, 
      q.q, // Full text
      q.sel || '-', 
      q.answer, 
      q.sel === q.answer ? 'YES' : 'NO', 
      q.timeSpent + "s"
  ]);
  
  doc.autoTable({ 
      startY: doc.lastAutoTable.finalY + 15, 
      head: [['#', 'Question', 'Yours', 'Key', 'Pass', 'Time']], 
      body: qRows, 
      headStyles: { fillColor: [99, 102, 241] }, 
      columnStyles: { 
          1: { cellWidth: 90 }, 
          4: { halign: 'center' } 
      }, 
      styles: { fontSize: 8, valign: 'middle', overflow: 'linebreak' }, 
      didParseCell: function(data) { 
          if (data.section === 'body' && data.column.index === 4) { 
              data.cell.styles.textColor = data.cell.raw === 'YES' ? [22, 163, 74] : [220, 38, 38]; 
          } 
      } 
  });

  // 4. Notes
  const notesQ = questions.filter(q => q.notes && q.notes.trim() !== "");
  if (notesQ.length > 0) {
      doc.addPage(); doc.setFontSize(14); doc.setTextColor(0); doc.text("Personal Notes", 14, 20);
      let y = 30;
      notesQ.forEach(q => {
          doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.text(`Q: ${q.q.substring(0, 80)}...`, 14, y);
          doc.setFont("helvetica", "normal"); const txt = doc.splitTextToSize(q.notes, 180); doc.text(txt, 14, y+5); y += (txt.length*5)+15; if(y>270){ doc.addPage(); y=20; }
      });
  }

  doc.save(`${activeSession.title}_Report.pdf`);
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
    downloadSyncFile();
    if(!autoDownload) location.reload(); 
}