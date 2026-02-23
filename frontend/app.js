// ===== CONFIG =====
const API = window.location.origin;

// ===== STATE =====
let flavors = [];
let inventory = [];
let smartDefaults = [];
let countEdits = {};  // keyed by "flavorId-productType"
let countPredictions = {};  // keyed by "flavorId-productType" - stores predicted values
let parLevels = [];   // par level data from API
let parEdits = {};    // keyed by "flavorId-productType"
let productionDefaults = [];  // flavor + type combinations for production
let productionEdits = {};  // keyed by "flavorId-productType" - tracks production quantities
let reportDays = 7;   // current report range
let voiceRecognition = null;
let isVoiceActive = false;
let productionVoiceUndoStack = []; // Track voice changes for undo on production page

// Cache report data for exports
let reportCache = {
  consumption: [],
  popularity: [],
  waste: [],
  parAccuracy: [],
  variance: null,
  employeePerformance: null,
};

// ===== INIT =====
function init() {
  initTheme();
  initTabs();
  initTypeToggles();
  setupEmployeeNameListener();

  // Set count date and production date to today by default (local timezone)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const countDateInput = document.getElementById('count-date');
  if (countDateInput) {
    countDateInput.value = today;
  }
  const prodDateInput = document.getElementById('prod-date');
  if (prodDateInput) {
    prodDateInput.value = today;
  }

  loadFlavors().then(() => {
    loadHome();
    loadProductionHistory();
  });
  // Replace-on-type for number inputs: the first digit typed after focusing
  // clears the existing value so the new number replaces rather than appends.
  // We can't rely on select() — it's not guaranteed on type=number across
  // browsers/mobile, so we handle it at the keydown level instead.
  const freshFocus = new WeakSet();
  document.addEventListener('focus', (e) => {
    if (e.target.type === 'number') freshFocus.add(e.target);
  }, true);
  document.addEventListener('blur', (e) => {
    if (e.target.type === 'number') freshFocus.delete(e.target);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.target.type === 'number' && freshFocus.has(e.target)) {
      if (/^[0-9.]$/.test(e.key)) {
        // First digit clears the field — new number replaces old one
        freshFocus.delete(e.target);
        e.target.value = '';
      } else if (e.key === 'Enter') {
        // Enter advances to next number input
        e.preventDefault();
        freshFocus.delete(e.target);
        const inputs = [...document.querySelectorAll('input[type="number"]:not([disabled])')];
        const idx = inputs.indexOf(e.target);
        if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
      }
    } else if (e.key === 'Enter' && e.target.type === 'number') {
      e.preventDefault();
      const inputs = [...document.querySelectorAll('input[type="number"]:not([disabled])')];
      const idx = inputs.indexOf(e.target);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
    }
  }, true);

  // Close export dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.export-btn') && !e.target.closest('.export-dropdown')) {
      document.querySelectorAll('.export-dropdown').forEach(d => d.remove());
    }
  });
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // DOM already loaded
  init();
}

// ===== THEME =====
function initTheme() {
  const saved = localStorage.getItem('scoop-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('scoop-theme', next);
  // Re-render all visible charts with new theme colors
  reRenderActiveCharts();
}

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    gridColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    textColor: isDark ? '#9898A6' : '#555555',
    red: isDark ? '#FF3B4F' : '#E40521',
    redDark: isDark ? '#E4253A' : '#B8041A',
    green: isDark ? '#34D399' : '#22C55E',
    orange: isDark ? '#FBBF24' : '#F59E0B',
    cyan: isDark ? '#38BDF8' : '#00D4FF',
    blue: isDark ? '#60A5FA' : '#3B82F6',
    black: isDark ? '#E8E8ED' : '#1A1A1A',
    muted: isDark ? '#5A5A6E' : '#D0D0D0',
    doughnutBorder: isDark ? '#1A1A24' : '#FFFFFF',
    barGradient: isDark
      ? ['#FF3B4F','#FF4D55','#FF6A5E','#FF8A6A','#FFA87A','#FBBF24','#FBC940','#FBD860','#5A5A6E','#5A5A6E']
      : ['#E40521','#E4251A','#E84422','#EC6330','#F08040','#F59E0B','#F5B020','#F5C040','#D0D0D0','#D0D0D0'],
    lineColors: isDark
      ? ['#FF3B4F','#FBBF24','#34D399','#38BDF8','#E8E8ED']
      : ['#E40521','#F59E0B','#22C55E','#00D4FF','#1A1A1A'],
    categoryColors: isDark
      ? ['#FF3B4F','#FBBF24','#34D399','#38BDF8','#E8E8ED','#5A5A6E','#FFD60A','#E4253A']
      : ['#E40521','#F59E0B','#22C55E','#00D4FF','#1A1A1A','#888888','#FFD60A','#B8041A'],
  };
}

function reRenderActiveCharts() {
  const activeTab = document.querySelector('.tab-content.active')?.id;
  if (activeTab === 'home') {
    loadHome();
  } else if (activeTab === 'dashboard') {
    loadDashboard();
  } else if (activeTab === 'reports') {
    loadReports();
  }
}

// ===== TABS =====
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      const targetElement = document.getElementById(target);
      if (targetElement) {
        targetElement.classList.add('active');
      }

      if (target === 'home') loadHome();
      if (target === 'dashboard') loadDashboard();
      if (target === 'count') {
        loadSmartDefaults();
        // Auto-focus name field for first-time users (no saved name)
        const savedName = localStorage.getItem('employee-name');
        if (!savedName) {
          const nameInput = document.getElementById('employee-name');
          if (nameInput) {
            nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => nameInput.focus(), 300);
          }
        }
      }
      if (target === 'production') { loadProductionDefaults(); loadProductionHistory(); restoreEmployeeName('prod-employee-name'); }
      if (target === 'flavors') loadParLevels();
      if (target === 'reports') { initReportRangeToggle(); loadReports(); }
    });
  });
}

// ===== TYPE TOGGLES =====
function initTypeToggles() {
  document.querySelectorAll('.type-toggle').forEach(group => {
    group.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const hiddenInput = group.nextElementSibling;
        if (hiddenInput && hiddenInput.type === 'hidden') {
          hiddenInput.value = btn.dataset.value;
        }

        // Show/hide partial toggle for production form
        if (group.id === 'prod-type-toggle') {
          updateProductionPartialToggle(btn.dataset.value);
        }
      });
    });
  });

  // Initialize production partial toggle visibility
  updateProductionPartialToggle('tub');
}

function updateProductionPartialToggle(type) {
  const partialToggle = document.getElementById('prod-partial-toggle');
  const qtyInput = document.getElementById('prod-qty');

  if (!partialToggle || !qtyInput) return;

  if (type === 'tub') {
    partialToggle.style.display = 'flex';
    qtyInput.step = '0.25';
    qtyInput.min = '0';
  } else {
    partialToggle.style.display = 'none';
    qtyInput.step = '1';
    qtyInput.min = '1';
    // Round to whole number if switching from tubs
    const val = parseFloat(qtyInput.value);
    if (val % 1 !== 0) {
      qtyInput.value = Math.round(val);
    }
  }
}

// ===== API HELPERS =====
async function api(path, opts = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  setTimeout(() => el.classList.add('hidden'), 2500);
}

function isSpecialtyCategory(category) {
  if (!category) return false;
  const lower = category.toLowerCase();
  return lower === 'specialty' || lower === 'seasonal' || lower === 'specials';
}

async function discontinueFlavor(flavorId) {
  if (!confirm('Mark this flavor as discontinued? It will be hidden from counts and make lists.')) {
    return;
  }
  try {
    const result = await api(`/api/flavors/${flavorId}/discontinue`, { method: 'PUT' });
    toast(result.message || 'Flavor discontinued');
    // Reload data
    await loadFlavors();
    loadHome();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reactivateFlavor(flavorId) {
  if (!confirm('Reactivate this flavor? It will appear in counts and make lists again.')) {
    return;
  }
  try {
    const result = await api(`/api/flavors/${flavorId}/reactivate`, { method: 'PUT' });
    toast(result.message || 'Flavor reactivated');
    // Reload data
    await loadFlavors();
    loadHome();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function adjustQty(inputId, delta) {
  const input = document.getElementById(inputId);
  const val = parseInt(input.value) || 0;
  input.value = Math.max(0, val + delta);
}

function restoreEmployeeName(inputId) {
  const savedName = localStorage.getItem('employee-name');
  const input = document.getElementById(inputId);
  if (savedName && input) {
    input.value = savedName;
  }
}

// ===== VOICE INPUT =====
function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported in this browser');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const transcript = event.results[last][0].transcript.toLowerCase().trim();
    const isFinal = event.results[last].isFinal;

    showVoiceFeedback(transcript, isFinal);

    if (isFinal) {
      parseVoiceCommand(transcript);
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'no-speech') {
      showVoiceFeedback('No speech detected. Try again.', true, 'error');
    } else if (event.error === 'not-allowed') {
      showVoiceFeedback('Microphone access denied. Please allow microphone in browser settings.', true, 'error');
      stopVoiceInput();
    } else {
      showVoiceFeedback(`Error: ${event.error}`, true, 'error');
    }
  };

  recognition.onend = () => {
    if (isVoiceActive) {
      recognition.start(); // Restart if still active
    }
  };

  return recognition;
}

function toggleVoiceInput() {
  if (!voiceRecognition) {
    voiceRecognition = initVoiceRecognition();
    if (!voiceRecognition) {
      toast('Voice input not supported in this browser. Try Chrome or Edge.', 'error');
      return;
    }
  }

  const btn = document.getElementById('voice-input-btn');

  if (isVoiceActive) {
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
}

function startVoiceInput() {
  isVoiceActive = true;
  const btn = document.getElementById('voice-input-btn');
  btn.classList.add('voice-active');
  btn.innerHTML = '<span class="voice-icon">🔴</span> Listening...';

  showVoiceFeedback('Listening... Say multiple items naturally (e.g., "tub of vanilla and chocolate, pint of purple cow")', false);

  try {
    voiceRecognition.start();
  } catch (e) {
    console.error('Failed to start voice recognition:', e);
  }
}

function stopVoiceInput() {
  isVoiceActive = false;
  const btn = document.getElementById('voice-input-btn');
  btn.classList.remove('voice-active');
  btn.innerHTML = '<span class="voice-icon">🎤</span> Voice Input';

  if (voiceRecognition) {
    voiceRecognition.stop();
  }

  setTimeout(() => {
    const feedback = document.getElementById('voice-feedback');
    feedback.classList.add('hidden');
  }, 2000);
}

function showVoiceFeedback(text, isFinal, type = 'info') {
  const feedback = document.getElementById('voice-feedback');
  feedback.classList.remove('hidden');
  feedback.className = `voice-feedback ${type}`;

  if (isFinal) {
    feedback.innerHTML = `<strong>Heard:</strong> "${esc(text)}"`;
  } else {
    feedback.innerHTML = `<span class="voice-interim">${esc(text)}...</span>`;
  }
}

async function parseVoiceCommand(transcript) {
  // Check for submit/commit command
  if (/\b(commit|submit|done)\b/i.test(transcript)) {
    showVoiceFeedback('✅ Submitting counts...', false, 'info');
    // Trigger the submit button click
    const submitBtn = document.getElementById('btn-submit-counts');
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.click();
    } else {
      showVoiceFeedback('❌ Cannot submit - enter your name first', true, 'error');
    }
    return;
  }

  // Check for stop/turn off voice command
  if (/\b(stop|stop listening|turn off voice|voice off|stop voice|cancel)\b/i.test(transcript)) {
    stopVoiceInput();
    showVoiceFeedback('✅ Voice input turned off', true, 'success');
    return;
  }

  // Check for undo command
  if (/\b(undo|undo last|cancel last)\b/i.test(transcript)) {
    undoLastVoiceEntry();
    return;
  }

  // Try enhanced conversational parser first
  const result = parseConversationalInput(transcript);

  if (result.success && result.confidence > 0.7) {
    // High confidence - show confirmation
    currentVoiceParseResult = result;
    showVoiceConfirmation(result);
  } else if (result.success && result.confidence > 0.4) {
    // Medium confidence - try AI boost if enabled
    if (isAIBoostEnabled()) {
      await tryAIBoostParse(transcript, result);
    } else {
      currentVoiceParseResult = result;
      showVoiceConfirmation(result);
      toast('Low confidence - please verify entries', 'warning');
    }
  } else {
    // Low confidence - try AI boost if enabled
    if (isAIBoostEnabled()) {
      await tryAIBoostParse(transcript, null);
    } else {
      // Fall back to simple single-entry parser
      const simpleResult = parseSimpleVoiceCommand(transcript);
      if (simpleResult) {
        applyVoiceEntries([simpleResult]);
      } else {
        showVoiceFeedback(`❌ Could not parse. Try simpler format: "flavor, type, number"`, true, 'error');
      }
    }
  }
}

async function tryAIBoostParse(transcript, fallbackResult) {
  showVoiceFeedback('🤖 AI Boost processing...', false, 'info');

  try {
    const aiResult = await parseVoiceCommandWithGroq(transcript);

    if (aiResult.success && aiResult.entries.length > 0) {
      // AI succeeded
      currentVoiceParseResult = aiResult;
      showVoiceConfirmation(aiResult);
      toast('🤖 AI Boost parsed successfully', 'success');
    } else if (fallbackResult) {
      // AI failed, use fallback
      currentVoiceParseResult = fallbackResult;
      showVoiceConfirmation(fallbackResult);
      toast('Using standard parser (AI boost unclear)', 'warning');
    } else {
      showVoiceFeedback(`❌ Could not parse even with AI Boost. Try simpler format.`, true, 'error');
    }
  } catch (error) {
    console.error('AI Boost error:', error);
    if (fallbackResult) {
      currentVoiceParseResult = fallbackResult;
      showVoiceConfirmation(fallbackResult);
      toast('AI Boost failed, using standard parser', 'warning');
    } else {
      showVoiceFeedback(`❌ AI Boost error: ${error.message}`, true, 'error');
    }
  }
}

async function parseVoiceCommandWithGroq(transcript) {
  try {
    const response = await api('/api/voice/parse-groq', {
      method: 'POST',
      body: JSON.stringify({
        transcript,
        available_flavors: flavors.map(f => f.name)
      })
    });

    // Convert backend response to frontend format
    const entries = response.entries.map(entry => {
      const flavor = flavors.find(f => f.name === entry.flavor);
      return {
        flavor: entry.flavor,
        flavorId: flavor ? flavor.id : null,
        type: entry.type,
        quantity: entry.quantity,
        action: entry.action,
        confidence: entry.confidence
      };
    }).filter(e => e.flavorId !== null);

    return {
      entries,
      rawTranscript: transcript,
      success: entries.length > 0,
      confidence: response.confidence
    };
  } catch (error) {
    console.error('Groq API error:', error);
    return { success: false, entries: [], confidence: 0 };
  }
}

function isAIBoostEnabled() {
  const checkbox = document.getElementById('ai-boost-enabled');
  return checkbox && checkbox.checked;
}

function toggleAIBoost() {
  const checkbox = document.getElementById('ai-boost-enabled');
  const status = checkbox.checked ? 'enabled' : 'disabled';
  localStorage.setItem('ai-boost-enabled', checkbox.checked);

  if (checkbox.checked) {
    toast('🤖 AI Boost Mode enabled - Groq will help with complex commands', 'success');
  } else {
    toast('AI Boost Mode disabled - Using free client-side parsing', 'success');
  }
}

// Fallback simple parser for single entries
function parseSimpleVoiceCommand(transcript) {
  // Remove common filler words
  let cleaned = transcript
    .replace(/\b(um|uh|like|you know)\b/g, '')
    .trim();

  // Try to extract: flavor, type (tub/pint/quart), number
  const words = cleaned.split(/\s+/);

  // Convert spoken numbers to digits (including common misheard words)
  const numberWords = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'half': 0.5, 'quarter': 0.25, 'third': 0.33, 'fourth': 0.25,
    // Common misheard words
    'nice': 9, 'to': 2, 'too': 2, 'for': 4, 'fore': 4, 'ate': 8, 'won': 1,
    'tree': 3, 'free': 3, 'sex': 6, 'tin': 10, 'tube': 2, 'tooth': 2
  };

  // Find number (can be digit or word or fraction like "nine and a half")
  let quantity = null;
  let quantityIndices = [];

  // Check for patterns like "nine and a half" or "seven and a quarter"
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();

    // Check for "X and a half/quarter" pattern
    if (numberWords[word] !== undefined && i + 3 < words.length) {
      if (words[i + 1] === 'and' && words[i + 2] === 'a' &&
          (words[i + 3] === 'half' || words[i + 3] === 'quarter')) {
        quantity = numberWords[word] + (words[i + 3] === 'half' ? 0.5 : 0.25);
        quantityIndices = [i, i + 1, i + 2, i + 3];
        break;
      }
    }

    // Check for standalone number word
    if (numberWords[word] !== undefined && numberWords[word] >= 1) {
      quantity = numberWords[word];
      quantityIndices = [i];
      break;
    }

    // Check for digit
    const num = parseFloat(word);
    if (!isNaN(num) && num > 0) {
      quantity = num;
      quantityIndices = [i];
      break;
    }
  }

  // Find product type
  let productType = null;
  const typeIndex = words.findIndex(w => ['tub', 'tubs', 'pint', 'pints', 'quart', 'quarts'].includes(w));

  if (typeIndex >= 0) {
    const typeWord = words[typeIndex];
    if (typeWord.startsWith('tub')) productType = 'tub';
    else if (typeWord.startsWith('pint')) productType = 'pint';
    else if (typeWord.startsWith('quart')) productType = 'quart';
  }

  // Remaining words are the flavor name (exclude type and quantity words)
  const excludeIndices = new Set([typeIndex, ...quantityIndices]);
  const flavorWords = [];
  for (let i = 0; i < words.length; i++) {
    if (excludeIndices.has(i)) continue;
    flavorWords.push(words[i]);
  }

  const flavorName = flavorWords.join(' ');

  // Find matching flavor
  const matchedFlavor = findFlavorByName(flavorName);

  if (!matchedFlavor || !productType || !quantity) {
    return null;
  }

  // Return entry object
  return {
    flavor: matchedFlavor.name,
    flavorId: matchedFlavor.id,
    type: productType,
    quantity: quantity,
    action: 'set',
    confidence: 1.0
  };
}

function findFlavorByName(spokenName) {
  const normalized = spokenName.toLowerCase().trim();
  console.log('🔍 findFlavorByName searching for:', normalized);

  // Try exact match first
  let match = flavors.find(f => f.name.toLowerCase() === normalized);
  if (match) {
    console.log('✅ Exact match found:', match.name);
    return match;
  }

  // Try partial match (contains) - prefer longer matches
  const partialMatches = flavors.filter(f => f.name.toLowerCase().includes(normalized));
  if (partialMatches.length > 0) {
    // Sort by name length (descending) to prefer more specific matches
    partialMatches.sort((a, b) => b.name.length - a.name.length);
    match = partialMatches[0];
    console.log('✅ Partial match found:', match.name);
    return match;
  }

  // Try reverse (spoken contains flavor name) - prefer LONGEST matches
  // This prevents "Vanilla" from matching when "Black Cherry Vanilla" should match
  const reverseMatches = flavors.filter(f => normalized.includes(f.name.toLowerCase()));
  if (reverseMatches.length > 0) {
    // Sort by name length (descending) to prefer longer/more specific matches
    reverseMatches.sort((a, b) => b.name.length - a.name.length);
    match = reverseMatches[0];
    console.log('✅ Reverse match found (longest):', match.name);
    return match;
  }

  // Try fuzzy match (all words present)
  const spokenWords = normalized.split(/\s+/);
  match = flavors.find(f => {
    const flavorWords = f.name.toLowerCase().split(/\s+/);
    return flavorWords.every(fw => spokenWords.some(sw => sw.includes(fw) || fw.includes(sw)));
  });

  if (match) {
    console.log('✅ Fuzzy match found:', match.name);
  } else {
    console.log('❌ No match found for:', normalized);
  }

  return match;
}

// ===== CONVERSATIONAL VOICE INPUT =====

// Global state for voice confirmation
let currentVoiceParseResult = null;
let voiceHistory = []; // Track voice entry history for undo
let voiceUndoStack = []; // Stack of changes for undo functionality

function preprocessConversationalInput(transcript) {
  let text = transcript.toLowerCase().trim();

  // Remove conversational fillers
  const fillers = [
    'oh wait', 'oh and', 'wait a minute', 'hold on',
    'let me', 'i need to', 'i want to', 'i found',
    'um', 'uh', 'like', 'you know'
  ];
  fillers.forEach(filler => {
    text = text.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '');
  });

  // Normalize articles and conjunctions
  text = text.replace(/\b(a|an|the)\b/gi, '');

  // Detect action intent
  const isAddAction = /\b(add|plus|also|another|found|more)\b/i.test(text);
  const action = isAddAction ? 'add' : 'set';

  // Remove action phrases
  text = text.replace(/\b(to the count|to count)\b/gi, '');

  return { text: text.trim(), action };
}

function isProductType(word) {
  if (!word) return false;
  return ['tub', 'tubs', 'pint', 'pints', 'quart', 'quarts'].includes(word.toLowerCase());
}

function isQuantityWord(word) {
  if (!word) return false;
  const numberWords = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen', 'twenty', 'half', 'quarter', 'third', 'fourth'
  ];
  return numberWords.includes(word.toLowerCase());
}

function isDigit(word) {
  if (!word) return false;
  return !isNaN(parseFloat(word));
}

function extractEntrySegments(text) {
  // Split on "and" when next word is likely a new entry
  const words = text.split(/\s+/);
  const segments = [];
  let current = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];

    if (word === 'and') {
      // Check if next word starts a new entry (is a type or quantity)
      if (isProductType(next) || isQuantityWord(next) || isDigit(next)) {
        // New entry starts
        if (current.length > 0) {
          segments.push(current.join(' '));
        }
        current = [];
      } else {
        // Part of compound flavor list
        current.push(word);
      }
    } else {
      current.push(word);
    }
  }

  if (current.length > 0) {
    segments.push(current.join(' '));
  }

  return segments.filter(s => s.trim().length > 0);
}

function extractQuantity(segment) {
  const words = segment.split(/\s+/);
  console.log('🔍 extractQuantity from:', segment);

  const numberWords = {
    'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    'half': 0.5, 'quarter': 0.25, 'third': 0.33
  };

  // Check for patterns like "two and half" or "seven and quarter"
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();

    // Check for "X and half/quarter" pattern
    if (numberWords[word] !== undefined && i + 2 < words.length) {
      if (words[i + 1] === 'and' && (words[i + 2] === 'half' || words[i + 2] === 'quarter')) {
        const qty = numberWords[word] + (words[i + 2] === 'half' ? 0.5 : 0.25);
        console.log('✅ Found quantity (word + fraction):', qty);
        return qty;
      }
    }

    // Check for standalone number word
    if (numberWords[word] !== undefined && numberWords[word] >= 1) {
      console.log('✅ Found quantity (word):', numberWords[word]);
      return numberWords[word];
    }

    // Check for digit (including decimals like 2.5)
    const num = parseFloat(word);
    if (!isNaN(num) && num > 0) {
      console.log('✅ Found quantity (digit):', num);
      return num;
    }
  }

  console.log('⚠️ No quantity found, defaulting to 1');
  return null;
}

function extractProductType(segment) {
  const words = segment.split(/\s+/);

  for (let word of words) {
    word = word.toLowerCase();
    if (word.startsWith('tub')) return 'tub';
    if (word.startsWith('pint')) return 'pint';
    if (word.startsWith('quart')) return 'quart';
  }

  return null;
}

function extractFlavorText(segment, quantity, type) {
  let text = segment;
  console.log('🔍 extractFlavorText input:', segment);

  // Remove quantity words (but NOT "and" - that's for compound flavors)
  if (quantity) {
    const numberWords = [
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
      'eighteen', 'nineteen', 'twenty', 'half', 'quarter', 'third'
      // NOTE: Removed 'and' from here - we need it for "vanilla and chocolate"
    ];
    numberWords.forEach(word => {
      text = text.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
    });
    // Also remove digit
    text = text.replace(/\b\d+(\.\d+)?\b/g, '');
  }

  // Remove type words
  if (type) {
    text = text.replace(/\b(tub|tubs|pint|pints|quart|quarts)\b/gi, '');
  }

  // Remove "of"
  text = text.replace(/\bof\b/gi, '');

  const result = text.trim();
  console.log('🔍 extractFlavorText output:', result);
  return result;
}

function parseFlavorList(text) {
  // Split "vanilla and chocolate" into ["vanilla", "chocolate"]
  // But keep "black cherry vanilla" as one (only split on " and " with spaces)
  const parts = text.split(/\s+and\s+/).map(f => f.trim()).filter(f => f.length > 0);
  console.log('🔍 parseFlavorList input:', text, '→ output:', parts);
  return parts;
}

function calculateMatchConfidence(spokenName, matchedFlavor) {
  const normalized = spokenName.toLowerCase().trim();
  const flavorName = matchedFlavor.name.toLowerCase();

  // Exact match = 1.0
  if (normalized === flavorName) return 1.0;

  // Contains match = 0.8
  if (flavorName.includes(normalized) || normalized.includes(flavorName)) return 0.8;

  // Fuzzy match = 0.6
  return 0.6;
}

function calculateConfidence(entries) {
  if (entries.length === 0) return 0;

  const sum = entries.reduce((acc, entry) => acc + (entry.confidence || 0.5), 0);
  return sum / entries.length;
}

function parseSegment(segment, defaultAction) {
  const quantity = extractQuantity(segment) || 1;
  const type = extractProductType(segment);
  const flavorText = extractFlavorText(segment, quantity, type);

  if (!type) return null;

  // Check for compound flavors: "vanilla and chocolate"
  const flavors = parseFlavorList(flavorText);

  // Create entry for each flavor
  return flavors.map(flavorName => {
    const matchedFlavor = findFlavorByName(flavorName);
    if (!matchedFlavor) return null;

    return {
      flavor: matchedFlavor.name,
      flavorId: matchedFlavor.id,
      type,
      quantity,
      action: defaultAction,
      confidence: calculateMatchConfidence(flavorName, matchedFlavor)
    };
  }).filter(e => e !== null);
}

function parseConversationalInput(transcript) {
  const { text, action } = preprocessConversationalInput(transcript);
  const entries = [];

  console.log('🔍 PREPROCESSED TEXT:', text);
  console.log('🎯 ACTION:', action);

  // Check for shared context pattern: "these are all tubs: vanilla, chocolate, strawberry"
  const sharedContextMatch = text.match(/(?:these are |all |they're all |i (?:made|want to add|want to make|made) )?(all )?(tubs?|pints?|quarts?)(?:[:\s,]+|(?:\s+i'?m?\s+(?:gonna|going to)\s+list\s+off:?\s*))(.*)/i);

  console.log('🔎 SHARED CONTEXT MATCH:', sharedContextMatch);

  if (sharedContextMatch) {
    const sharedType = normalizeProductType(sharedContextMatch[2]);
    const flavorList = sharedContextMatch[3];

    // Split by commas and "and"
    const flavors = flavorList
      .split(/,|\band\b/)
      .map(f => f.trim())
      .filter(f => f.length > 0);

    // Default quantity is 1 for each
    for (const flavorText of flavors) {
      // Check if this flavor has a quantity prefix (e.g., "2 vanilla", "three chocolate")
      const qtyMatch = flavorText.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(.+)/i);
      let quantity = 1;
      let flavorName = flavorText;

      if (qtyMatch) {
        quantity = parseNumberWord(qtyMatch[1]) || 1;
        flavorName = qtyMatch[2];
      }

      const matchedFlavor = findFlavorByName(flavorName);
      if (matchedFlavor) {
        entries.push({
          flavor: matchedFlavor.name,
          flavorId: matchedFlavor.id,
          type: sharedType,
          quantity: quantity,
          action: action,
          confidence: calculateMatchConfidence(flavorName, matchedFlavor)
        });
      }
    }

    if (entries.length > 0) {
      return {
        entries,
        rawTranscript: transcript,
        success: true,
        confidence: calculateConfidence(entries)
      };
    }
  }

  // Fall back to original segmented parsing
  const segments = extractEntrySegments(text);

  for (const segment of segments) {
    const parsed = parseSegment(segment, action);
    if (parsed) {
      entries.push(...parsed);
    }
  }

  return {
    entries,
    rawTranscript: transcript,
    success: entries.length > 0,
    confidence: calculateConfidence(entries)
  };
}

function normalizeProductType(type) {
  const t = type.toLowerCase();
  if (t.startsWith('tub')) return 'tub';
  if (t.startsWith('pint')) return 'pint';
  if (t.startsWith('quart')) return 'quart';
  return 'tub'; // default
}

function parseNumberWord(word) {
  const numberWords = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'half': 0.5, 'quarter': 0.25
  };

  const normalized = word.toLowerCase().trim();

  // Check for "two and a half" pattern
  const andHalfMatch = normalized.match(/(\w+)\s+and\s+a\s+(half|quarter)/);
  if (andHalfMatch) {
    const base = numberWords[andHalfMatch[1]] || parseInt(andHalfMatch[1]);
    const fraction = andHalfMatch[2] === 'half' ? 0.5 : 0.25;
    return base + fraction;
  }

  // Check for number words
  if (numberWords[normalized] !== undefined) {
    return numberWords[normalized];
  }

  // Check for decimal numbers
  const num = parseFloat(word);
  if (!isNaN(num)) {
    return num;
  }

  return null;
}

function applyVoiceEntries(entries) {
  const updates = [];
  const failures = [];
  const undoData = []; // Track changes for undo

  for (const entry of entries) {
    const key = `${entry.flavorId}-${entry.type}`;
    const input = document.getElementById(`count-${key}`);

    if (!input) {
      failures.push(`${entry.flavor} ${entry.type} not visible`);
      continue;
    }

    // Save old value for undo
    const oldValue = parseFloat(input.value) || 0;

    let newValue;
    if (entry.action === 'add') {
      const current = parseFloat(input.value) || 0;
      newValue = current + entry.quantity;
    } else {
      newValue = entry.quantity;
    }

    input.value = newValue;
    countEdits[key] = newValue;
    updatePartialToggle(key);
    updateVarianceIndicator(key);

    // Visual feedback
    input.classList.add('voice-updated-batch');
    input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    updates.push({
      flavor: entry.flavor,
      type: entry.type,
      quantity: entry.quantity,
      action: entry.action,
      newValue
    });

    // Track for undo
    undoData.push({
      key,
      oldValue,
      newValue,
      flavor: entry.flavor,
      type: entry.type
    });
  }

  // Save to undo stack
  if (undoData.length > 0) {
    voiceUndoStack.push(undoData);
    // Keep only last 5 undo actions
    if (voiceUndoStack.length > 5) {
      voiceUndoStack.shift();
    }
  }

  // Show batch feedback
  if (updates.length > 0 || failures.length > 0) {
    showBatchVoiceFeedback(updates, failures);

    // Voice confirmation if enabled
    if (updates.length > 0 && isVoiceConfirmationEnabled()) {
      speakVoiceConfirmation(updates);
    }
  }

  // Update running total
  updateRunningTotal();

  // Update uncounted highlights
  updateUncountedhighlights();

  // Clear animation after delay
  setTimeout(() => {
    document.querySelectorAll('.voice-updated-batch').forEach(el => {
      el.classList.remove('voice-updated-batch');
    });
  }, 2000);

  return { updates, failures };
}

function showBatchVoiceFeedback(updates, failures) {
  const feedback = document.getElementById('voice-feedback');

  let html = `<strong>✅ Applied ${updates.length} entries:</strong><br>`;
  html += updates.map(u =>
    `${esc(u.flavor)} ${u.type}: ${u.action === 'add' ? `+${u.quantity}` : u.quantity} → ${u.newValue}`
  ).join('<br>');

  if (failures.length > 0) {
    html += `<br><strong style="color: var(--red)">⚠️ ${failures.length} failed:</strong><br>`;
    html += failures.map(f => esc(f)).join('<br>');
  }

  feedback.innerHTML = html;
  feedback.className = 'voice-feedback success';
  feedback.classList.remove('hidden');
}

function showVoiceConfirmation(result) {
  const modal = document.getElementById('voice-confirm-modal');
  const tbody = modal.querySelector('#voice-entries-tbody');

  tbody.innerHTML = result.entries.map((entry, idx) => `
    <tr>
      <td>${esc(entry.flavor)}</td>
      <td>${entry.type}</td>
      <td>${entry.quantity}</td>
      <td>${entry.action === 'add' ? '+Add' : 'Set'}</td>
      <td><button class="btn-small" onclick="removeVoiceEntry(${idx})">✕</button></td>
    </tr>
  `).join('');

  modal.classList.remove('hidden');
}

function confirmVoiceEntries() {
  const result = currentVoiceParseResult;
  if (result && result.entries.length > 0) {
    applyVoiceEntries(result.entries);
  }
  closeVoiceConfirmModal();
}

function closeVoiceConfirmModal() {
  const modal = document.getElementById('voice-confirm-modal');
  modal.classList.add('hidden');
  currentVoiceParseResult = null;
}

function removeVoiceEntry(idx) {
  if (currentVoiceParseResult && currentVoiceParseResult.entries[idx]) {
    currentVoiceParseResult.entries.splice(idx, 1);
    showVoiceConfirmation(currentVoiceParseResult);
  }
}

// ===== VOICE ENHANCEMENTS =====

// 1. UNDO FUNCTIONALITY
function undoLastVoiceEntry() {
  if (voiceUndoStack.length === 0) {
    showVoiceFeedback('❌ Nothing to undo', true, 'error');
    toast('No voice entries to undo', 'error');
    return;
  }

  const lastChanges = voiceUndoStack.pop();
  const reverted = [];

  for (const change of lastChanges) {
    const input = document.getElementById(`count-${change.key}`);
    if (input) {
      input.value = change.oldValue;
      countEdits[change.key] = change.oldValue;
      updatePartialToggle(change.key);
      updateVarianceIndicator(change.key);

      // Visual feedback
      input.classList.add('voice-undo-highlight');
      input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      reverted.push(`${change.flavor} ${change.type}: ${change.newValue} → ${change.oldValue}`);
    }
  }

  showVoiceFeedback(`↩️ Undone: ${reverted.join(', ')}`, true, 'success');
  toast(`Undid ${lastChanges.length} voice entries`, 'success');

  // Update displays
  updateRunningTotal();
  updateUncountedhighlights();

  // Clear animation
  setTimeout(() => {
    document.querySelectorAll('.voice-undo-highlight').forEach(el => {
      el.classList.remove('voice-undo-highlight');
    });
  }, 2000);
}

// 2. VOICE CONFIRMATION READBACK
function isVoiceConfirmationEnabled() {
  const checkbox = document.getElementById('voice-readback-enabled');
  return checkbox && checkbox.checked;
}

function speakVoiceConfirmation(updates) {
  if (!window.speechSynthesis) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const count = updates.length;
  let text = `I heard ${count} item${count !== 1 ? 's' : ''}: `;

  const items = updates.map(u => {
    const qty = u.action === 'add' ? `plus ${u.quantity}` : u.quantity;
    return `${u.flavor} ${u.type} ${qty}`;
  }).join(', ');

  text += items;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1; // Slightly faster
  utterance.pitch = 1.0;
  utterance.volume = 0.8;

  window.speechSynthesis.speak(utterance);
}

// 3. RUNNING TOTAL DISPLAY
function updateRunningTotal() {
  const totalDisplay = document.getElementById('count-running-total');
  if (!totalDisplay) return;

  // Count total visible inputs
  const allInputs = document.querySelectorAll('[id^="count-"]');
  const total = allInputs.length;

  // Count how many have been edited (changed from default)
  let counted = 0;
  allInputs.forEach(input => {
    const key = input.id.replace('count-', '');
    if (countEdits[key] !== undefined) {
      counted++;
    }
  });

  const percentage = total > 0 ? Math.round((counted / total) * 100) : 0;
  const isComplete = counted === total && total > 0;

  totalDisplay.innerHTML = `
    <div class="running-total-content ${isComplete ? 'complete' : ''}">
      <div class="running-total-label">Count Progress</div>
      <div class="running-total-numbers">
        <span class="running-total-counted">${counted}</span>
        <span class="running-total-separator">/</span>
        <span class="running-total-total">${total}</span>
      </div>
      <div class="running-total-bar">
        <div class="running-total-fill" style="width: ${percentage}%"></div>
      </div>
      <div class="running-total-percent">${percentage}% Complete</div>
      ${isComplete ? '<div class="running-total-badge">✓ All Items Counted</div>' : ''}
    </div>
  `;
}

// 4. HIGHLIGHT UNCOUNTED ITEMS
function updateUncountedhighlights() {
  const allRows = document.querySelectorAll('.count-row');

  allRows.forEach(row => {
    const input = row.querySelector('[id^="count-"]');
    if (!input) return;

    const key = input.id.replace('count-', '');
    const hasBeenCounted = countEdits[key] !== undefined;

    if (hasBeenCounted) {
      row.classList.add('counted');
      row.classList.remove('uncounted');

      // Add checkmark badge if not already present
      if (!row.querySelector('.counted-badge')) {
        const badge = document.createElement('div');
        badge.className = 'counted-badge';
        badge.innerHTML = '✓';
        row.querySelector('.count-flavor').appendChild(badge);
      }
    } else {
      row.classList.remove('counted');
      row.classList.add('uncounted');

      // Remove checkmark if present
      const badge = row.querySelector('.counted-badge');
      if (badge) badge.remove();
    }
  });
}

function toggleVoiceReadback() {
  const checkbox = document.getElementById('voice-readback-enabled');
  const status = checkbox.checked ? 'enabled' : 'disabled';
  localStorage.setItem('voice-readback-enabled', checkbox.checked);
  toast(`Voice readback ${status}`, 'success');
}

// ===== PRODUCTION VOICE INPUT =====

let productionVoiceRecognition = null;
let isProductionVoiceActive = false;
let currentProductionVoiceResult = null;

function toggleProductionVoiceInput() {
  if (!productionVoiceRecognition) {
    productionVoiceRecognition = initProductionVoiceRecognition();
    if (!productionVoiceRecognition) {
      toast('Voice input not supported in this browser. Try Chrome or Edge.', 'error');
      return;
    }
  }

  if (isProductionVoiceActive) {
    stopProductionVoiceInput();
  } else {
    startProductionVoiceInput();
  }
}

function initProductionVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('Speech recognition not supported in this browser');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const last = event.results.length - 1;
    const transcript = event.results[last][0].transcript.toLowerCase().trim();
    const isFinal = event.results[last].isFinal;

    showProductionVoiceFeedback(transcript, isFinal);

    if (isFinal) {
      parseProductionVoiceCommand(transcript);
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'no-speech') {
      showProductionVoiceFeedback('No speech detected. Try again.', true, 'error');
    } else if (event.error === 'not-allowed') {
      showProductionVoiceFeedback('Microphone access denied.', true, 'error');
      stopProductionVoiceInput();
    } else {
      showProductionVoiceFeedback(`Error: ${event.error}`, true, 'error');
    }
  };

  recognition.onend = () => {
    if (isProductionVoiceActive) {
      recognition.start();
    }
  };

  return recognition;
}

function startProductionVoiceInput() {
  isProductionVoiceActive = true;
  const btn = document.getElementById('prod-voice-input-btn');
  btn.classList.add('voice-active');
  btn.innerHTML = '<span class="voice-icon">🔴</span> Listening...';

  showProductionVoiceFeedback('Listening... Say: "I made tubs: vanilla, chocolate, strawberry" or "5 tubs of vanilla"', false);

  try {
    productionVoiceRecognition.start();
  } catch (e) {
    console.error('Failed to start voice recognition:', e);
  }
}

function stopProductionVoiceInput() {
  isProductionVoiceActive = false;
  const btn = document.getElementById('prod-voice-input-btn');
  btn.classList.remove('voice-active');
  btn.innerHTML = '<span class="voice-icon">🎤</span> Voice Input';

  if (productionVoiceRecognition) {
    productionVoiceRecognition.stop();
  }

  setTimeout(() => {
    const feedback = document.getElementById('prod-voice-feedback');
    feedback.classList.add('hidden');
  }, 2000);
}

function showProductionVoiceFeedback(text, isFinal, type = 'info') {
  const feedback = document.getElementById('prod-voice-feedback');
  feedback.classList.remove('hidden');
  feedback.className = `voice-feedback ${type}`;

  if (isFinal) {
    feedback.innerHTML = `<strong>Heard:</strong> "${esc(text)}"`;
  } else {
    feedback.innerHTML = `<span class="voice-interim">${esc(text)}...</span>`;
  }
}

async function parseProductionVoiceCommand(transcript) {
  // Check for submit/commit command
  if (/\b(done log production|commit|submit|done)\b/i.test(transcript)) {
    showProductionVoiceFeedback('✅ Submitting production...', false, 'info');
    // Trigger the submit button click
    const submitBtn = document.getElementById('prod-submit-btn');
    if (submitBtn && !submitBtn.disabled) {
      submitBtn.click();
    } else {
      showProductionVoiceFeedback('❌ Cannot submit - enter your name and add at least one item', true, 'error');
    }
    return;
  }

  // Check for stop/turn off voice command
  if (/\b(stop|stop listening|turn off voice|voice off|stop voice|cancel)\b/i.test(transcript)) {
    stopProductionVoiceInput();
    showProductionVoiceFeedback('✅ Voice input turned off', true, 'success');
    return;
  }

  // Check for undo command
  if (/\b(undo|undo last|cancel last)\b/i.test(transcript)) {
    undoLastProductionVoiceEntry();
    return;
  }

  // Parse conversational input for production
  const result = parseConversationalInput(transcript);

  console.log('📊 PRODUCTION PARSED RESULT:', result);
  console.log(`   - Entries found: ${result.entries.length}`);

  if (result.success && result.confidence > 0.7) {
    // High confidence - apply to list-based UI directly
    applyProductionVoiceEntries(result.entries);
  } else if (result.success && result.confidence > 0.4) {
    // Medium confidence - try AI boost if enabled
    if (isProductionAIBoostEnabled()) {
      await tryProductionAIBoostParse(transcript, result);
    } else {
      applyProductionVoiceEntries(result.entries);
      toast('Low confidence - please verify entries', 'warning');
    }
  } else {
    // Low confidence - try AI boost if enabled
    if (isProductionAIBoostEnabled()) {
      await tryProductionAIBoostParse(transcript, null);
    } else {
      showProductionVoiceFeedback('❌ Could not parse. Try: "I made 5 tubs of vanilla"', true, 'error');
    }
  }
}

async function tryProductionAIBoostParse(transcript, fallbackResult) {
  showProductionVoiceFeedback('🤖 AI Boost processing...', false, 'info');

  try {
    const aiResult = await parseVoiceCommandWithGroq(transcript);

    if (aiResult.success && aiResult.entries.length > 0) {
      // AI succeeded - apply to list-based UI
      applyProductionVoiceEntries(aiResult.entries);
      toast('🤖 AI Boost parsed successfully', 'success');
    } else if (fallbackResult && fallbackResult.entries.length > 0) {
      // AI failed, use fallback
      applyProductionVoiceEntries(fallbackResult.entries);
      toast('Using standard parser (AI boost unclear)', 'warning');
    } else {
      showProductionVoiceFeedback(`❌ Could not parse even with AI Boost.`, true, 'error');
    }
  } catch (error) {
    console.error('AI Boost error:', error);
    if (fallbackResult && fallbackResult.entries.length > 0) {
      applyProductionVoiceEntries(fallbackResult.entries);
      toast('AI Boost failed, using standard parser', 'warning');
    } else {
      showProductionVoiceFeedback(`❌ AI Boost error`, true, 'error');
    }
  }
}

function isProductionAIBoostEnabled() {
  const checkbox = document.getElementById('prod-ai-boost-enabled');
  return checkbox && checkbox.checked;
}

function toggleProductionAIBoost() {
  const checkbox = document.getElementById('prod-ai-boost-enabled');
  const status = checkbox.checked ? 'enabled' : 'disabled';
  localStorage.setItem('prod-ai-boost-enabled', checkbox.checked);

  if (checkbox.checked) {
    toast('🤖 Production AI Boost enabled', 'success');
  } else {
    toast('Production AI Boost disabled', 'success');
  }
}

// ===== PRODUCTION FRACTIONAL SUPPORT =====

function setProductionPartial(frac) {
  const input = document.getElementById('prod-qty');
  if (!input) return;

  const current = parseFloat(input.value) || 0;
  const whole = Math.floor(current);
  const newValue = whole + frac;

  input.value = newValue;

  // Update active button
  const partialToggle = document.getElementById('prod-partial-toggle');
  if (partialToggle) {
    partialToggle.querySelectorAll('.partial-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.frac) === frac);
    });
  }
}

function adjustProductionQty(delta) {
  const input = document.getElementById('prod-qty');
  const typeInput = document.getElementById('prod-type');
  if (!input) return;

  const isTub = typeInput && typeInput.value === 'tub';
  const step = isTub ? 0.25 : 1;
  const current = parseFloat(input.value) || 0;
  const newValue = Math.max(0, current + (delta * step));

  input.value = newValue;

  // Update partial toggle if tubs
  if (isTub) {
    updateProductionPartialToggleButtons();
  }
}

function updateProductionPartialToggleButtons() {
  const input = document.getElementById('prod-qty');
  const partialToggle = document.getElementById('prod-partial-toggle');

  if (!input || !partialToggle) return;

  const value = parseFloat(input.value) || 0;
  const frac = Math.round((value - Math.floor(value)) * 100) / 100;

  partialToggle.querySelectorAll('.partial-btn').forEach(btn => {
    const btnFrac = parseFloat(btn.dataset.frac);
    btn.classList.toggle('active', Math.abs(btnFrac - frac) < 0.01);
  });
}

// ===== PRODUCTION FORM LOCK =====

function isProductionEmployeeNameEntered() {
  const prodEmployeeInput = document.getElementById('prod-employee-name');
  const employeeName = prodEmployeeInput?.value?.trim();
  return employeeName && employeeName.length >= 2;
}

function updateProductionFormLock() {
  const isLocked = !isProductionEmployeeNameEntered();
  const employeeWrap = document.getElementById('prod-employee-wrap');
  const voiceBtn = document.getElementById('prod-voice-input-btn');

  // Re-render form to update locked state
  renderProductionForm();

  // Update employee input wrap styling
  if (employeeWrap) {
    if (isLocked) {
      employeeWrap.classList.add('required');
    } else {
      employeeWrap.classList.remove('required');
    }
  }

  // Update voice button
  if (voiceBtn) {
    voiceBtn.disabled = isLocked;
  }

  // Submit button state is handled by updateProductionSubmitButtonState in renderProductionForm
}

// NEW: Apply multiple production voice entries to list-based UI
function applyProductionVoiceEntries(entries) {
  const updates = [];
  const failures = [];
  const undoData = [];

  for (const entry of entries) {
    const key = `${entry.flavorId}-${entry.type}`;
    const input = document.getElementById(`prod-${key}`);

    if (!input) {
      failures.push(`${entry.flavor} ${entry.type} not visible`);
      continue;
    }

    // Save old value for undo
    const oldValue = parseFloat(input.value) || 0;

    let newValue;
    if (entry.action === 'add') {
      newValue = oldValue + entry.quantity;
    } else {
      newValue = entry.quantity;
    }

    input.value = newValue;
    productionEdits[key] = newValue;
    updateProductionPartialToggleUI(key);

    // Visual feedback
    input.classList.add('voice-updated-batch');
    input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    updates.push({
      flavor: entry.flavor,
      type: entry.type,
      quantity: entry.quantity,
      action: entry.action,
      newValue
    });

    undoData.push({
      key,
      oldValue,
      newValue,
      flavor: entry.flavor,
      type: entry.type
    });
  }

  // Save to undo stack
  if (undoData.length > 0) {
    productionVoiceUndoStack.push(undoData);
    if (productionVoiceUndoStack.length > 5) {
      productionVoiceUndoStack.shift();
    }
  }

  // Show batch feedback
  if (updates.length > 0 || failures.length > 0) {
    showProductionBatchVoiceFeedback(updates, failures);

    // Voice confirmation if enabled
    if (updates.length > 0 && isProductionVoiceReadbackEnabled()) {
      speakProductionVoiceConfirmation(updates);
    }
  }

  // Update submit button state
  updateProductionSubmitButtonState();

  // Clear animation after delay
  setTimeout(() => {
    document.querySelectorAll('.voice-updated-batch').forEach(el => {
      el.classList.remove('voice-updated-batch');
    });
  }, 2000);

  return { updates, failures };
}

function showProductionBatchVoiceFeedback(updates, failures) {
  const feedback = document.getElementById('prod-voice-feedback');

  let html = `<strong>✅ Applied ${updates.length} entries:</strong><br>`;
  html += updates.map(u =>
    `${esc(u.flavor)} ${u.type}: ${u.action === 'add' ? `+${u.quantity}` : u.quantity} → ${u.newValue}`
  ).join('<br>');

  if (failures.length > 0) {
    html += `<br><strong style="color: var(--red)">⚠️ ${failures.length} failed:</strong><br>`;
    html += failures.map(f => esc(f)).join('<br>');
  }

  feedback.innerHTML = html;
  feedback.className = 'prod-voice-feedback success';
  feedback.classList.remove('hidden');
}

function speakProductionVoiceConfirmation(updates) {
  if (!('speechSynthesis' in window)) return;

  const itemsText = updates.length === 1
    ? `${updates[0].quantity} ${updates[0].type} of ${updates[0].flavor}`
    : `${updates.length} production entries`;

  const utterance = new SpeechSynthesisUtterance(`Updated ${itemsText}`);
  utterance.rate = 1.2;
  utterance.pitch = 1.0;
  utterance.volume = 0.8;

  window.speechSynthesis.speak(utterance);
}

function undoLastProductionVoiceEntry() {
  if (productionVoiceUndoStack.length === 0) {
    showProductionVoiceFeedback('⚠️ No voice changes to undo', true, 'warning');
    return;
  }

  const lastChange = productionVoiceUndoStack.pop();

  // Revert changes
  for (const change of lastChange) {
    const input = document.getElementById(`prod-${change.key}`);
    if (input) {
      input.value = change.oldValue;
      productionEdits[change.key] = change.oldValue;
      updateProductionPartialToggleUI(change.key);
    }
  }

  updateProductionSubmitButtonState();

  const itemsText = lastChange.length === 1
    ? `${lastChange[0].flavor} ${lastChange[0].type}`
    : `${lastChange.length} entries`;

  showProductionVoiceFeedback(`↩️ Undid ${itemsText}`, true, 'info');
}

// OLD: Single-entry voice function (kept for backwards compatibility, but not used with list UI)
function applyProductionVoiceEntry(entry) {
  // This is now only used if the list-based UI is not rendered
  // In practice, we'll always use applyProductionVoiceEntries with the list UI
  console.warn('applyProductionVoiceEntry called - this should not happen with list UI');
}

function showProductionVoiceBatchModal(result) {
  const modal = document.getElementById('prod-voice-batch-modal');
  const tbody = modal.querySelector('#prod-voice-entries-tbody');

  tbody.innerHTML = result.entries.map((entry, idx) => `
    <tr>
      <td>${esc(entry.flavor)}</td>
      <td>${entry.type}</td>
      <td>${entry.quantity}</td>
      <td><button class="btn-small" onclick="removeProductionVoiceEntry(${idx})">✕</button></td>
    </tr>
  `).join('');

  modal.classList.remove('hidden');
}

async function confirmProductionVoiceBatch() {
  const result = currentProductionVoiceResult;
  if (!result || !result.entries.length) return;

  const employeeName = document.getElementById('prod-employee-name').value.trim();
  if (!employeeName) {
    toast('Please enter your name first', 'error');
    closeProductionVoiceBatchModal();
    document.getElementById('prod-employee-name').focus();
    return;
  }

  // Submit all entries
  let successCount = 0;
  for (const entry of result.entries) {
    try {
      await api('/api/production', {
        method: 'POST',
        body: JSON.stringify({
          flavor_id: entry.flavorId,
          product_type: entry.type,
          quantity: entry.quantity,
          employee_name: employeeName
        })
      });
      successCount++;
    } catch (e) {
      console.error('Failed to log production:', e);
    }
  }

  closeProductionVoiceBatchModal();
  toast(`Logged ${successCount} production entries!`, 'success');
  loadProductionHistory();

  // Voice confirmation
  if (isProductionVoiceReadbackEnabled()) {
    speakBatchConfirmation(successCount);
  }
}

function closeProductionVoiceBatchModal() {
  document.getElementById('prod-voice-batch-modal').classList.add('hidden');
  currentProductionVoiceResult = null;
}

function removeProductionVoiceEntry(idx) {
  if (currentProductionVoiceResult && currentProductionVoiceResult.entries[idx]) {
    currentProductionVoiceResult.entries.splice(idx, 1);
    showProductionVoiceBatchModal(currentProductionVoiceResult);
  }
}

function isProductionVoiceReadbackEnabled() {
  const checkbox = document.getElementById('prod-voice-readback-enabled');
  return checkbox && checkbox.checked;
}

function speakProductionConfirmation(entry) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const text = `Ready to log ${entry.quantity} ${entry.type}${entry.quantity !== 1 ? 's' : ''} of ${entry.flavor}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.volume = 0.8;
  window.speechSynthesis.speak(utterance);
}

function speakBatchConfirmation(count) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();

  const text = `Logged ${count} production entr${count !== 1 ? 'ies' : 'y'}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  utterance.volume = 0.8;
  window.speechSynthesis.speak(utterance);
}

function toggleProductionVoiceReadback() {
  const checkbox = document.getElementById('prod-voice-readback-enabled');
  const status = checkbox.checked ? 'enabled' : 'disabled';
  localStorage.setItem('prod-voice-readback-enabled', checkbox.checked);
  toast(`Production voice readback ${status}`, 'success');
}

function adjustCountQty(key, delta) {
  const input = document.getElementById(`count-${key}`);
  const current = parseFloat(input.value) || 0;
  // For tubs: step the whole part only, keeping the fractional part
  const isTub = key.endsWith('-tub');
  if (isTub) {
    const whole = Math.floor(current);
    const frac = current - whole;
    const newWhole = Math.max(0, whole + delta);
    const newVal = newWhole + frac;
    input.value = newVal;
    countEdits[key] = newVal;
  } else {
    const newVal = Math.max(0, Math.round(current) + delta);
    input.value = newVal;
    countEdits[key] = newVal;
  }
  updatePartialToggle(key);
  updateVarianceIndicator(key);
}

function setPartial(key, fraction) {
  const input = document.getElementById(`count-${key}`);
  const current = parseFloat(input.value) || 0;
  const whole = Math.floor(current);
  const newVal = whole + fraction;
  input.value = newVal;
  countEdits[key] = newVal;
  // Update toggle button active states
  const toggleWrap = document.getElementById(`partial-${key}`);
  if (toggleWrap) {
    toggleWrap.querySelectorAll('.partial-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.frac) === fraction);
    });
  }
  updateVarianceIndicator(key);
}

function updatePartialToggle(key) {
  const toggleWrap = document.getElementById(`partial-${key}`);
  if (!toggleWrap) return;
  const current = parseFloat(countEdits[key]) || 0;
  const frac = Math.round((current - Math.floor(current)) * 100) / 100;
  toggleWrap.querySelectorAll('.partial-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.frac) === frac);
  });
}

function calculateVariance(predicted, actual) {
  if (predicted == null || predicted === 0) {
    return { variance: 0, variancePct: 0, colorClass: 'variance-ok', icon: '✅', message: '' };
  }

  const variance = actual - predicted;
  const variancePct = Math.abs((variance / predicted) * 100);

  let colorClass, icon, message;
  if (variancePct <= 10) {
    colorClass = 'variance-ok';
    icon = '✅';
    message = '';
  } else if (variancePct <= 25) {
    colorClass = 'variance-warn';
    icon = '⚠️';
    message = 'Verify count';
  } else {
    colorClass = 'variance-high';
    icon = '🔴';
    message = 'Large difference - recount recommended';
  }

  return {
    variance: variance.toFixed(1),
    variancePct: variancePct.toFixed(0),
    colorClass,
    icon,
    message
  };
}

function updateVarianceIndicator(key) {
  const predicted = countPredictions[key] || 0;
  const actual = parseFloat(countEdits[key]) || 0;
  const indicator = document.getElementById(`variance-${key}`);

  if (!indicator) return;

  const { variance, variancePct, colorClass, icon, message } = calculateVariance(predicted, actual);

  let html = '';
  if (predicted > 0) {
    const sign = parseFloat(variance) >= 0 ? '+' : '';
    html = `
      <span class="variance-indicator ${colorClass}">
        ${icon} ${sign}${variance} (${variancePct}%)
        ${message ? `<span class="variance-message">${message}</span>` : ''}
      </span>
    `;
  }

  indicator.innerHTML = html;
}

function formatTubCount(n) {
  if (n == null) return '0';
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  if (frac === 0) return String(whole);
  const fracs = { 0.25: '\u00BC', 0.5: '\u00BD', 0.75: '\u00BE' };
  const symbol = fracs[frac];
  if (!symbol) return String(n);
  return whole > 0 ? `${whole}${symbol}` : symbol;
}

function formatBatchCount(n) {
  if (n == null || n === 0) return '0';
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 10) / 10;
  if (frac === 0) return String(whole);
  if (frac === 0.5) return whole > 0 ? `${whole}\u00BD` : '\u00BD';
  return n.toFixed(1);
}

// ===== FLAVORS =====
async function loadFlavors() {
  try {
    flavors = await api('/api/flavors?active_only=true');
    populateFlavorDropdowns();
    renderFlavorList();
    populateCategoryFilters();
  } catch (e) {
    console.error('Failed to load flavors:', e);
  }
}

function populateFlavorDropdowns() {
  // Note: Production now uses list-based UI, so no dropdowns needed
  // This function is kept for potential future use
  const selects = [];
  selects.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    const grouped = groupByCategory(flavors);
    for (const [cat, items] of Object.entries(grouped)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = cat;
      items.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        optgroup.appendChild(opt);
      });
      sel.appendChild(optgroup);
    }
  });
}

function populateCategoryFilters() {
  const cats = [...new Set(flavors.map(f => f.category))].sort();
  ['inv-category-filter', 'count-category-filter', 'prod-category-filter'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="all">All Categories</option>';
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
    sel.value = current || 'all';
  });
}

function groupByCategory(items) {
  const groups = {};
  items.forEach(item => {
    const cat = item.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });
  return groups;
}

function renderFlavorList() {
  const wrap = document.getElementById('flavor-list');
  if (!flavors.length) {
    wrap.innerHTML = '<p class="muted">No flavors yet. Add one above.</p>';
    return;
  }
  const grouped = groupByCategory(flavors);
  let html = '';
  for (const [cat, items] of Object.entries(grouped)) {
    html += `<div class="count-group-header">${cat}</div>`;
    items.forEach(f => {
      html += `
        <div class="flavor-item">
          <div>
            <div class="flavor-item-name">${esc(f.name)}</div>
          </div>
          <div class="flavor-item-actions">
            <button class="btn btn-secondary btn-sm" onclick="archiveFlavor(${f.id}, '${esc(f.name)}')">Archive</button>
          </div>
        </div>`;
    });
  }
  wrap.innerHTML = html;
}

async function addFlavor(e) {
  e.preventDefault();
  const name = document.getElementById('flavor-name').value.trim();
  const category = document.getElementById('flavor-category').value;
  if (!name) return;
  try {
    await api('/api/flavors', {
      method: 'POST',
      body: JSON.stringify({ name, category }),
    });
    document.getElementById('flavor-name').value = '';
    toast(`${name} added!`);
    await loadFlavors();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function archiveFlavor(id, name) {
  if (!confirm(`Archive "${name}"? It won't appear in counts anymore.`)) return;
  try {
    await api(`/api/flavors/${id}`, { method: 'DELETE' });
    toast(`${name} archived`);
    await loadFlavors();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ===== PAR LEVELS =====
async function loadParLevels() {
  try {
    parLevels = await api('/api/flavors/par-levels');
    parEdits = {};
    parLevels.forEach(p => {
      const key = `${p.flavor_id}-${p.product_type}`;
      parEdits[key] = {
        flavor_id: p.flavor_id,
        product_type: p.product_type,
        target: p.target,
        minimum: p.minimum,
        batch_size: p.batch_size,
        subsequent_batch_size: p.subsequent_batch_size ?? '',
        weekend_target: p.weekend_target ?? '',
      };
    });
    populateParCategoryFilter();
    renderParSetup();
  } catch (e) {
    console.error('Failed to load par levels:', e);
  }
}

function populateParCategoryFilter() {
  const cats = [...new Set(parLevels.map(p => p.category))].sort();
  const sel = document.getElementById('par-category-filter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="all">All Categories</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
  sel.value = current || 'all';
}

function renderParSetup() {
  const wrap = document.getElementById('par-setup-wrap');
  const catFilter = document.getElementById('par-category-filter').value;
  const typeFilter = document.getElementById('par-type-filter').value;

  let filtered = parLevels;
  if (catFilter !== 'all') filtered = filtered.filter(p => p.category === catFilter);
  if (typeFilter !== 'all') filtered = filtered.filter(p => p.product_type === typeFilter);

  // Group by category then flavor
  const byCat = {};
  filtered.forEach(p => {
    if (!byCat[p.category]) byCat[p.category] = {};
    const flavorKey = `${p.flavor_id}-${p.flavor_name}`;
    if (!byCat[p.category][flavorKey]) byCat[p.category][flavorKey] = [];
    byCat[p.category][flavorKey].push(p);
  });

  let html = '';
  for (const [cat, flavorsMap] of Object.entries(byCat)) {
    html += `<div class="par-group">`;
    html += `<div class="par-group-header">${esc(cat)}</div>`;

    for (const [flavorKey, items] of Object.entries(flavorsMap)) {
      const typeOrder = { tub: 0, pint: 1, quart: 2 };
      items.sort((a, b) => (typeOrder[a.product_type] ?? 9) - (typeOrder[b.product_type] ?? 9));
      items.forEach(p => {
        const key = `${p.flavor_id}-${p.product_type}`;
        const ed = parEdits[key] || { target: p.target, minimum: p.minimum, batch_size: p.batch_size, subsequent_batch_size: p.subsequent_batch_size ?? '', weekend_target: p.weekend_target ?? '' };
        html += `
          <div class="par-row">
            <div class="par-row-header">
              <span class="par-flavor-name">${esc(p.flavor_name)}</span>
              <span class="par-flavor-type">${p.product_type}</span>
            </div>
            <div class="par-fields">
              <div class="par-field">
                <label>Ready at open</label>
                <input type="number" inputmode="decimal" min="0" value="${ed.target}"
                  onchange="updateParEdit('${key}', 'target', this.value)">
              </div>
              <div class="par-field">
                <label>Make more at</label>
                <input type="number" inputmode="decimal" min="0" value="${ed.minimum}"
                  onchange="updateParEdit('${key}', 'minimum', this.value)">
              </div>
              <div class="par-field">
                <label>First batch makes</label>
                <input type="number" inputmode="decimal" min="0.25" step="0.25" value="${ed.batch_size}"
                  onchange="updateParEdit('${key}', 'batch_size', this.value)">
              </div>
              <div class="par-field">
                <label>Next batches make</label>
                <input type="number" inputmode="decimal" min="0" step="0.25" value="${ed.subsequent_batch_size}"
                  placeholder="—"
                  onchange="updateParEdit('${key}', 'subsequent_batch_size', this.value)">
              </div>
              <div class="par-field">
                <label>Weekend target</label>
                <input type="number" inputmode="decimal" min="0" value="${ed.weekend_target}"
                  placeholder="—"
                  onchange="updateParEdit('${key}', 'weekend_target', this.value)">
              </div>
            </div>
          </div>`;
      });
    }
    html += `</div>`;
  }

  wrap.innerHTML = html || '<p class="muted">No par levels configured yet. Run seed to get started.</p>';
}

function updateParEdit(key, field, value) {
  if (!parEdits[key]) {
    const [fid, ptype] = key.split('-');
    parEdits[key] = { flavor_id: parseInt(fid), product_type: ptype, target: 0, minimum: 0, batch_size: 1, subsequent_batch_size: '', weekend_target: '' };
  }
  if (field === 'weekend_target' || field === 'subsequent_batch_size') {
    parEdits[key][field] = value === '' ? '' : parseFloat(value) || 0;
  } else if (field === 'batch_size') {
    parEdits[key][field] = parseFloat(value) || 1;
  } else {
    parEdits[key][field] = parseInt(value) || 0;
  }
}

async function saveParLevels() {
  const levels = Object.entries(parEdits).map(([key, ed]) => {
    const [flavor_id, product_type] = key.split('-');
    return {
      flavor_id: parseInt(flavor_id),
      product_type,
      target: ed.target || 0,
      minimum: ed.minimum || 0,
      batch_size: Math.max(0.25, ed.batch_size || 1),
      subsequent_batch_size: ed.subsequent_batch_size === '' ? null : (ed.subsequent_batch_size || null),
      weekend_target: ed.weekend_target === '' ? null : (ed.weekend_target || null),
    };
  });

  const btn = document.getElementById('btn-save-pars');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await api('/api/flavors/par-levels/bulk', {
      method: 'PUT',
      body: JSON.stringify({ levels }),
    });
    toast(`Saved ${levels.length} stock levels!`);
    await loadParLevels();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Stock Levels';
  }
}

// ===== PRODUCTION =====
// Old submitProduction function - replaced by submitProductionBatch for list-based UI
// Kept as reference in case single-entry mode is needed in the future
async function submitProduction(e) {
  console.warn('Old submitProduction called - this should use submitProductionBatch with list UI');
  e.preventDefault();
  toast('Please use the list-based production form', 'info');
}

async function loadProductionHistory() {
  try {
    const data = await api('/api/production?days=7');
    const wrap = document.getElementById('production-history');
    if (!data.length) {
      wrap.innerHTML = '<p class="muted">No production logged in the last 7 days.</p>';
      return;
    }
    wrap.innerHTML = data.map(p => {
      const employeeDisplay = p.employee_name ? `<span class="prod-item-employee">${esc(p.employee_name)}</span> · ` : '';
      return `
      <div class="prod-item">
        <div class="prod-item-info">
          <strong>${esc(p.flavor_name)}</strong>
          <span class="prod-item-meta">${employeeDisplay}${p.product_type} · ${formatTime(p.logged_at)}</span>
        </div>
        <div class="prod-item-qty">${p.quantity}</div>
        <button class="prod-item-delete" onclick="deleteProduction(${p.id})" title="Delete">&#10005;</button>
      </div>
    `;
    }).join('');
  } catch (e) {
    console.error('Failed to load production:', e);
  }
}

async function deleteProduction(id) {
  // Get employee name
  const prodEmployeeInput = document.getElementById('prod-employee-name');
  const employeeName = prodEmployeeInput?.value?.trim();

  if (!employeeName) {
    toast('Please enter your name before deleting entries', 'error');
    prodEmployeeInput?.focus();
    return;
  }

  if (!confirm(`Delete this production entry?\n\nDeleted by: ${employeeName}\nThis will be recorded.`)) return;

  try {
    await api(`/api/production/${id}?employee_name=${encodeURIComponent(employeeName)}`, { method: 'DELETE' });
    toast(`Entry deleted by ${employeeName}`, 'success');
    loadProductionHistory();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ===== PRODUCTION LIST-BASED UI =====
async function loadProductionDefaults() {
  try {
    // Get all active flavors
    const activeFlavors = flavors.filter(f => f.active);

    // Get par levels to determine which combinations to show
    const parData = await api('/api/flavors/par-levels');

    const productionItems = [];

    activeFlavors.forEach(flavor => {
      ['tub', 'pint', 'quart'].forEach(type => {
        // Only include if par level exists and target > 0
        const par = parData.find(p => p.flavor_id === flavor.id && p.product_type === type);
        if (par && par.target > 0) {
          productionItems.push({
            flavor_id: flavor.id,
            flavor_name: flavor.name,
            category: flavor.category,
            product_type: type,
            quantity: 0  // Default to 0 for production
          });
        }
      });
    });

    productionDefaults = productionItems;
    productionEdits = {};  // Reset edits
    renderProductionForm();
  } catch (e) {
    console.error('Failed to load production defaults:', e);
  }
}

function renderProductionForm() {
  const wrap = document.getElementById('production-form-wrap');
  const catFilter = document.getElementById('prod-category-filter').value;
  const typeFilter = document.getElementById('prod-type-filter').value;

  let filtered = productionDefaults;
  if (catFilter !== 'all') filtered = filtered.filter(d => d.category === catFilter);
  if (typeFilter !== 'all') filtered = filtered.filter(d => d.product_type === typeFilter);

  // Group by flavor
  const byFlavor = {};
  filtered.forEach(d => {
    if (!byFlavor[d.flavor_id]) {
      byFlavor[d.flavor_id] = { name: d.flavor_name, category: d.category, types: [] };
    }
    byFlavor[d.flavor_id].types.push(d);
  });

  // Sort product types: tub, pint, quart
  const typeOrder = { tub: 0, pint: 1, quart: 2 };
  Object.values(byFlavor).forEach(f => {
    f.types.sort((a, b) => (typeOrder[a.product_type] ?? 9) - (typeOrder[b.product_type] ?? 9));
  });

  // Group by category
  const byCat = {};
  Object.values(byFlavor).forEach(f => {
    if (!byCat[f.category]) byCat[f.category] = [];
    byCat[f.category].push(f);
  });

  // Check if inputs should be locked
  const isLocked = !isProductionEmployeeNameEntered();
  const lockedClass = isLocked ? ' prod-inputs-locked' : '';

  let html = '';

  if (isLocked) {
    html += `<div class="prod-form-locked-message">Enter your name/initials above to start logging</div>`;
  }

  for (const [cat, items] of Object.entries(byCat)) {
    html += `<div class="prod-group${lockedClass}">`;
    html += `<div class="prod-group-header">${esc(cat)}</div>`;
    items.forEach(flavor => {
      flavor.types.forEach(d => {
        const key = `${d.flavor_id}-${d.product_type}`;
        const val = productionEdits[key] || 0;
        const isTub = d.product_type === 'tub';
        const frac = isTub ? Math.round((val - Math.floor(val)) * 100) / 100 : 0;

        html += `
          <div class="prod-row${isTub ? ' prod-row-tub' : ''}">
            <div class="prod-flavor">
              <div class="prod-flavor-name">${esc(d.flavor_name)}</div>
              <div class="prod-flavor-type">${d.product_type}</div>
            </div>
            <div class="prod-input-wrap">
              <div class="prod-controls">
                <button class="qty-btn" type="button" onclick="adjustProductionListQty('${key}', -1)">&#8722;</button>
                <input type="number" inputmode="decimal" id="prod-${key}" value="${val}" min="0" step="${isTub ? '0.25' : '1'}"
                       onchange="productionEdits['${key}']=${isTub ? 'parseFloat' : 'parseInt'}(this.value)||0; updateProductionPartialToggleUI('${key}'); updateProductionSubmitButtonState()">
                <button class="qty-btn" type="button" onclick="adjustProductionListQty('${key}', 1)">+</button>
              </div>
              ${isTub ? `
              <div class="partial-toggle" id="prod-partial-${key}">
                <button type="button" class="partial-btn${frac === 0 ? ' active' : ''}" onclick="setProductionListPartial('${key}', 0)">0</button>
                <button type="button" class="partial-btn${frac === 0.25 ? ' active' : ''}" onclick="setProductionListPartial('${key}', 0.25)">\u00BC</button>
                <button type="button" class="partial-btn${frac === 0.5 ? ' active' : ''}" onclick="setProductionListPartial('${key}', 0.5)">\u00BD</button>
                <button type="button" class="partial-btn${frac === 0.75 ? ' active' : ''}" onclick="setProductionListPartial('${key}', 0.75)">\u00BE</button>
              </div>` : ''}
            </div>
          </div>`;
      });
    });
    html += `</div>`;
  }

  wrap.innerHTML = html || '<p class="muted">No production items to log.</p>';

  updateProductionSubmitButtonState();
}

function adjustProductionListQty(key, delta) {
  const input = document.getElementById(`prod-${key}`);
  if (!input) return;

  const currentVal = parseFloat(input.value) || 0;
  const newVal = Math.max(0, currentVal + delta);

  input.value = newVal;
  productionEdits[key] = newVal;

  updateProductionPartialToggleUI(key);
  updateProductionSubmitButtonState();
}

function setProductionListPartial(key, fraction) {
  const input = document.getElementById(`prod-${key}`);
  if (!input) return;

  const whole = Math.floor(parseFloat(input.value) || 0);
  const newVal = whole + fraction;

  input.value = newVal;
  productionEdits[key] = newVal;

  updateProductionPartialToggleUI(key);
  updateProductionSubmitButtonState();
}

function updateProductionPartialToggleUI(key) {
  const input = document.getElementById(`prod-${key}`);
  const toggle = document.getElementById(`prod-partial-${key}`);
  if (!input || !toggle) return;

  const val = parseFloat(input.value) || 0;
  const frac = Math.round((val - Math.floor(val)) * 100) / 100;

  // Update active state of fraction buttons
  toggle.querySelectorAll('.partial-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  const activeBtnFrac = frac.toFixed(2);
  const activeBtn = [...toggle.querySelectorAll('.partial-btn')].find(btn => {
    const btnFrac = parseFloat(btn.getAttribute('onclick').match(/\d+\.?\d*/)[0]);
    return btnFrac.toFixed(2) === activeBtnFrac;
  });

  if (activeBtn) {
    activeBtn.classList.add('active');
  }
}

function updateProductionSubmitButtonState() {
  const btn = document.getElementById('prod-submit-btn');
  const summary = document.getElementById('prod-summary');

  if (!btn) return;

  // Count non-zero quantities
  const nonZeroEntries = Object.values(productionEdits).filter(v => v > 0).length;

  if (!isProductionEmployeeNameEntered()) {
    btn.disabled = true;
    btn.textContent = '🔒 Enter Name to Commit';
    if (summary) summary.textContent = '';
  } else if (nonZeroEntries === 0) {
    btn.disabled = true;
    btn.textContent = 'Commit All';
    if (summary) summary.textContent = '0 items';
  } else {
    btn.disabled = false;
    btn.textContent = 'Commit All';
    if (summary) summary.textContent = `${nonZeroEntries} ${nonZeroEntries === 1 ? 'item' : 'items'}`;
  }
}

async function submitProductionBatch(e) {
  e.preventDefault();

  const employeeName = document.getElementById('prod-employee-name').value.trim();
  if (!employeeName) {
    toast('Please enter your name or initials', 'error');
    document.getElementById('prod-employee-name').focus();
    return;
  }

  // Collect all non-zero quantities
  const entriesToSubmit = [];
  for (const [key, quantity] of Object.entries(productionEdits)) {
    if (quantity > 0) {
      const [flavorId, productType] = key.split('-');
      const flavor = flavors.find(f => f.id === parseInt(flavorId));
      entriesToSubmit.push({
        flavor_id: parseInt(flavorId),
        flavor_name: flavor ? flavor.name : 'Unknown',
        product_type: productType,
        quantity: quantity,
        employee_name: employeeName
      });
    }
  }

  if (entriesToSubmit.length === 0) {
    toast('No production quantities entered', 'warning');
    return;
  }

  // Show confirmation
  const confirmed = await showProductionBatchConfirmModal(entriesToSubmit);
  if (!confirmed) return;

  // Build logged_at if a past date is selected
  const prodDateVal = document.getElementById('prod-date')?.value;
  const _now = new Date();
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
  const loggedAt = (prodDateVal && prodDateVal !== todayStr)
    ? `${prodDateVal}T08:00:00Z`
    : null;

  // Submit all entries
  let successCount = 0;
  let failCount = 0;

  for (const entry of entriesToSubmit) {
    try {
      const body = {
        flavor_id: entry.flavor_id,
        product_type: entry.product_type,
        quantity: entry.quantity,
        employee_name: entry.employee_name
      };
      if (loggedAt) body.logged_at = loggedAt;
      await api('/api/production', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      successCount++;
    } catch (e) {
      console.error('Failed to log production:', e);
      failCount++;
    }
  }

  toast(`Logged ${successCount} production entries${failCount > 0 ? ` (${failCount} failed)` : ''}`,
        failCount > 0 ? 'warning' : 'success');

  // Save employee name
  localStorage.setItem('employee-name', employeeName);

  // Reset form
  productionEdits = {};
  renderProductionForm();
  loadProductionHistory();
}

function showProductionBatchConfirmModal(entries) {
  return new Promise((resolve) => {
    const modal = document.getElementById('prod-batch-confirm-modal');
    const tbody = modal.querySelector('#prod-batch-entries-tbody');

    tbody.innerHTML = entries.map(entry => `
      <tr>
        <td>${esc(entry.flavor_name)}</td>
        <td>${entry.product_type}</td>
        <td>${entry.quantity}</td>
      </tr>
    `).join('');

    const confirmBtn = modal.querySelector('.btn-confirm-prod-batch');
    const cancelBtn = modal.querySelector('.btn-cancel-prod-batch');

    const cleanup = () => {
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.classList.add('hidden');
    };

    confirmBtn.onclick = () => {
      cleanup();
      resolve(true);
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };

    modal.classList.remove('hidden');
  });
}

// ===== DAILY COUNT =====
async function loadSmartDefaults() {
  try {
    smartDefaults = await api('/api/counts/smart-defaults');
    countEdits = {};
    countPredictions = {};
    smartDefaults.forEach(d => {
      const key = `${d.flavor_id}-${d.product_type}`;
      // Only store predictions — countEdits stays empty until user actively enters a count
      countPredictions[key] = d.estimated_count;
    });
    renderCountForm();

    // Restore employee name from last time
    const savedName = localStorage.getItem('employee-name');
    const employeeInput = document.getElementById('employee-name');
    if (savedName && employeeInput) {
      employeeInput.value = savedName;
    }
  } catch (e) {
    console.error('Failed to load smart defaults:', e);
  }
}

function renderCountForm() {
  const wrap = document.getElementById('count-form-wrap');
  const catFilter = document.getElementById('count-category-filter').value;
  const typeFilter = document.getElementById('count-type-filter').value;

  // Deduplicate: keep only first occurrence of each flavor_id + product_type
  const seen = new Set();
  let filtered = smartDefaults.filter(d => {
    const key = `${d.flavor_id}-${d.product_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (catFilter !== 'all') filtered = filtered.filter(d => d.category === catFilter);
  if (typeFilter === 'pints-quarts') {
    filtered = filtered.filter(d => d.product_type === 'pint' || d.product_type === 'quart');
  } else if (typeFilter !== 'all') {
    filtered = filtered.filter(d => d.product_type === typeFilter);
  }

  // Group by flavor
  const byFlavor = {};
  filtered.forEach(d => {
    if (!byFlavor[d.flavor_id]) {
      byFlavor[d.flavor_id] = { name: d.flavor_name, category: d.category, types: [] };
    }
    byFlavor[d.flavor_id].types.push(d);
  });

  // Sort product types: tub, pint, quart
  const typeOrder = { tub: 0, pint: 1, quart: 2 };
  Object.values(byFlavor).forEach(f => {
    f.types.sort((a, b) => (typeOrder[a.product_type] ?? 9) - (typeOrder[b.product_type] ?? 9));
  });

  // Group by category
  const byCat = {};
  Object.values(byFlavor).forEach(f => {
    if (!byCat[f.category]) byCat[f.category] = [];
    byCat[f.category].push(f);
  });

  // Check if inputs should be locked
  const isLocked = !isEmployeeNameEntered();
  const lockedClass = isLocked ? ' count-inputs-locked' : '';

  let html = '';

  for (const [cat, items] of Object.entries(byCat)) {
    html += `<div class="count-group${lockedClass}">`;
    html += `<div class="count-group-header">${esc(cat)}</div>`;
    items.forEach(flavor => {
      flavor.types.forEach(d => {
        const key = `${d.flavor_id}-${d.product_type}`;
        const val = countEdits[key] !== undefined ? countEdits[key] : d.estimated_count;
        const predicted = countPredictions[key] || d.estimated_count;
        const isTub = d.product_type === 'tub';
        const frac = isTub ? Math.round((val - Math.floor(val)) * 100) / 100 : 0;

        // Calculate initial variance
        const { variance, variancePct, colorClass, icon, message } = calculateVariance(predicted, val);
        const varianceHtml = predicted > 0 ? `
          <span class="variance-indicator ${colorClass}">
            ${icon} ${parseFloat(variance) >= 0 ? '+' : ''}${variance} (${variancePct}%)
            ${message ? `<span class="variance-message">${message}</span>` : ''}
          </span>
        ` : '';

        html += `
          <div class="count-row${isTub ? ' count-row-tub' : ''}">
            <div class="count-flavor">
              <div class="count-flavor-name">${esc(d.flavor_name)}</div>
              <div class="count-flavor-type">${d.product_type}</div>
              <div class="count-expected">Expected: ${isTub ? formatTubCount(predicted) : predicted}</div>
            </div>
            <div class="count-input-wrap">
              <div class="count-controls">
                <button class="qty-btn" onclick="adjustCountQty('${key}', -1)">&#8722;</button>
                <input type="number" inputmode="decimal" id="count-${key}" value="${val}" min="0" step="${isTub ? '0.25' : '1'}"
                       onchange="countEdits['${key}']=${isTub ? 'parseFloat' : 'parseInt'}(this.value)||0; updatePartialToggle('${key}'); updateVarianceIndicator('${key}')">
                <button class="qty-btn" onclick="adjustCountQty('${key}', 1)">+</button>
              </div>
              ${isTub ? `
              <div class="partial-toggle" id="partial-${key}">
                <button class="partial-btn${frac === 0 ? ' active' : ''}" data-frac="0" onclick="setPartial('${key}', 0)">0</button>
                <button class="partial-btn${frac === 0.25 ? ' active' : ''}" data-frac="0.25" onclick="setPartial('${key}', 0.25)">\u00BC</button>
                <button class="partial-btn${frac === 0.5 ? ' active' : ''}" data-frac="0.5" onclick="setPartial('${key}', 0.5)">\u00BD</button>
                <button class="partial-btn${frac === 0.75 ? ' active' : ''}" data-frac="0.75" onclick="setPartial('${key}', 0.75)">\u00BE</button>
              </div>` : ''}
              <div class="count-variance" id="variance-${key}">${varianceHtml}</div>
            </div>
            <div class="count-meta">avg ${d.avg_daily_consumption}/d</div>
          </div>`;
      });
    });
    html += `</div>`;
  }

  wrap.innerHTML = html || '<p class="muted">No flavors to count.</p>';

  // Update submit button state
  updateSubmitButtonState();

  // Update running total and highlights
  updateRunningTotal();
  updateUncountedhighlights();
}

// ===== EMPLOYEE NAME VALIDATION =====
function isEmployeeNameEntered() {
  const employeeNameInput = document.getElementById('employee-name');
  const employeeName = employeeNameInput?.value?.trim();
  return employeeName && employeeName.length >= 2;
}

function updateSubmitButtonState() {
  const btn = document.getElementById('btn-submit-counts');
  const voiceBtn = document.getElementById('voice-input-btn');
  const employeeInput = document.getElementById('employee-name');

  const cardSlot = document.getElementById('name-locked-card-slot');

  if (!isEmployeeNameEntered()) {
    btn.disabled = true;
    btn.textContent = '🔒 Enter Name to Submit';
    if (voiceBtn) voiceBtn.disabled = true;
    if (employeeInput) employeeInput.parentElement.classList.add('required');
    if (cardSlot) cardSlot.innerHTML = `<div class="count-locked-card">
      <div class="count-locked-arrow">&uarr;</div>
      <div class="count-locked-icon">&#128274;</div>
      <div class="count-locked-text">Enter your name above to start counting</div>
    </div>`;
  } else {
    btn.disabled = false;
    btn.textContent = 'Submit All Counts';
    if (voiceBtn) voiceBtn.disabled = false;
    if (employeeInput) employeeInput.parentElement.classList.remove('required');
    if (cardSlot) cardSlot.innerHTML = '';
  }
}

function setupEmployeeNameListener() {
  const employeeInput = document.getElementById('employee-name');
  if (employeeInput) {
    employeeInput.addEventListener('input', () => {
      renderCountForm(); // Re-render to unlock/lock inputs
    });

    // Load saved name from localStorage
    const savedName = localStorage.getItem('employee-name');
    if (savedName) {
      employeeInput.value = savedName;
      updateSubmitButtonState();
    }
  }

  // Setup production employee name listener
  const prodEmployeeInput = document.getElementById('prod-employee-name');
  if (prodEmployeeInput) {
    prodEmployeeInput.addEventListener('input', () => {
      updateProductionFormLock();
    });

    // Load saved name
    const savedProdName = localStorage.getItem('employee-name');
    if (savedProdName) {
      prodEmployeeInput.value = savedProdName;
      updateProductionFormLock();
    } else {
      // Initially lock production form
      updateProductionFormLock();
    }
  }

  // Load voice readback preferences
  const voiceReadbackCheckbox = document.getElementById('voice-readback-enabled');
  if (voiceReadbackCheckbox) {
    const savedPreference = localStorage.getItem('voice-readback-enabled');
    if (savedPreference === 'true') {
      voiceReadbackCheckbox.checked = true;
    }
  }

  const prodVoiceReadbackCheckbox = document.getElementById('prod-voice-readback-enabled');
  if (prodVoiceReadbackCheckbox) {
    const savedProdPreference = localStorage.getItem('prod-voice-readback-enabled');
    if (savedProdPreference === 'true') {
      prodVoiceReadbackCheckbox.checked = true;
    }
  }

  // Load AI Boost preferences
  const aiBoostCheckbox = document.getElementById('ai-boost-enabled');
  if (aiBoostCheckbox) {
    const savedAIBoost = localStorage.getItem('ai-boost-enabled');
    if (savedAIBoost === 'true') {
      aiBoostCheckbox.checked = true;
    }
  }

  const prodAIBoostCheckbox = document.getElementById('prod-ai-boost-enabled');
  if (prodAIBoostCheckbox) {
    const savedProdAIBoost = localStorage.getItem('prod-ai-boost-enabled');
    if (savedProdAIBoost === 'true') {
      prodAIBoostCheckbox.checked = true;
    }
  }

  // Setup production quantity input listener for partial toggle sync
  const prodQtyInput = document.getElementById('prod-qty');
  if (prodQtyInput) {
    prodQtyInput.addEventListener('input', () => {
      updateProductionPartialToggleButtons();
    });
  }
}

// ===== SUBMIT CONFIRMATION =====
function submitCounts() {
  // Get employee name
  const employeeNameInput = document.getElementById('employee-name');
  const employeeName = employeeNameInput?.value?.trim();

  if (!employeeName) {
    toast('Please enter your name or initials', 'error');
    employeeNameInput?.focus();
    return;
  }

  const entryCount = Object.keys(countEdits).length;

  if (!entryCount) {
    toast('No counts to submit', 'error');
    return;
  }

  // Show confirmation modal
  document.getElementById('submit-entry-count').textContent = entryCount;
  document.getElementById('submit-employee-display').textContent = employeeName;
  document.getElementById('submit-confirm-modal').classList.remove('hidden');
}

async function confirmSubmitCounts() {
  // Get employee name
  const employeeNameInput = document.getElementById('employee-name');
  const employeeName = employeeNameInput?.value?.trim();

  // Get selected date and set time to 9 PM (21:00)
  const countDateInput = document.getElementById('count-date');
  const countDate = countDateInput?.value;
  let countedAt = null;

  if (countDate) {
    // Parse date and set time to 9 PM UTC to avoid timezone shifts
    // Format: 2026-02-14 -> 2026-02-14T21:00:00Z (UTC)
    countedAt = countDate + 'T21:00:00Z';
  }

  const entries = Object.entries(countEdits).map(([key, count]) => {
    const [flavor_id, product_type] = key.split('-');
    const predicted_count = countPredictions[key] || null;
    return {
      flavor_id: parseInt(flavor_id),
      product_type,
      count,
      predicted_count,
      employee_name: employeeName,
      counted_at: countedAt
    };
  });

  // Close modal
  closeSubmitConfirmModal();

  const btn = document.getElementById('btn-submit-counts');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    await api('/api/counts', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
    toast(`Saved ${entries.length} counts!`);

    // Save employee name to localStorage for next time
    localStorage.setItem('employee-name', employeeName);

    loadCountHistory();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit All Counts';
  }
}

function closeSubmitConfirmModal() {
  document.getElementById('submit-confirm-modal').classList.add('hidden');
}

async function loadCountHistory() {
  try {
    const data = await api('/api/counts/history?days=3');
    const wrap = document.getElementById('count-history');
    if (!data.length) {
      wrap.innerHTML = '<p class="muted">No counts recorded yet.</p>';
      return;
    }
    // Group by date
    const byDate = {};
    data.forEach(c => {
      const date = c.counted_at?.split('T')[0] || 'Unknown';
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(c);
    });

    let html = '';
    for (const [date, items] of Object.entries(byDate)) {
      html += `<div class="count-group-header">${formatDate(date)}</div>`;
      items.slice(0, 15).forEach(c => {
        const displayCount = c.product_type === 'tub' ? formatTubCount(c.count) : c.count;
        html += `
          <div class="prod-item">
            <div class="prod-item-info">
              <strong>${esc(c.flavor_name)}</strong>
              <span class="prod-item-meta">${c.product_type}</span>
            </div>
            <div class="prod-item-qty">${displayCount}</div>
          </div>`;
      });
      if (items.length > 15) {
        html += `<p class="muted">+ ${items.length - 15} more entries</p>`;
      }
    }
    wrap.innerHTML = html;
  } catch (e) {
    console.error('Failed to load count history:', e);
  }
}

// ===== HOME =====
async function loadHome() {
  // Show shimmer placeholders while loading
  const kpiWrap = document.getElementById('kpi-grid');
  kpiWrap.innerHTML = `<div class="kpi-shimmer-grid" style="grid-column:1/-1">${
    [1,2,3,4].map(() => `<div class="kpi-shimmer-card"><div class="shimmer shimmer-circle"></div><div class="shimmer shimmer-text"></div></div>`).join('')
  }</div>`;
  const insightsWrap = document.getElementById('home-insights');
  insightsWrap.innerHTML = [1,2,3].map(() => `<li class="shimmer shimmer-line"></li>`).join('');
  const prioritiesWrap = document.getElementById('top-priorities');
  prioritiesWrap.innerHTML = [1,2].map(() => `<div class="shimmer shimmer-block" style="margin-bottom:8px"></div>`).join('');

  try {
    const makeList = await api('/api/dashboard/make-list');
    renderKPIs(makeList);
    renderStatusBar(makeList);
    renderTopPriorities(makeList);
    renderHomeInsights(makeList);
  } catch (e) {
    console.error('Home load failed:', e);
  }
}

function renderKPIs(data) {
  const wrap = document.getElementById('kpi-grid');
  if (!data.length) {
    wrap.innerHTML = '<p class="muted">No data available yet.</p>';
    return;
  }

  // Helper to sum fractional batch needs, then round to nearest 0.5
  const getTotalBatches = (item) => {
    let totalNeed = 0;
    ['tub', 'pint', 'quart'].forEach(ptype => {
      const p = item.products[ptype];
      if (p && p.batches_needed > 0) {
        totalNeed += p.batches_needed;
      }
    });
    return Math.round(totalNeed * 2) / 2;
  };

  const critical = data.filter(i => i.status === 'critical').length;
  const belowPar = data.filter(i => i.status === 'below_par' && getTotalBatches(i) > 0).length;
  const batches = data.reduce((sum, i) => sum + getTotalBatches(i), 0);
  const stocked = data.filter(i => getTotalBatches(i) === 0).length;

  wrap.innerHTML = `
    <div class="kpi-card critical clickable" onclick="switchToTab('dashboard')" title="View critical items on Dashboard">
      <div class="kpi-number">${critical}</div>
      <div class="kpi-label">🚨 Critical Items</div>
    </div>
    <div class="kpi-card warning clickable" onclick="switchToTab('dashboard')" title="View below par items on Dashboard">
      <div class="kpi-number">${belowPar}</div>
      <div class="kpi-label">🐄 Below Par</div>
    </div>
    <div class="kpi-card neutral clickable" onclick="switchToTab('dashboard')" title="View full make list on Dashboard">
      <div class="kpi-number">${batches}</div>
      <div class="kpi-label">🪣 Batches Needed</div>
    </div>
    <div class="kpi-card success clickable" onclick="switchToTab('flavors')" title="View stock levels on Flavors tab">
      <div class="kpi-number">${stocked}</div>
      <div class="kpi-label">🌾 Fully Stocked</div>
    </div>
  `;
}

function renderStatusBar(data) {
  const wrap = document.getElementById('status-bar');
  if (!data.length) {
    wrap.innerHTML = '<p class="muted">No data available.</p>';
    return;
  }

  // Helper to sum fractional batch needs, then round to nearest 0.5
  const getTotalBatches = (item) => {
    let totalNeed = 0;
    ['tub', 'pint', 'quart'].forEach(ptype => {
      const p = item.products[ptype];
      if (p && p.batches_needed > 0) {
        totalNeed += p.batches_needed;
      }
    });
    return Math.round(totalNeed * 2) / 2;
  };

  const critical = data.filter(i => i.status === 'critical').length;
  const belowPar = data.filter(i => i.status === 'below_par' && getTotalBatches(i) > 0).length;
  const stocked = data.filter(i => getTotalBatches(i) === 0).length;
  const total = data.length;

  const critPct = (critical / total) * 100;
  const belowPct = (belowPar / total) * 100;
  const stockedPct = (stocked / total) * 100;
  const neutralPct = 100 - critPct - belowPct - stockedPct;

  let html = '';
  if (critPct > 0) {
    html += `<div class="status-segment critical" style="width: ${critPct}%" onclick="switchToTab('dashboard')" title="View critical items">${critical} Critical</div>`;
  }
  if (belowPct > 0) {
    html += `<div class="status-segment warning" style="width: ${belowPct}%" onclick="switchToTab('dashboard')" title="View below par items">${belowPar} Below</div>`;
  }
  if (stockedPct > 0) {
    html += `<div class="status-segment success" style="width: ${stockedPct}%" onclick="switchToTab('flavors')" title="View stock levels">${stocked} Stocked</div>`;
  }
  if (neutralPct > 0) {
    const neutralCount = total - critical - belowPar - stocked;
    if (neutralCount > 0) {
      html += `<div class="status-segment neutral" style="width: ${neutralPct}%" onclick="switchToTab('dashboard')" title="View make list">${neutralCount} Other</div>`;
    }
  }

  wrap.innerHTML = html || '<p class="muted">No items to display.</p>';
}

function renderTopPriorities(data) {
  const wrap = document.getElementById('top-priorities');
  const critical = data.filter(i => i.status === 'critical').slice(0, 5);

  if (!critical.length) {
    wrap.innerHTML = '<p class="muted">No critical items. Everything looks good!</p>';
    return;
  }

  // Helper to sum fractional batch needs, then round to nearest 0.5
  const getTotalBatches = (item) => {
    let totalNeed = 0;
    ['tub', 'pint', 'quart'].forEach(ptype => {
      const p = item.products[ptype];
      if (p && p.batches_needed > 0) {
        totalNeed += p.batches_needed;
      }
    });
    return Math.round(totalNeed * 2) / 2;
  };

  let html = '<ul class="priority-list">';
  critical.forEach(item => {
    const totalBatches = getTotalBatches(item);
    const formattedBatches = formatBatchCount(totalBatches);
    const batchText = totalBatches === 1 ? '1 batch' : `${formattedBatches} batches`;
    html += `
      <li class="priority-item">
        <span class="priority-dot critical"></span>
        <span class="priority-text">${esc(item.flavor_name)}</span>
        <span class="priority-badge">${batchText}</span>
      </li>
    `;
  });
  html += '</ul>';
  html += '<a href="#" class="home-link" onclick="switchToTab(\'dashboard\'); return false;">View Full Make List →</a>';

  wrap.innerHTML = html;
}

function getFarmGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    const m = ['Moo-rning update!', 'Fresh from the barn!', 'Rise and churn!'];
    return m[Math.floor(Math.random() * m.length)];
  } else if (hour < 17) {
    const a = ['Afternoon herd report!', 'Midday from the pasture!', 'Fresh off the farm!'];
    return a[Math.floor(Math.random() * a.length)];
  } else {
    const e = ['Evening barn check!', 'Sunset on the farm!', 'Closing time at the creamery!'];
    return e[Math.floor(Math.random() * e.length)];
  }
}

function renderHomeInsights(data) {
  const wrap = document.getElementById('home-insights');
  const insights = [];

  // Helper to sum fractional batch needs, then round to nearest 0.5
  const getTotalBatches = (item) => {
    let totalNeed = 0;
    ['tub', 'pint', 'quart'].forEach(ptype => {
      const p = item.products[ptype];
      if (p && p.batches_needed > 0) {
        totalNeed += p.batches_needed;
      }
    });
    return Math.round(totalNeed * 2) / 2;
  };

  const critical = data.filter(i => i.status === 'critical').length;
  const batches = data.reduce((sum, i) => sum + getTotalBatches(i), 0);
  const stocked = data.filter(i => getTotalBatches(i) === 0).length;
  const isWeekend = data[0]?.is_weekend;

  const emojis = ['🐄', '🥛', '🧈', '🌾'];
  let emojiIdx = 0;

  if (critical > 0) {
    insights.push(`${critical} flavor${critical > 1 ? 's' : ''} critically low - prioritize these first`);
  }
  if (batches > 0) {
    insights.push(`Total production needed: ${batches} batch${batches > 1 ? 'es' : ''}`);
  }
  if (stocked > 0) {
    insights.push(`${stocked} flavor${stocked > 1 ? 's are' : ' is'} fully stocked and ready`);
  }
  if (isWeekend) {
    insights.push('Weekend demand adjustment applied to make list');
  }
  if (insights.length === 0) {
    insights.push('All stock levels look good. Check back tonight after count.');
  }

  const greeting = `<li class="farm-greeting">${esc(getFarmGreeting())}</li>`;
  const items = insights.map(i => {
    const emoji = emojis[emojiIdx++ % emojis.length];
    return `<li class="home-insight-item" data-emoji="${emoji}">${esc(i)}</li>`;
  }).join('');
  wrap.innerHTML = greeting + items;
}

function switchToTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  const tabButton = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const tabContent = document.getElementById(tabName);

  if (tabButton) tabButton.classList.add('active');
  if (tabContent) tabContent.classList.add('active');

  // Load tab content
  if (tabName === 'dashboard') loadDashboard();
  if (tabName === 'flavors') loadParLevels();
}

// ===== DASHBOARD =====
async function loadDashboard() {
  try {
    const [inv, alerts, popularity, pvc, makeList, atRisk] = await Promise.all([
      api('/api/dashboard/inventory'),
      api('/api/dashboard/alerts'),
      api('/api/dashboard/popularity?days=7'),
      api('/api/dashboard/production-vs-consumption?days=7'),
      api('/api/dashboard/make-list'),
      api('/api/flavors/at-risk'),
    ]);
    inventory = inv;
    renderMakeList(makeList);
    renderAlerts(alerts);
    renderAtRisk(atRisk);
    renderInventoryTable();
    renderPopularityChart(popularity);
    const hasProduction = pvc.some(d => d.produced > 0) && pvc.some(d => d.consumed > 0);
    renderPvcChart(pvc, hasProduction);
  } catch (e) {
    console.error('Dashboard load failed:', e);
  }
}

function renderMakeList(data) {
  const wrap = document.getElementById('make-list-wrap');

  if (!data.length) {
    wrap.innerHTML = '<div class="make-list-empty">No par levels configured yet.</div>';
    return;
  }

  const isWeekend = data[0]?.is_weekend;

  // Sum fractional batch needs, then round to nearest 0.5
  // (One batch can be split between tubs, pints, and quarts; half batches allowed)
  const calculateTotalBatches = (item) => {
    let totalNeed = 0;
    ['tub', 'pint', 'quart'].forEach(ptype => {
      const p = item.products[ptype];
      if (p && p.batches_needed > 0) {
        totalNeed += p.batches_needed;
      }
    });
    return Math.round(totalNeed * 2) / 2;
  };

  const needsMaking = data.filter(d => calculateTotalBatches(d) > 0);
  const stocked = data.filter(d => calculateTotalBatches(d) === 0);
  const critCount = data.filter(d => d.status === 'critical').length;
  const totalBatches = needsMaking.reduce((sum, d) => sum + calculateTotalBatches(d), 0);

  function productCell(products, ptype) {
    const p = products[ptype];
    if (!p) return '<span class="ml-na">&#8212;</span>';
    const isTub = ptype === 'tub';
    const have = isTub ? formatTubCount(p.on_hand) : p.on_hand;
    const need = Math.ceil(p.deficit);

    if (need <= 0) return `<span class="ml-stocked-cell">${have}</span>`;

    return `<span class="ml-need-cell">${have}<span class="ml-need-arrow">+${need}</span></span>`;
  }

  let html = `
    <div class="table-wrap">
    <table class="make-list-table">
      <thead>
        <tr>
          <th>Flavor${isWeekend ? '<span class="make-list-weekend-badge">Weekend</span>' : ''}</th>
          <th style="text-align:right">Batches</th>
          <th>Tubs</th>
          <th>Pints</th>
          <th>Quarts</th>
        </tr>
      </thead>
      <tbody>`;

  needsMaking.forEach(item => {
    const totalBatches = calculateTotalBatches(item);
    const isSpecialty = isSpecialtyCategory(item.category);
    const discontinueBtn = isSpecialty
      ? `<button class="btn-flag-done" onclick="discontinueFlavor(${item.flavor_id})" title="Mark as done">&#127937;</button>`
      : '';
    html += `
      <tr class="ml-${item.status}">
        <td>
          <span class="ml-status-dot ${item.status}"></span>
          <span class="ml-flavor">${esc(item.flavor_name)}</span>
          ${discontinueBtn}
        </td>
        <td class="ml-qty">${formatBatchCount(totalBatches)}</td>
        <td>${productCell(item.products, 'tub')}</td>
        <td>${productCell(item.products, 'pint')}</td>
        <td>${productCell(item.products, 'quart')}</td>
      </tr>`;
  });

  // Show stocked items
  if (stocked.length) {
    stocked.forEach(item => {
      const isSpecialty = isSpecialtyCategory(item.category);
      const discontinueBtn = isSpecialty
        ? `<button class="btn-flag-done" onclick="discontinueFlavor(${item.flavor_id})" title="Mark as done">&#127937;</button>`
        : '';
      html += `
        <tr class="ml-stocked">
          <td>
            <span class="ml-status-dot stocked"></span>
            <span class="ml-flavor">${esc(item.flavor_name)}</span>
            ${discontinueBtn}
          </td>
          <td class="ml-qty">0</td>
          <td>${productCell(item.products, 'tub')}</td>
          <td>${productCell(item.products, 'pint')}</td>
          <td>${productCell(item.products, 'quart')}</td>
        </tr>`;
    });
  }

  html += '</tbody></table></div>';

  const summary = critCount > 0
    ? `<div class="make-list-summary">${critCount} critical · ${needsMaking.length} flavors · ${totalBatches} batches to make</div>`
    : `<div class="make-list-summary">${needsMaking.length} flavors · ${totalBatches} batches to make</div>`;

  wrap.innerHTML = summary + html;
}

function renderAlerts(alerts) {
  const wrap = document.getElementById('alerts-list');
  if (!alerts.length) {
    wrap.innerHTML = '<p class="muted">All stocked up — no alerts right now.</p>';
    return;
  }
  wrap.innerHTML = alerts.map(a => {
    const icon = a.urgency === 'critical' ? '&#128308;' : a.urgency === 'warning' ? '&#128993;' : a.urgency === 'overstocked' ? '&#128994;' : '&#128309;';
    const message = a.message || `${a.on_hand} left · avg ${a.avg_daily}/day · ~${a.days_left} days`;
    return `
      <div class="alert-item alert-${a.urgency}">
        <span class="alert-icon">${icon}</span>
        <div class="alert-text">
          <strong>${esc(a.flavor_name)} (${a.product_type})</strong>
          ${esc(message)}
        </div>
      </div>`;
  }).join('');
}

function renderAtRisk(atRisk) {
  const section = document.getElementById('at-risk-section');
  const wrap = document.getElementById('at-risk-flavors');

  if (!atRisk || !atRisk.length) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  wrap.innerHTML = atRisk.map(f => {
    const daysLeft = f.days_until_auto_discontinue;
    const urgencyClass = daysLeft <= 3 ? 'critical' : daysLeft <= 5 ? 'warning' : 'low';
    return `
      <div class="at-risk-item at-risk-${urgencyClass}">
        <div class="at-risk-info">
          <strong>${esc(f.name)}</strong>
          <span class="at-risk-days">Last counted ${f.days_since_count} days ago · Auto-discontinue in ${daysLeft} days</span>
        </div>
        <button class="btn-flag-done" onclick="discontinueFlavor(${f.id})" title="Mark as done now">&#127937; Done</button>
      </div>`;
  }).join('');
}

function renderInventoryTable() {
  const wrap = document.getElementById('inventory-table-wrap');
  const catFilter = document.getElementById('inv-category-filter').value;

  let data = inventory;
  if (catFilter !== 'all') data = data.filter(i => i.category === catFilter);

  if (!data.length) {
    wrap.innerHTML = '<p class="muted">No inventory data yet. Do a nightly count to get started.</p>';
    return;
  }

  let html = `
    <table class="inv-table">
      <thead>
        <tr>
          <th>Flavor</th>
          <th>Tubs</th>
          <th>Pints</th>
          <th>Quarts</th>
        </tr>
      </thead>
      <tbody>`;

  data.forEach(item => {
    const t = item.products.tub.on_hand;
    const p = item.products.pint.on_hand;
    const q = item.products.quart.on_hand;
    html += `
      <tr>
        <td>
          <span class="flavor-name">${esc(item.name)}</span>
          <span class="category-tag">${esc(item.category)}</span>
        </td>
        <td class="${countClass(t)}">${formatTubCount(t)}</td>
        <td class="${countClass(p)}">${p}</td>
        <td class="${countClass(q)}">${q}</td>
      </tr>`;
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function countClass(n) {
  if (n === 0) return 'count-zero';
  if (n <= 2) return 'count-low';
  return 'count-ok';
}

// ===== CHARTS =====
let popChart = null;
let pvcChart = null;
let varianceChart = null;

function renderPopularityChart(data) {
  const ctx = document.getElementById('popularity-chart');
  if (popChart) popChart.destroy();

  const top10 = data.slice(0, 10);
  if (!top10.length) return;

  const colors = getChartColors();

  popChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(d => d.flavor_name),
      datasets: [{
        label: 'Total Consumed',
        data: top10.map(d => d.total),
        backgroundColor: top10.map((_, i) => colors.barGradient[i] || colors.muted),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.8,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } } },
        y: { grid: { display: false }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } } },
      },
    },
  });
}

function renderPvcChart(data, hasProduction) {
  const ctx = document.getElementById('pvc-chart');
  if (pvcChart) pvcChart.destroy();

  // Clean up any previous production warning
  const oldWarning = ctx.parentElement.querySelector('.production-warning');
  if (oldWarning) oldWarning.remove();

  if (!hasProduction) {
    pvcChart = null;
    ctx.style.display = 'none';
    ctx.insertAdjacentHTML('beforebegin',
      '<div class="alert-warning production-warning" style="padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem;">' +
      '\u26a0\ufe0f This chart activates once production entries are being logged alongside nightly counts.</div>');
    return;
  }
  ctx.style.display = '';

  // Aggregate by flavor
  const byFlavor = {};
  data.forEach(d => {
    if (!byFlavor[d.flavor_name]) byFlavor[d.flavor_name] = { produced: 0, consumed: 0 };
    byFlavor[d.flavor_name].produced += d.produced;
    byFlavor[d.flavor_name].consumed += d.consumed;
  });

  // Sort by consumed desc, take top 8
  const sorted = Object.entries(byFlavor)
    .sort((a, b) => b[1].consumed - a[1].consumed)
    .slice(0, 8);

  const labels = sorted.map(([name]) => name.length > 14 ? name.slice(0, 12) + '..' : name);
  const fullNames = sorted.map(([name]) => name);
  if (!labels.length) return;

  const colors = getChartColors();

  pvcChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Produced',
          data: fullNames.map(l => byFlavor[l].produced),
          backgroundColor: colors.black,
          borderRadius: 4,
        },
        {
          label: 'Consumed',
          data: fullNames.map(l => byFlavor[l].consumed),
          backgroundColor: colors.red,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.6,
      plugins: {
        legend: {
          labels: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 10 }, maxRotation: 45 } },
        y: { grid: { color: colors.gridColor }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } } },
      },
    },
  });
}

// ===== AI INSIGHTS =====
async function loadInsights() {
  const btn = document.getElementById('btn-insights');
  const wrap = document.getElementById('insights-content');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Analyzing...';
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<p class="muted">Claude is analyzing your inventory data...</p>';

  try {
    const data = await api('/api/insights');
    let html = '';

    if (data.summary) {
      html += `<div class="insight-block"><div class="insight-summary">${esc(data.summary)}</div></div>`;
    }

    if (data.make_list?.length) {
      html += `<div class="insight-block"><h3>Make List for Tomorrow</h3><ul>`;
      data.make_list.forEach(item => {
        html += `<li>${esc(item)}</li>`;
      });
      html += `</ul></div>`;
    }

    if (data.predictions?.length) {
      html += `<div class="insight-block"><h3>Demand Predictions</h3><ul>`;
      data.predictions.forEach(p => {
        html += `<li>${esc(p)}</li>`;
      });
      html += `</ul></div>`;
    }

    if (data.production_notes?.length) {
      html += `<div class="insight-block"><h3>Production Notes</h3><ul>`;
      data.production_notes.forEach(w => {
        html += `<li>${esc(w)}</li>`;
      });
      html += `</ul></div>`;
    }

    wrap.innerHTML = html || '<p class="muted">No insights available yet. Add more data first.</p>';
  } catch (e) {
    wrap.innerHTML = `<p class="muted">Could not load insights: ${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Insights';
  }
}

// ===== REPORTS =====
let trendChart = null;
let wasteChart = null;
let categoryChart = null;
let varianceTrendChart = null;
let reportRangeInitialized = false;

function initReportRangeToggle() {
  if (reportRangeInitialized) return;
  reportRangeInitialized = true;
  const wrap = document.querySelector('.report-range-toggle');
  if (!wrap) return;
  wrap.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reportDays = parseInt(btn.dataset.days);
      loadReports();
    });
  });
}

async function loadReports() {
  // Defensive: ensure flavors are loaded (needed for category mapping)
  if (!flavors.length) {
    try {
      await loadFlavors();
    } catch (e) {
      console.error('Failed to load flavors for reports:', e);
    }
  }

  try {
    const [consumption, popularity, waste, parAcc, variance, empPerf] = await Promise.all([
      api(`/api/dashboard/consumption?days=${reportDays}`),
      api(`/api/dashboard/popularity?days=${reportDays}`),
      api(`/api/reports/waste?days=${reportDays}`),
      api(`/api/reports/par-accuracy?days=${reportDays}`),
      api(`/api/reports/variance?days=${reportDays}`),
      api(`/api/reports/employee-performance?days=${reportDays}`),
    ]);

    // Cache data for exports
    reportCache.consumption = consumption;
    reportCache.popularity = popularity;
    reportCache.waste = waste;
    reportCache.parAccuracy = parAcc;
    reportCache.variance = variance;
    reportCache.employeePerformance = empPerf;

    const hasProduction = waste.some(w => w.produced > 0) && waste.some(w => w.consumed > 0);

    renderVarianceReport(variance);
    renderTrendChart(consumption);
    renderTrendSummary(consumption);
    renderWasteChart(waste, hasProduction);
    renderWasteTable(waste, hasProduction);
    renderCategoryChart(popularity);
    renderCategoryTable(popularity);
    renderParAccuracy(parAcc);
    renderEmployeePerformance(empPerf);
  } catch (e) {
    console.error('Reports load failed:', e);
    toast('Failed to load reports', 'error');
  }
}

function renderTrendChart(data) {
  const ctx = document.getElementById('trend-chart');
  if (trendChart) trendChart.destroy();

  if (!data.length) {
    trendChart = null;
    ctx.style.display = 'none';
    return;
  }
  ctx.style.display = '';

  // Aggregate closing stock levels by flavor and date
  const byFlavor = {};
  data.forEach(d => {
    if (!byFlavor[d.flavor_name]) byFlavor[d.flavor_name] = { totalConsumed: 0, dates: {} };
    byFlavor[d.flavor_name].totalConsumed += d.consumed;
    byFlavor[d.flavor_name].dates[d.date] = (byFlavor[d.flavor_name].dates[d.date] || 0) + (d.closing_count || 0);
  });

  // Top 5 most active flavors (by consumption), then plot their stock levels
  const top5 = Object.entries(byFlavor)
    .sort((a, b) => b[1].totalConsumed - a[1].totalConsumed)
    .slice(0, 5);

  // All unique dates, sorted
  const allDates = [...new Set(data.map(d => d.date))].sort();

  const colors = getChartColors();
  const datasets = top5.map(([name, info], i) => ({
    label: name,
    data: allDates.map(d => info.dates[d] || 0),
    borderColor: colors.lineColors[i],
    backgroundColor: colors.lineColors[i] + '20',
    tension: 0.3,
    pointRadius: 3,
    borderWidth: 2,
    fill: false,
  }));

  if (!allDates.length) return;

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allDates.map(d => {
        const dt = new Date(d + 'T12:00:00');
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.8,
      plugins: {
        legend: {
          labels: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 10 }, maxRotation: 45 } },
        y: { grid: { color: colors.gridColor }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } }, beginAtZero: true },
      },
    },
  });
}

function renderTrendSummary(data) {
  const wrap = document.getElementById('trend-summary');

  if (!data.length) {
    wrap.innerHTML = '<p class="muted">No count data for this period.</p>';
    return;
  }

  // Aggregate closing stock by flavor, product type, and date
  const byFlavor = {};
  data.forEach(d => {
    if (!byFlavor[d.flavor_name]) {
      byFlavor[d.flavor_name] = { totalConsumed: 0, byType: {}, dates: {} };
    }
    byFlavor[d.flavor_name].totalConsumed += d.consumed;
    // Track per-type daily counts for averaging
    if (!byFlavor[d.flavor_name].byType[d.product_type]) {
      byFlavor[d.flavor_name].byType[d.product_type] = [];
    }
    byFlavor[d.flavor_name].byType[d.product_type].push(d.closing_count || 0);
    // Track total stock per date for trend calculation
    byFlavor[d.flavor_name].dates[d.date] = (byFlavor[d.flavor_name].dates[d.date] || 0) + (d.closing_count || 0);
  });

  const allDates = [...new Set(data.map(d => d.date))].sort();
  const midpoint = Math.floor(allDates.length / 2);
  const firstHalf = allDates.slice(0, midpoint);
  const secondHalf = allDates.slice(midpoint);

  const rows = Object.entries(byFlavor)
    .sort((a, b) => b[1].totalConsumed - a[1].totalConsumed)
    .map(([name, info]) => {
      // Average closing stock per product type
      const avgType = (type) => {
        const vals = info.byType[type];
        if (!vals || !vals.length) return '—';
        return (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
      };

      // Trend: compare first half avg total stock to second half
      const firstSum = firstHalf.reduce((s, d) => s + (info.dates[d] || 0), 0);
      const secondSum = secondHalf.reduce((s, d) => s + (info.dates[d] || 0), 0);
      const firstAvg = firstHalf.length ? firstSum / firstHalf.length : 0;
      const secondAvg = secondHalf.length ? secondSum / secondHalf.length : 0;

      let trendClass, trendArrow;
      if (secondAvg > firstAvg * 1.1) {
        trendClass = 'report-trend-up';
        trendArrow = '\u2191';
      } else if (secondAvg < firstAvg * 0.9) {
        trendClass = 'report-trend-down';
        trendArrow = '\u2193';
      } else {
        trendClass = 'report-trend-flat';
        trendArrow = '\u2192';
      }

      return `<tr>
        <td>${esc(name)}</td>
        <td>${avgType('tub')}</td>
        <td>${avgType('pint')}</td>
        <td>${avgType('quart')}</td>
        <td class="${trendClass}">${trendArrow}</td>
      </tr>`;
    });

  if (!rows.length) {
    wrap.innerHTML = '<p class="muted">No count data for this period.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Flavor</th><th>Tubs</th><th>Pints</th><th>Quarts</th><th>Trend</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function renderWasteChart(data, hasProduction) {
  const ctx = document.getElementById('waste-chart');
  if (wasteChart) wasteChart.destroy();

  // Clean up any previous production warning
  const oldWarning = ctx.parentElement.querySelector('.production-warning');
  if (oldWarning) oldWarning.remove();

  if (!hasProduction) {
    wasteChart = null;
    ctx.style.display = 'none';
    ctx.insertAdjacentHTML('beforebegin',
      '<div class="alert-warning production-warning" style="padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem;">' +
      '\u26a0\ufe0f This report activates once production entries are being logged alongside nightly counts.</div>');
    return;
  }

  const filtered = data.slice(0, 10);
  if (!filtered.length) {
    wasteChart = null;
    ctx.style.display = 'none';
    return;
  }
  ctx.style.display = '';

  const colors = getChartColors();

  wasteChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: filtered.map(d => d.flavor_name),
      datasets: [{
        label: 'Produced',
        data: filtered.map(d => d.produced),
        backgroundColor: colors.blue,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.8,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } } },
        y: { grid: { display: false }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } } },
      },
    },
  });
}

function renderWasteTable(data, hasProduction) {
  const wrap = document.getElementById('waste-table');

  if (!hasProduction) {
    wrap.innerHTML = '';
    return;
  }

  if (!data.length) {
    wrap.innerHTML = '<p class="muted">No production/consumption data for this period.</p>';
    return;
  }

  const rows = data.map(d => {
    return `<tr>
      <td>${esc(d.flavor_name)}</td>
      <td>${d.produced}</td>
      <td>${d.consumed}</td>
      <td>${d.surplus}</td>
    </tr>`;
  });

  wrap.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Flavor</th><th>Made</th><th>Sold</th><th>+/\u2212</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function renderCategoryChart(data) {
  const ctx = document.getElementById('category-chart');
  if (categoryChart) categoryChart.destroy();

  if (!data.length) {
    categoryChart = null;
    ctx.style.display = 'none';
    return;
  }

  // Get flavor->category mapping from the global flavors array
  const catMap = {};
  flavors.forEach(f => { catMap[f.name] = f.category; });

  // Aggregate by category
  const byCat = {};
  data.forEach(d => {
    const cat = catMap[d.flavor_name] || 'Other';
    byCat[cat] = (byCat[cat] || 0) + d.total;
  });

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    categoryChart = null;
    ctx.style.display = 'none';
    return;
  }
  ctx.style.display = '';

  const colors = getChartColors();

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(([cat]) => cat),
      datasets: [{
        data: entries.map(([, total]) => total),
        backgroundColor: entries.map((_, i) => colors.categoryColors[i % colors.categoryColors.length]),
        borderWidth: 2,
        borderColor: colors.doughnutBorder,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.6,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } },
        },
      },
    },
  });
}

function renderCategoryTable(data) {
  const wrap = document.getElementById('category-table');

  if (!data.length) {
    wrap.innerHTML = '<p class="muted">No category data for this period.</p>';
    return;
  }

  const catMap = {};
  flavors.forEach(f => { catMap[f.name] = f.category; });

  // Aggregate by category
  const byCat = {};
  data.forEach(d => {
    const cat = catMap[d.flavor_name] || 'Other';
    if (!byCat[cat]) byCat[cat] = { total: 0, flavors: {}, bestName: '', bestVal: 0 };
    byCat[cat].total += d.total;
    byCat[cat].flavors[d.flavor_name] = (byCat[cat].flavors[d.flavor_name] || 0) + d.total;
    if (d.total > byCat[cat].bestVal) {
      byCat[cat].bestVal = d.total;
      byCat[cat].bestName = d.flavor_name;
    }
  });

  const rows = Object.entries(byCat)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, info]) => {
      const numFlavors = Object.keys(info.flavors).length;
      const avgPerFlavor = numFlavors > 0 ? (info.total / numFlavors).toFixed(1) : 0;
      return `<tr>
        <td>${esc(cat)}</td>
        <td>${info.total}</td>
        <td>${numFlavors}</td>
        <td>${avgPerFlavor}</td>
        <td>${esc(info.bestName)}</td>
      </tr>`;
    });

  if (!rows.length) {
    wrap.innerHTML = '<p class="muted">No category data for this period.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Category</th><th>Total</th><th># Flavors</th><th>Avg/Flavor</th><th>Best Seller</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function renderParAccuracy(data) {
  const wrap = document.getElementById('par-accuracy-table');

  if (!data.length) {
    wrap.innerHTML = '<p class="muted">No par level data available. Set par levels in the Flavors tab.</p>';
    return;
  }

  const rows = data.map(d => {
    const statusLabel = d.status === 'well_set' ? 'Well Set' : d.status === 'too_high' ? 'Too High' : 'Too Low';
    const actionHtml = d.action ? `<span class="report-action">${esc(d.action)}</span>` : '';
    return `<tr>
      <td>${esc(d.flavor_name)}</td>
      <td>${d.product_type}</td>
      <td>${d.current_target}</td>
      <td>${d.avg_daily_use}</td>
      <td>${d.suggested_target}</td>
      <td><span class="report-status-dot ${d.status}"></span>${statusLabel}</td>
      <td>${actionHtml}</td>
    </tr>`;
  });

  wrap.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Flavor</th><th>Type</th><th>Target</th><th>Avg/Day</th><th>Suggested</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function renderEmployeePerformance(data) {
  const wrap = document.getElementById('employee-performance-wrap');

  if (!data || !data.employees || data.employees.length === 0) {
    wrap.innerHTML = '<p class="muted">No employee performance data yet. Submit counts with employee names to see analytics.</p>';
    return;
  }

  const employees = data.employees;

  // Summary stats
  const totalEmployees = employees.length;
  const avgAccuracy = employees.reduce((sum, e) => sum + e.accuracy_score, 0) / totalEmployees;
  const bestPerformer = employees[0]; // Already sorted by accuracy

  const summaryHtml = `
    <div class="emp-perf-summary">
      <div class="emp-perf-stat">
        <div class="emp-perf-number">${totalEmployees}</div>
        <div class="emp-perf-label">Active Employees</div>
      </div>
      <div class="emp-perf-stat">
        <div class="emp-perf-number">${avgAccuracy.toFixed(1)}%</div>
        <div class="emp-perf-label">Average Accuracy</div>
      </div>
      <div class="emp-perf-stat success">
        <div class="emp-perf-number">🏆 ${esc(bestPerformer.employee_name)}</div>
        <div class="emp-perf-label">Top Performer</div>
      </div>
    </div>
  `;

  // Leaderboard table
  const rows = employees.map((emp, index) => {
    const rankIcon = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : (index + 1);
    const reliabilityClass = emp.reliability === 'High' ? 'emp-reliable-high' : emp.reliability === 'Low' ? 'emp-reliable-low' : 'emp-reliable-med';
    const accuracyClass = emp.accuracy_score >= 90 ? 'emp-accuracy-high' : emp.accuracy_score >= 75 ? 'emp-accuracy-med' : 'emp-accuracy-low';

    return `<tr>
      <td class="emp-rank">${rankIcon}</td>
      <td class="emp-name">${esc(emp.employee_name)}</td>
      <td class="${accuracyClass} emp-accuracy-score">${emp.accuracy_score}%</td>
      <td>${emp.avg_variance_pct}%</td>
      <td>${emp.total_counts}</td>
      <td>${emp.total_production}</td>
      <td>${emp.total_activity}</td>
      <td><span class="emp-reliability-badge ${reliabilityClass}">${emp.reliability}</span></td>
    </tr>`;
  });

  const tableHtml = `
    <h3>Accuracy Leaderboard</h3>
    <table class="report-table emp-perf-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Employee</th>
          <th>Accuracy</th>
          <th>Avg Variance</th>
          <th>Counts</th>
          <th>Production</th>
          <th>Total Activity</th>
          <th>Reliability</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;

  wrap.innerHTML = summaryHtml + tableHtml;
}


function renderVarianceReport(data) {
  if (!data) return;

  const summaryWrap = document.getElementById('variance-summary');
  const itemsWrap = document.getElementById('variance-items');
  const chartCanvas = document.getElementById('variance-chart');

  // Render summary
  const summary = data.summary;
  summaryWrap.innerHTML = `
    <div class="variance-summary-grid">
      <div class="variance-summary-stat">
        <div class="variance-summary-number">${summary.total_items}</div>
        <div class="variance-summary-label">Items Counted</div>
      </div>
      <div class="variance-summary-stat ${summary.high_variance_count > 0 ? 'variance-warn' : ''}">
        <div class="variance-summary-number">${summary.high_variance_count}</div>
        <div class="variance-summary-label">High Variance (>25%)</div>
      </div>
      <div class="variance-summary-stat">
        <div class="variance-summary-number">${summary.avg_variance_pct}%</div>
        <div class="variance-summary-label">Avg Variance</div>
      </div>
    </div>
  `;

  // Render trend chart
  if (varianceTrendChart) varianceTrendChart.destroy();

  if (data.trend_data && data.trend_data.length > 0) {
    chartCanvas.style.display = '';
    const colors = getChartColors();

    varianceTrendChart = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: data.trend_data.map(d => {
          const dt = new Date(d.date + 'T12:00:00');
          return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
        datasets: [
          {
            label: 'Avg Variance %',
            data: data.trend_data.map(d => d.avg_variance_pct),
            borderColor: colors.orange,
            backgroundColor: colors.orange + '20',
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
            fill: true,
          },
          {
            label: 'High Variance Count',
            data: data.trend_data.map(d => d.high_variance_count),
            borderColor: colors.red,
            backgroundColor: colors.red + '20',
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.0,
        plugins: {
          legend: {
            labels: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 10 } } },
          y: { grid: { color: colors.gridColor }, ticks: { color: colors.textColor, font: { family: 'Roboto Mono', size: 11 } }, beginAtZero: true },
        },
      },
    });
  } else {
    chartCanvas.style.display = 'none';
  }

  // Render high variance items table
  if (!data.high_variance_items || data.high_variance_items.length === 0) {
    itemsWrap.innerHTML = '<p class="muted">No high variance items. All counts look good!</p>';
    return;
  }

  const rows = data.high_variance_items.map(item => {
    const varianceClass = Math.abs(item.variance_pct) > 50 ? 'variance-critical' : 'variance-high';
    const sign = item.variance >= 0 ? '+' : '';
    const displayPredicted = item.product_type === 'tub' ? formatTubCount(item.predicted) : item.predicted;
    const displayActual = item.product_type === 'tub' ? formatTubCount(item.actual) : item.actual;
    const employeeDisplay = item.employee_name ? esc(item.employee_name) : '<span class="variance-no-employee">—</span>';

    return `<tr class="${varianceClass}">
      <td>${esc(item.flavor_name)}</td>
      <td>${item.product_type}</td>
      <td>${displayPredicted}</td>
      <td>${displayActual}</td>
      <td class="${varianceClass}">${sign}${item.variance} (${item.variance_pct}%)</td>
      <td class="variance-employee">${employeeDisplay}</td>
      <td class="variance-date">${formatDate(item.date)}</td>
    </tr>`;
  });

  itemsWrap.innerHTML = `
    <h3>Items Needing Attention</h3>
    <table class="report-table variance-table">
      <thead><tr><th>Flavor</th><th>Type</th><th>Expected</th><th>Actual</th><th>Variance</th><th>Employee</th><th>Date</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

// ===== EXPORT =====
function toggleExportDropdown(e, reportName) {
  e.stopPropagation();
  // Remove any existing dropdowns
  document.querySelectorAll('.export-dropdown').forEach(d => d.remove());

  const btn = e.target.closest('.export-btn');
  const dropdown = document.createElement('div');
  dropdown.className = 'export-dropdown open';
  dropdown.innerHTML = `
    <button onclick="exportReport('${reportName}', 'csv')">CSV</button>
    <button onclick="exportReport('${reportName}', 'excel')">Excel</button>
    <button onclick="exportReport('${reportName}', 'pdf')">PDF</button>
  `;
  btn.style.position = 'relative';
  btn.appendChild(dropdown);
}

function getReportData(reportName) {
  switch (reportName) {
    case 'variance': {
      const data = reportCache.variance;
      if (!data || !data.high_variance_items) return null;
      return {
        title: `Variance Report (${reportDays} Days)`,
        headers: ['Flavor', 'Type', 'Expected', 'Actual', 'Variance', 'Variance %', 'Employee', 'Date'],
        rows: data.high_variance_items.map(item => [
          item.flavor_name,
          item.product_type,
          item.predicted,
          item.actual,
          item.variance,
          item.variance_pct + '%',
          item.employee_name || 'N/A',
          item.date
        ]),
        chartCanvas: document.getElementById('variance-chart'),
      };
    }
    case 'trend': {
      const data = reportCache.consumption;
      const byFlavor = {};
      data.forEach(d => {
        if (!byFlavor[d.flavor_name]) byFlavor[d.flavor_name] = { totalConsumed: 0, byType: {} };
        byFlavor[d.flavor_name].totalConsumed += d.consumed;
        if (!byFlavor[d.flavor_name].byType[d.product_type]) {
          byFlavor[d.flavor_name].byType[d.product_type] = [];
        }
        byFlavor[d.flavor_name].byType[d.product_type].push(d.closing_count || 0);
      });
      const avgType = (info, type) => {
        const vals = info.byType[type];
        if (!vals || !vals.length) return '—';
        return (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
      };
      const rows = Object.entries(byFlavor)
        .sort((a, b) => b[1].totalConsumed - a[1].totalConsumed)
        .map(([name, info]) => [name, avgType(info, 'tub'), avgType(info, 'pint'), avgType(info, 'quart')]);
      return {
        title: `Nightly Stock Levels (${reportDays} Days)`,
        headers: ['Flavor', 'Tubs', 'Pints', 'Quarts'],
        rows,
        chartCanvas: document.getElementById('trend-chart'),
      };
    }
    case 'waste': {
      const data = reportCache.waste;
      return {
        title: `Production Summary (${reportDays} Days)`,
        headers: ['Flavor', 'Made', 'Sold', '+/-'],
        rows: data.map(d => [d.flavor_name, d.produced, d.consumed, d.surplus]),
        chartCanvas: document.getElementById('waste-chart'),
      };
    }
    case 'category': {
      const data = reportCache.popularity;
      const catMap = {};
      flavors.forEach(f => { catMap[f.name] = f.category; });
      const byCat = {};
      data.forEach(d => {
        const cat = catMap[d.flavor_name] || 'Other';
        if (!byCat[cat]) byCat[cat] = { total: 0, flavors: {}, bestName: '', bestVal: 0 };
        byCat[cat].total += d.total;
        byCat[cat].flavors[d.flavor_name] = (byCat[cat].flavors[d.flavor_name] || 0) + d.total;
        if (d.total > byCat[cat].bestVal) {
          byCat[cat].bestVal = d.total;
          byCat[cat].bestName = d.flavor_name;
        }
      });
      const rows = Object.entries(byCat)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([cat, info]) => {
          const numFlavors = Object.keys(info.flavors).length;
          return [cat, info.total, numFlavors, numFlavors > 0 ? (info.total / numFlavors).toFixed(1) : 0, info.bestName];
        });
      return {
        title: `Category Performance (${reportDays} Days)`,
        headers: ['Category', 'Total', '# Flavors', 'Avg/Flavor', 'Best Seller'],
        rows,
        chartCanvas: document.getElementById('category-chart'),
      };
    }
    case 'par': {
      const data = reportCache.parAccuracy;
      return {
        title: `Par Level Accuracy (${reportDays} Days)`,
        headers: ['Flavor', 'Type', 'Target', 'Avg/Day', 'Suggested', 'Status', 'Action'],
        rows: data.map(d => [
          d.flavor_name, d.product_type, d.current_target, d.avg_daily_use,
          d.suggested_target, d.status === 'well_set' ? 'Well Set' : d.status === 'too_high' ? 'Too High' : 'Too Low',
          d.action || '',
        ]),
        chartCanvas: null,
      };
    }
    case 'employee': {
      const data = reportCache.employeePerformance;
      if (!data || !data.employees) return null;
      return {
        title: `Employee Performance (${reportDays} Days)`,
        headers: ['Rank', 'Employee', 'Accuracy %', 'Avg Variance %', 'Counts', 'Production', 'Total Activity', 'Reliability'],
        rows: data.employees.map((emp, idx) => [
          idx + 1,
          emp.employee_name,
          emp.accuracy_score + '%',
          emp.avg_variance_pct + '%',
          emp.total_counts,
          emp.total_production,
          emp.total_activity,
          emp.reliability,
        ]),
        chartCanvas: null,
      };
    }
    default:
      return null;
  }
}

function exportReport(reportName, format) {
  // Close dropdown
  document.querySelectorAll('.export-dropdown').forEach(d => d.remove());

  const reportData = getReportData(reportName);
  if (!reportData || !reportData.rows.length) {
    toast('No data to export', 'error');
    return;
  }

  switch (format) {
    case 'csv':
      exportCSV(reportData.title, reportData.headers, reportData.rows);
      break;
    case 'excel':
      exportExcel(reportData.title, reportData.headers, reportData.rows);
      break;
    case 'pdf':
      exportPDF(reportData.title, reportData.headers, reportData.rows, reportData.chartCanvas);
      break;
  }
}

function exportCSV(title, headers, rows) {
  const escape = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines = [headers.map(escape).join(',')];
  rows.forEach(row => lines.push(row.map(escape).join(',')));
  const csv = lines.join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, sanitizeFilename(title) + '.csv');
  toast('CSV exported');
}

function exportExcel(title, headers, rows) {
  if (typeof XLSX === 'undefined') {
    toast('Excel library not loaded', 'error');
    return;
  }
  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, sanitizeFilename(title) + '.xlsx');
  toast('Excel exported');
}

function exportPDF(title, headers, rows, chartCanvas) {
  if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
    toast('PDF library not loaded', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(16);
  doc.text(title, 14, 20);

  let startY = 30;

  // Add chart image if available
  if (chartCanvas && chartCanvas.style.display !== 'none') {
    try {
      const imgData = chartCanvas.toDataURL('image/png');
      const imgWidth = 180;
      const imgHeight = 80;
      doc.addImage(imgData, 'PNG', 14, startY, imgWidth, imgHeight);
      startY += imgHeight + 10;
    } catch (e) {
      console.warn('Could not export chart image:', e);
    }
  }

  doc.autoTable({
    head: [headers],
    body: rows.map(r => r.map(v => String(v ?? ''))),
    startY,
    styles: { fontSize: 8, font: 'helvetica' },
    headStyles: { fillColor: [228, 5, 33] },
  });

  doc.save(sanitizeFilename(title) + '.pdf');
  toast('PDF exported');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
}

// ===== HELPERS =====
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function formatTime(iso) {
  if (!iso) return '';
  // Append Z so JS treats the server's UTC string as UTC, then converts to local time
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ===== PHOTO IMPORT =====
let photoImportData = null;
let photoBase64 = null;

function openPhotoImportModal() {
  document.getElementById('photo-import-modal').classList.remove('hidden');
  showPhotoStep('upload');
  // Reset state
  photoImportData = null;
  photoBase64 = null;
  document.getElementById('photo-file-input').value = '';
  document.getElementById('photo-preview-wrap').classList.add('hidden');
  document.getElementById('btn-scan-sheet').disabled = true;
}

function closePhotoImportModal() {
  document.getElementById('photo-import-modal').classList.add('hidden');
}

function showPhotoStep(step) {
  document.querySelectorAll('.photo-step').forEach(el => el.classList.add('hidden'));
  document.getElementById('photo-step-' + step).classList.remove('hidden');
}

function onPhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Resize image client-side
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX = 1600;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      photoBase64 = dataUrl.split(',')[1];

      // Show preview
      const preview = document.getElementById('photo-preview-img');
      preview.src = dataUrl;
      document.getElementById('photo-preview-wrap').classList.remove('hidden');
      document.getElementById('btn-scan-sheet').disabled = false;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function scanSheet() {
  if (!photoBase64) return;
  showPhotoStep('loading');

  const flavorNames = flavors.map(f => f.name);

  try {
    photoImportData = await api('/api/photo-import/parse', {
      method: 'POST',
      body: JSON.stringify({
        image_base64: photoBase64,
        available_flavors: flavorNames,
      }),
    });
    renderPhotoReview();
    showPhotoStep('review');
  } catch (e) {
    toast('Failed to scan sheet: ' + e.message, 'error');
    showPhotoStep('upload');
  }
}

function renderPhotoReview() {
  const data = photoImportData;
  if (!data) return;

  document.getElementById('photo-sheet-type').textContent =
    data.sheet_type === 'tubs' ? 'Tub Inventory Sheet' :
    data.sheet_type === 'pints_quarts' ? 'Pints & Quarts Sheet' : data.sheet_type;

  // Warnings
  const warningsEl = document.getElementById('photo-warnings');
  if (data.warnings && data.warnings.length > 0) {
    warningsEl.innerHTML = data.warnings.map(w => `<p class="photo-warning-item">${esc(w)}</p>`).join('');
    warningsEl.classList.remove('hidden');
  } else {
    warningsEl.classList.add('hidden');
  }

  // Build date sections
  const wrap = document.getElementById('photo-dates-wrap');
  if (data.dates.length === 0) {
    wrap.innerHTML = '<p class="muted">No data detected in the image.</p>';
    return;
  }

  let html = '';
  data.dates.forEach((dateObj, di) => {
    const displayDate = formatDate(dateObj.date);
    html += `<div class="photo-date-section">
      <label class="photo-date-header">
        <input type="checkbox" checked data-date-idx="${di}" class="photo-date-check">
        <strong>${esc(displayDate || dateObj.date)}</strong>
        <input type="text" class="photo-initials-input" value="${esc(dateObj.employee_initials || '')}"
               placeholder="Initials" data-date-idx="${di}" maxlength="10">
      </label>
      <table class="voice-confirm-table photo-review-table">
        <thead>
          <tr><th>Flavor</th><th>Type</th><th>Count</th><th>Conf.</th></tr>
        </thead>
        <tbody>`;

    dateObj.entries.forEach((entry, ei) => {
      const confClass = entry.confidence < 0.5 ? 'conf-low' :
                        entry.confidence < 0.7 ? 'conf-med' : 'conf-high';
      const confPct = Math.round(entry.confidence * 100);
      const isUnmatched = !entry.flavor_matched_name;

      let flavorCell;
      if (isUnmatched) {
        // Dropdown to pick correct flavor
        const opts = flavors.map(f =>
          `<option value="${f.id}" data-name="${esc(f.name)}">${esc(f.name)}</option>`
        ).join('');
        flavorCell = `<span class="photo-unmatched-name">${esc(entry.flavor_sheet_name)}</span>
          <select class="photo-flavor-fix" data-date-idx="${di}" data-entry-idx="${ei}" onchange="fixPhotoFlavor(this)">
            <option value="">-- Fix match --</option>${opts}
          </select>`;
      } else {
        flavorCell = esc(entry.flavor_matched_name);
      }

      html += `<tr class="${isUnmatched ? 'photo-row-unmatched' : ''}">
        <td>${flavorCell}</td>
        <td>${esc(entry.product_type)}</td>
        <td><input type="number" step="0.25" min="0" class="photo-count-input"
                   value="${entry.count}" data-date-idx="${di}" data-entry-idx="${ei}"></td>
        <td><span class="conf-badge ${confClass}">${confPct}%</span></td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
  });

  // Unmatched flavor summary
  if (data.unmatched_flavors.length > 0) {
    html += `<div class="photo-unmatched-summary">
      <strong>Unmatched flavors:</strong> ${data.unmatched_flavors.map(f => esc(f)).join(', ')}
      <br><span class="muted">Use the dropdowns above to assign them, or they will be skipped.</span>
    </div>`;
  }

  wrap.innerHTML = html;
}

function fixPhotoFlavor(select) {
  const di = parseInt(select.dataset.dateIdx);
  const ei = parseInt(select.dataset.entryIdx);
  const opt = select.options[select.selectedIndex];
  if (select.value) {
    photoImportData.dates[di].entries[ei].flavor_id = parseInt(select.value);
    photoImportData.dates[di].entries[ei].flavor_matched_name = opt.dataset.name;
    select.closest('tr').classList.remove('photo-row-unmatched');
  }
}

async function submitPhotoImport() {
  if (!photoImportData) return;

  const allEntries = [];
  let skippedCount = 0;

  photoImportData.dates.forEach((dateObj, di) => {
    // Check if date is selected
    const checkbox = document.querySelector(`.photo-date-check[data-date-idx="${di}"]`);
    if (!checkbox || !checkbox.checked) return;

    // Get initials
    const initialsInput = document.querySelector(`.photo-initials-input[data-date-idx="${di}"]`);
    const initials = initialsInput ? initialsInput.value.trim() : '';

    // Get counted_at timestamp
    const countedAt = dateObj.date ? dateObj.date + 'T21:00:00Z' : null;

    dateObj.entries.forEach((entry, ei) => {
      // Get possibly edited count value
      const countInput = document.querySelector(`.photo-count-input[data-date-idx="${di}"][data-entry-idx="${ei}"]`);
      const count = countInput ? parseFloat(countInput.value) : entry.count;

      // Need a valid flavor_id
      if (!entry.flavor_id) {
        skippedCount++;
        return;
      }

      allEntries.push({
        flavor_id: entry.flavor_id,
        product_type: entry.product_type,
        count: count,
        employee_name: initials,
        counted_at: countedAt,
      });
    });
  });

  // Deduplicate by (flavor_id, product_type, counted_at) — keep last occurrence
  const dedupMap = new Map();
  allEntries.forEach(e => {
    dedupMap.set(`${e.flavor_id}-${e.product_type}-${e.counted_at}`, e);
  });
  const dedupedEntries = Array.from(dedupMap.values());

  if (dedupedEntries.length === 0) {
    toast('No entries to import.', 'error');
    return;
  }

  try {
    await api('/api/counts', {
      method: 'POST',
      body: JSON.stringify({ entries: dedupedEntries }),
    });
    const msg = `Imported ${dedupedEntries.length} counts!` +
                (skippedCount > 0 ? ` (${skippedCount} skipped — unmatched flavors)` : '');
    toast(msg);
    closePhotoImportModal();
    loadCountHistory();
  } catch (e) {
    toast('Import failed: ' + e.message, 'error');
  }
}
