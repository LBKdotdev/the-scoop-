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
let reportDays = 7;   // current report range
let voiceRecognition = null;
let isVoiceActive = false;

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
  loadFlavors().then(() => {
    loadHome();
    loadProductionHistory();
  });
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
      if (target === 'count') loadSmartDefaults();
      if (target === 'production') { loadProductionHistory(); restoreEmployeeName('prod-employee-name'); }
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
      });
    });
  });
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

  showVoiceFeedback('Listening... Say: "Flavor name, type, number"', false);

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

function parseVoiceCommand(transcript) {
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

  if (!matchedFlavor) {
    showVoiceFeedback(`❌ Flavor "${flavorName}" not found. Try again.`, true, 'error');
    return;
  }

  if (!productType) {
    showVoiceFeedback(`❌ Product type not detected. Say "tub", "pint", or "quart".`, true, 'error');
    return;
  }

  if (!quantity) {
    showVoiceFeedback(`❌ Quantity not detected. Say a number.`, true, 'error');
    return;
  }

  // Apply the count
  const key = `${matchedFlavor.id}-${productType}`;
  const input = document.getElementById(`count-${key}`);

  if (!input) {
    showVoiceFeedback(`❌ ${matchedFlavor.name} ${productType} not in current view. Check filters.`, true, 'error');
    return;
  }

  // Update the count
  input.value = quantity;
  countEdits[key] = quantity;
  updatePartialToggle(key);
  updateVarianceIndicator(key);

  // Success feedback
  showVoiceFeedback(`✅ ${matchedFlavor.name} ${productType}: ${quantity}`, true, 'success');

  // Scroll to the updated field
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.classList.add('voice-updated');
  setTimeout(() => input.classList.remove('voice-updated'), 1500);
}

function findFlavorByName(spokenName) {
  const normalized = spokenName.toLowerCase().trim();

  // Try exact match first
  let match = flavors.find(f => f.name.toLowerCase() === normalized);
  if (match) return match;

  // Try partial match (contains)
  match = flavors.find(f => f.name.toLowerCase().includes(normalized));
  if (match) return match;

  // Try reverse (spoken contains flavor name)
  match = flavors.find(f => normalized.includes(f.name.toLowerCase()));
  if (match) return match;

  // Try fuzzy match (all words present)
  const spokenWords = normalized.split(/\s+/);
  match = flavors.find(f => {
    const flavorWords = f.name.toLowerCase().split(/\s+/);
    return flavorWords.every(fw => spokenWords.some(sw => sw.includes(fw) || fw.includes(sw)));
  });

  return match;
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
  const selects = [document.getElementById('prod-flavor')];
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
  ['inv-category-filter', 'count-category-filter'].forEach(id => {
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
      items.forEach(p => {
        const key = `${p.flavor_id}-${p.product_type}`;
        const ed = parEdits[key] || { target: p.target, minimum: p.minimum, batch_size: p.batch_size, weekend_target: p.weekend_target ?? '' };
        html += `
          <div class="par-row">
            <div class="par-row-header">
              <span class="par-flavor-name">${esc(p.flavor_name)}</span>
              <span class="par-flavor-type">${p.product_type}</span>
            </div>
            <div class="par-fields">
              <div class="par-field">
                <label>Ready at open</label>
                <input type="number" min="0" value="${ed.target}"
                  onchange="updateParEdit('${key}', 'target', this.value)">
              </div>
              <div class="par-field">
                <label>Make more at</label>
                <input type="number" min="0" value="${ed.minimum}"
                  onchange="updateParEdit('${key}', 'minimum', this.value)">
              </div>
              <div class="par-field">
                <label>One batch makes</label>
                <input type="number" min="0.25" step="0.25" value="${ed.batch_size}"
                  onchange="updateParEdit('${key}', 'batch_size', this.value)">
              </div>
              <div class="par-field">
                <label>Weekend target</label>
                <input type="number" min="0" value="${ed.weekend_target}"
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
    parEdits[key] = { flavor_id: parseInt(fid), product_type: ptype, target: 0, minimum: 0, batch_size: 1, weekend_target: '' };
  }
  if (field === 'weekend_target') {
    parEdits[key][field] = value === '' ? '' : parseInt(value) || 0;
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
async function submitProduction(e) {
  e.preventDefault();
  const employee_name = document.getElementById('prod-employee-name').value.trim();
  const flavor_id = parseInt(document.getElementById('prod-flavor').value);
  const product_type = document.getElementById('prod-type').value;
  const quantity = parseInt(document.getElementById('prod-qty').value);

  if (!employee_name) {
    toast('Please enter your name or initials', 'error');
    document.getElementById('prod-employee-name').focus();
    return;
  }
  if (!flavor_id || !quantity) return;

  try {
    await api('/api/production', {
      method: 'POST',
      body: JSON.stringify({ flavor_id, product_type, quantity, employee_name }),
    });
    const flavorName = flavors.find(f => f.id === flavor_id)?.name || '';
    toast(`Logged ${quantity} ${product_type}(s) of ${flavorName}`);

    // Save employee name for next time
    localStorage.setItem('employee-name', employee_name);

    document.getElementById('prod-qty').value = '1';
    loadProductionHistory();
  } catch (e) {
    toast(e.message, 'error');
  }
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
  if (!confirm('Delete this production entry?')) return;
  try {
    await api(`/api/production/${id}`, { method: 'DELETE' });
    toast('Entry deleted');
    loadProductionHistory();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ===== DAILY COUNT =====
async function loadSmartDefaults() {
  try {
    smartDefaults = await api('/api/counts/smart-defaults');
    countEdits = {};
    countPredictions = {};
    smartDefaults.forEach(d => {
      const key = `${d.flavor_id}-${d.product_type}`;
      countEdits[key] = d.estimated_count;
      countPredictions[key] = d.estimated_count;  // Store prediction for variance calculation
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

  let filtered = smartDefaults;
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

  // Group by category
  const byCat = {};
  Object.values(byFlavor).forEach(f => {
    if (!byCat[f.category]) byCat[f.category] = [];
    byCat[f.category].push(f);
  });

  let html = '';
  for (const [cat, items] of Object.entries(byCat)) {
    html += `<div class="count-group">`;
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
                <input type="number" id="count-${key}" value="${val}" min="0" step="${isTub ? '0.25' : '1'}"
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
}

async function submitCounts() {
  // Get employee name
  const employeeNameInput = document.getElementById('employee-name');
  const employeeName = employeeNameInput?.value?.trim();

  if (!employeeName) {
    toast('Please enter your name or initials', 'error');
    employeeNameInput?.focus();
    return;
  }

  const entries = Object.entries(countEdits).map(([key, count]) => {
    const [flavor_id, product_type] = key.split('-');
    const predicted_count = countPredictions[key] || null;
    return {
      flavor_id: parseInt(flavor_id),
      product_type,
      count,
      predicted_count,
      employee_name: employeeName
    };
  });

  if (!entries.length) {
    toast('No counts to submit', 'error');
    return;
  }

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
      <div class="kpi-label">Critical Items</div>
    </div>
    <div class="kpi-card warning clickable" onclick="switchToTab('dashboard')" title="View below par items on Dashboard">
      <div class="kpi-number">${belowPar}</div>
      <div class="kpi-label">Below Par</div>
    </div>
    <div class="kpi-card neutral clickable" onclick="switchToTab('dashboard')" title="View full make list on Dashboard">
      <div class="kpi-number">${batches}</div>
      <div class="kpi-label">Batches Needed</div>
    </div>
    <div class="kpi-card success clickable" onclick="switchToTab('flavors')" title="View stock levels on Flavors tab">
      <div class="kpi-number">${stocked}</div>
      <div class="kpi-label">Fully Stocked</div>
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

  wrap.innerHTML = insights.map(i => `<li class="home-insight-item">${esc(i)}</li>`).join('');
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
    const [inv, alerts, popularity, pvc, makeList] = await Promise.all([
      api('/api/dashboard/inventory'),
      api('/api/dashboard/alerts'),
      api('/api/dashboard/popularity?days=7'),
      api('/api/dashboard/production-vs-consumption?days=7'),
      api('/api/dashboard/make-list'),
    ]);
    inventory = inv;
    renderMakeList(makeList);
    renderAlerts(alerts);
    renderInventoryTable();
    renderPopularityChart(popularity);
    renderPvcChart(pvc);
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
    html += `
      <tr class="ml-${item.status}">
        <td>
          <span class="ml-status-dot ${item.status}"></span>
          <span class="ml-flavor">${esc(item.flavor_name)}</span>
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
      html += `
        <tr class="ml-stocked">
          <td>
            <span class="ml-status-dot stocked"></span>
            <span class="ml-flavor">${esc(item.flavor_name)}</span>
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

function renderPvcChart(data) {
  const ctx = document.getElementById('pvc-chart');
  if (pvcChart) pvcChart.destroy();

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

    renderVarianceReport(variance);
    renderTrendChart(consumption);
    renderTrendSummary(consumption);
    renderWasteChart(waste);
    renderWasteTable(waste);
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

  // Aggregate by flavor and date
  const byFlavor = {};
  data.forEach(d => {
    if (!byFlavor[d.flavor_name]) byFlavor[d.flavor_name] = { total: 0, dates: {} };
    byFlavor[d.flavor_name].total += d.consumed;
    byFlavor[d.flavor_name].dates[d.date] = (byFlavor[d.flavor_name].dates[d.date] || 0) + d.consumed;
  });

  // Top 5 by total consumption
  const top5 = Object.entries(byFlavor)
    .sort((a, b) => b[1].total - a[1].total)
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
    wrap.innerHTML = '<p class="muted">No consumption data for this period.</p>';
    return;
  }

  // Aggregate by flavor and product type
  const byFlavor = {};
  data.forEach(d => {
    if (!byFlavor[d.flavor_name]) {
      byFlavor[d.flavor_name] = {
        total: 0,
        dates: {},
        byType: { tub: 0, pint: 0, quart: 0 }
      };
    }
    byFlavor[d.flavor_name].total += d.consumed;
    byFlavor[d.flavor_name].dates[d.date] = (byFlavor[d.flavor_name].dates[d.date] || 0) + d.consumed;
    byFlavor[d.flavor_name].byType[d.product_type] = (byFlavor[d.flavor_name].byType[d.product_type] || 0) + d.consumed;
  });

  const allDates = [...new Set(data.map(d => d.date))].sort();
  const midpoint = Math.floor(allDates.length / 2);
  const firstHalf = allDates.slice(0, midpoint);
  const secondHalf = allDates.slice(midpoint);

  const rows = Object.entries(byFlavor)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, info]) => {
      const numDays = Object.keys(info.dates).length || 1;
      const avg = (info.total / numDays).toFixed(1);

      // Trend: compare first half avg to second half avg
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

      const tubDisplay = info.byType.tub ? formatTubCount(info.byType.tub) : '0';

      return `<tr>
        <td>${esc(name)}</td>
        <td>${avg}</td>
        <td>${tubDisplay}</td>
        <td>${info.byType.pint || 0}</td>
        <td>${info.byType.quart || 0}</td>
        <td>${info.total}</td>
        <td class="${trendClass}">${trendArrow}</td>
      </tr>`;
    });

  if (!rows.length) {
    wrap.innerHTML = '<p class="muted">No consumption data for this period.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="report-table">
      <thead><tr><th>Flavor</th><th>Avg/Day</th><th>Tubs</th><th>Pints</th><th>Quarts</th><th>Total</th><th>Trend</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function renderWasteChart(data) {
  const ctx = document.getElementById('waste-chart');
  if (wasteChart) wasteChart.destroy();

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

function renderWasteTable(data) {
  const wrap = document.getElementById('waste-table');

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
      <thead><tr><th>Flavor</th><th>Produced</th><th>Consumed</th><th>Surplus</th></tr></thead>
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
        if (!byFlavor[d.flavor_name]) {
          byFlavor[d.flavor_name] = {
            total: 0,
            dates: {},
            byType: { tub: 0, pint: 0, quart: 0 }
          };
        }
        byFlavor[d.flavor_name].total += d.consumed;
        byFlavor[d.flavor_name].dates[d.date] = (byFlavor[d.flavor_name].dates[d.date] || 0) + d.consumed;
        byFlavor[d.flavor_name].byType[d.product_type] = (byFlavor[d.flavor_name].byType[d.product_type] || 0) + d.consumed;
      });
      const rows = Object.entries(byFlavor)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([name, info]) => {
          const numDays = Object.keys(info.dates).length || 1;
          const tubDisplay = info.byType.tub ? formatTubCount(info.byType.tub) : '0';
          return [
            name,
            (info.total / numDays).toFixed(1),
            tubDisplay,
            info.byType.pint || 0,
            info.byType.quart || 0,
            info.total
          ];
        });
      return {
        title: `Consumption Trends (${reportDays} Days)`,
        headers: ['Flavor', 'Avg/Day', 'Tubs', 'Pints', 'Quarts', 'Total'],
        rows,
        chartCanvas: document.getElementById('trend-chart'),
      };
    }
    case 'waste': {
      const data = reportCache.waste;
      return {
        title: `Production Summary (${reportDays} Days)`,
        headers: ['Flavor', 'Produced', 'Consumed', 'Surplus'],
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
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
