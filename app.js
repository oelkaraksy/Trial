// ─────────────────────────────────────────────
// FILE PATHS  — update these whenever you push new CSVs to GitHub
// ─────────────────────────────────────────────
const FILES = {
  inflationDetails: 'https://raw.githubusercontent.com/oelkaraksy/Dcode_Inflation_Dashboard/refs/heads/main/Feb%20Inflation%20Data.csv',
  annualHistory:    'https://raw.githubusercontent.com/oelkaraksy/Dcode_Inflation_Dashboard/refs/heads/main/Annual%20Inflation%20Historical%20Data.csv',
  monthlyHistory:   'https://raw.githubusercontent.com/oelkaraksy/Dcode_Inflation_Dashboard/refs/heads/main/Monthly%20Inflation%20Historical%20Data.csv',
  categoriesHistory:'https://raw.githubusercontent.com/oelkaraksy/Dcode_Inflation_Dashboard/refs/heads/main/Categories_Inflation.csv',
  exchangeRates:    'https://raw.githubusercontent.com/oelkaraksy/Dcode_Inflation_Dashboard/refs/heads/main/Exchange_Rates.csv'
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function parseCSVString(csv) {
  const rows = [];
  const lines = csv.split(/\r?\n/);
  for (let raw of lines) {
    if (raw.trim() === '') continue;
    const row = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') {
        if (inQuotes && raw[i+1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) { row.push(cur); cur = ''; }
      else { cur += ch; }
    }
    row.push(cur);
    rows.push(row.map(v => v.trim()));
  }
  return rows;
}

// TSV parser (Exchange rates use tab)
function parseTSV(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t').map(v => v.trim()));
}

async function fetchTextOrNull(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch(e) { return null; }
}

function toNumber(s) {
  if (s === null || s === undefined) return NaN;
  if (typeof s === 'number') return s;
  const c = (''+s).replace(/%/g,'').replace(/,/g,'').trim();
  if (c === '') return NaN;
  return parseFloat(c);
}

function parseInflationDetails(rows) {
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (r.length < 5) continue;
    items.push({ type:r[0], item:r[1], weight:toNumber(r[2])||0, annual:toNumber(r[3])||0, monthly:toNumber(r[4])||0 });
  }
  return items;
}

function parseHistorical(rows) {
  const arr = [];
  for (let r of rows) {
    if (r.length < 2) continue;
    const value = toNumber(r[1]);
    if (isNaN(value)) continue;
    arr.push({ date: r[0], rate: value });
  }
  return arr;
}

function parseExchangeRates(rows) {
  const arr = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (r.length < 2) continue;
    const v = toNumber(r[1]);
    if (isNaN(v) || v === 0) continue;
    arr.push({ date: r[0], rate: v });
  }
  return arr;
}

// Parse the wide-format categories CSV
// Columns: [CategoryName, Jan-2021, Feb-2021, ...]
function parseCategoriesHistory(rows) {
  if (rows.length < 2) return {};
  const headers = rows[0]; // ["Annual Categorical Inflation", "Jan-2021", ...]
  const dateLabels = headers.slice(1).filter(h => h !== '');
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0] || r[0].trim() === '') continue;
    const catName = r[0].trim();
    const values = [];
    for (let j = 1; j < r.length; j++) {
      const v = toNumber(r[j]);
      if (!isNaN(v)) values.push({ date: headers[j], rate: v / 100 });
    }
    result[catName] = values;
  }
  return result;
}

// Extract just the month name from a date string like " February, 2025" or "Feb-2025"
function extractMonthName(dateStr) {
  if (!dateStr) return null;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const s = dateStr.toString().trim();
  for (const m of months) {
    if (s.toLowerCase().includes(m.toLowerCase())) return m;
    if (s.toLowerCase().includes(m.slice(0,3).toLowerCase())) return m;
  }
  return null;
}

function buildHierarchy(items) {
  const mainCategories = [];
  let currentMain = null;
  items.forEach(row => {
    if (row.type.startsWith('main category')) {
      currentMain = { item:row.item, weight:row.weight, annual:row.annual, monthly:row.monthly, subItems:[] };
      mainCategories.push(currentMain);
    } else if (row.type.startsWith('sub category') || row.type.startsWith('sub item')) {
      if (currentMain) currentMain.subItems.push(row);
    }
  });
  return mainCategories;
}

// ─────────────────────────────────────────────
// CATEGORY NAME MATCHING
// Maps main category display names to categories CSV row names
// ─────────────────────────────────────────────
const CATEGORY_MAP = {
  'FOOD AND NON-ALCOHOLIC BEVERAGES':         'Food & Beverages',
  'ALCOHOLIC BEVERAGES & TOBACCO':            'Alcoholic Beverages & Tobacco',
  'CLOTHING AND FOOTWEAR':                    'Clothes & Footwear',
  'HOUSING,WATER,ELECTRICITY,GAS & FUELS':   'Housing & Utilities',
  "FURNISHINGS, HOUSEHOLD'S EQUIPMENT & MAINTENANCE": 'Furniture & Household Equipment',
  'HEALTH':                                   'Healthcare',
  'TRANSPORT':                                'Transportation',
  'COMMUNICATIONS':                           'Communications',
  'RECREATION AND CULTURE':                   'Recreation & Culture',
  'EDUCATION':                                'Education',
  'RESTAURANTS AND HOTELS':                   'Hotels & Restaurants',
  'MISCELLANEOUS GOODS AND SERVICES':         'Miscellaneous Goods & Services'
};

function findCategoryHistory(catName, categoriesData) {
  // Direct match
  if (categoriesData[catName]) return categoriesData[catName];
  // Map match
  const mapped = CATEGORY_MAP[catName.toUpperCase()] || CATEGORY_MAP[catName];
  if (mapped && categoriesData[mapped]) return categoriesData[mapped];
  // Fuzzy: try any key that contains first word of catName
  const firstWord = catName.split(/[\s,&]/)[0].toLowerCase();
  for (const key of Object.keys(categoriesData)) {
    if (key.toLowerCase().includes(firstWord)) return categoriesData[key];
  }
  return null;
}

// ─────────────────────────────────────────────
// CHART COLORS
// ─────────────────────────────────────────────
const PIE_COLORS = ["#003C73","#005A9E","#0070C0","#338ACD","#66A3DA","#99BDE6","#C2D8F2","#1a5276","#2e86c1","#3498db","#85c1e9","#aed6f1"];
const CAT_COLORS = ["#0070C0","#e67e22","#27ae60","#8e44ad","#c0392b","#16a085","#d35400","#2980b9","#1abc9c","#f39c12","#7f8c8d","#2c3e50"];

// ─────────────────────────────────────────────
// SUMMARY FLASHCARDS  (Enhancement #1: show previous month name)
// ─────────────────────────────────────────────
function createSummaryCards(allItem, prevAnnualEntry, prevMonthlyEntry, latestAnnualEntry, latestMonthlyEntry) {
  const container = document.getElementById('flashcards');

  const annualDate  = latestAnnualEntry  ? latestAnnualEntry.date  : '—';
  const monthlyDate = latestMonthlyEntry ? latestMonthlyEntry.date : '—';

  const latestAnnual  = latestAnnualEntry  ? latestAnnualEntry.rate  * 100 : NaN;
  const latestMonthly = latestMonthlyEntry ? latestMonthlyEntry.rate * 100 : NaN;

  const prevAnnual  = prevAnnualEntry  ? prevAnnualEntry.rate  * 100 : null;
  const prevMonthly = prevMonthlyEntry ? prevMonthlyEntry.rate * 100 : null;

  // Extract previous month name
  const prevAnnualMonthName  = prevAnnualEntry  ? (extractMonthName(prevAnnualEntry.date)  || 'Previous month') : null;
  const prevMonthlyMonthName = prevMonthlyEntry ? (extractMonthName(prevMonthlyEntry.date) || 'Previous month') : null;

  function fmt(v) { return isNaN(v) ? '—' : v.toFixed(1) + '%'; }

  container.innerHTML = `
    <div class="card">
      <div class="big-number">Annual Inflation Rate</div>
      <div class="big-number">${annualDate}</div>
      <div class="big-big-number" style="color:#0070C0">${fmt(latestAnnual)}</div>
      <div class="small">${prevAnnualMonthName !== null ? prevAnnualMonthName + ': ' + (prevAnnual !== null ? prevAnnual.toFixed(1)+'%' : 'Missing') : 'Missing'}</div>
    </div>
    <div class="card">
      <div class="big-number">Monthly Inflation Rate</div>
      <div class="big-number">${monthlyDate}</div>
      <div class="big-big-number" style="color:#0070C0">${fmt(latestMonthly)}</div>
      <div class="small">${prevMonthlyMonthName !== null ? prevMonthlyMonthName + ': ' + (prevMonthly !== null ? prevMonthly.toFixed(1)+'%' : 'Missing') : 'Missing'}</div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// PIE CHART  (Enhancement #2: hidden behind toggle button)
// ─────────────────────────────────────────────
function renderPie(mainCategories) {
  const labels = mainCategories.map(c => c.item);
  const data   = mainCategories.map(c => c.weight);

  const canvas = document.getElementById('weightsPieChart');
  const ctx = canvas.getContext('2d');
  canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
  canvas.height = canvas.clientHeight * window.devicePixelRatio;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  if (window.pieChart) window.pieChart.destroy();

  window.pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: PIE_COLORS, borderColor:'#fff', borderWidth:1 }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      radius:'100%',
      cutout:'60%',
      plugins: {
        legend: { display:true, position:'right', labels:{ font:{ size:12 }, boxWidth:14 } },
        datalabels: {
          color:'#fff',
          font:{ weight:'bold', size:13 },
          formatter: v => v.toFixed(1)+'%',
          anchor:'center',
          align:'center'
        },
        tooltip:{ enabled:true }
      }
    },
    plugins: [ChartDataLabels]
  });

  requestAnimationFrame(() => window.pieChart.update());
}

function setupPieToggle(mainCategories) {
  const btn     = document.getElementById('pie-toggle-btn');
  const wrapper = document.getElementById('pie-section-wrapper');
  if (!btn || !wrapper) return;

  let rendered = false;

  btn.addEventListener('click', () => {
    const isHidden = wrapper.style.display === 'none' || wrapper.style.display === '';
    if (isHidden) {
      wrapper.style.display = 'block';
      btn.textContent = '▲ Hide Chart';
      if (!rendered) { renderPie(mainCategories); rendered = true; }
    } else {
      wrapper.style.display = 'none';
      btn.textContent = '▼ Show CPI Weights Chart';
    }
  });
}

// ─────────────────────────────────────────────
// CATEGORY CARDS  (Enhancement #3: click opens line chart modal)
// ─────────────────────────────────────────────
function renderCategoryCards(mainCategories, categoriesData) {
  const container = document.getElementById('category-cards');
  container.innerHTML = '';

  mainCategories.forEach((cat, idx) => {
    const el = document.createElement('div');
    el.className = 'category-card';
    el.style.borderTopColor = CAT_COLORS[idx % CAT_COLORS.length];
    if (!cat._originalSubItems) cat._originalSubItems = [...cat.subItems];

    const renderSubItems = (subItems) => subItems.map(sub => {
      const isSubCategory = /sub category/i.test(sub.type);
      const bg = isSubCategory ? '#cce4ff' : 'transparent';
      return `
        <div class="subitem-row" style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #f3f4f6;background-color:${bg};border-radius:4px;">
          <div style="flex:1;max-width:70%">${sub.item}</div>
          <div style="flex:1;display:flex;justify-content:center;gap:40px">
            <div style="text-align:center;color:${sub.annual<0?'var(--success)':'inherit'}">${sub.annual.toFixed(1)}</div>
            <div style="text-align:center;color:${sub.monthly<0?'var(--success)':'inherit'}">${sub.monthly.toFixed(1)}</div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${cat.item}</strong>
        <div class="small">Weight: ${cat.weight.toFixed(1)}%</div>
      </div>
      <div style="display:flex;gap:12px;margin-top:8px;align-items:center">
        <div style="flex:1">
          <div class="big-number" style="color:#111827">${cat.annual.toFixed(2)}</div>
          <div class="small">Annual</div>
        </div>
        <div style="width:1px;height:38px;background:#eee"></div>
        <div style="flex:1">
          <div class="big-number" style="color:#111827">${cat.monthly.toFixed(2)}</div>
          <div class="small">Monthly</div>
        </div>
      </div>
      <div class="cat-chart-hint small" style="margin-top:6px;color:#2563eb;font-size:13px">📈 Click to view historical chart</div>
      <div class="subitems" aria-hidden="true">
        <div class="small" style="font-weight:700;margin-bottom:6px;display:flex;justify-content:space-between">
          <div style="flex:1"></div>
          <div style="flex:1;display:flex;justify-content:center;gap:40px">
            <div style="text-align:center;cursor:pointer" class="sort-arrow" data-key="annual">Annual</div>
            <div style="text-align:center;cursor:pointer" class="sort-arrow" data-key="monthly">Monthly</div>
          </div>
        </div>
        <div class="subitem-rows-container">${renderSubItems(cat.subItems)}</div>
      </div>`;

    container.appendChild(el);

    if (!cat._sortOrder) cat._sortOrder = { annual:'default', monthly:'default' };

    // Sort arrows
    el.querySelectorAll('.sort-arrow').forEach(arrow => {
      const key = arrow.dataset.key;
      arrow.textContent = key.charAt(0).toUpperCase() + key.slice(1);
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cat._sortOrder[key] === 'default') cat._sortOrder[key] = 'asc';
        else if (cat._sortOrder[key] === 'asc') cat._sortOrder[key] = 'desc';
        else cat._sortOrder[key] = 'default';

        const state = cat._sortOrder[key];
        let newSubItems;
        if (state === 'default') {
          newSubItems = [...cat._originalSubItems];
        } else {
          const mult = state === 'asc' ? 1 : -1;
          const hasSub = cat._originalSubItems.some(s => /sub category/i.test(s.type));
          if (hasSub) {
            const grouped = {}; let curSub = null;
            cat._originalSubItems.forEach(s => {
              if (/sub category/i.test(s.type)) curSub = s.item;
              else if (curSub) { if(!grouped[curSub]) grouped[curSub]=[]; grouped[curSub].push(s); }
            });
            newSubItems = [];
            cat._originalSubItems.forEach(s => {
              if (/sub category/i.test(s.type)) { newSubItems.push(s); if(grouped[s.item]) newSubItems.push(...grouped[s.item].sort((a,b)=>(a[key]-b[key])*mult)); }
            });
          } else {
            newSubItems = [...cat._originalSubItems].sort((a,b)=>(a[key]-b[key])*mult);
          }
        }
        cat.subItems = newSubItems;
        el.querySelector('.subitem-rows-container').innerHTML = renderSubItems(cat.subItems);
        arrow.textContent = key.charAt(0).toUpperCase()+key.slice(1)+(state==='asc'?' ▲':state==='desc'?' ▼':'');
      });
    });

    // Click on card title area → open modal chart
    el.addEventListener('click', (e) => {
      if (e.target.closest('.sort-arrow') || e.target.closest('.subitems')) return;
      const histData = findCategoryHistory(cat.item, categoriesData);
      if (histData && histData.length) {
        openCategoryModal(cat.item, histData, CAT_COLORS[idx % CAT_COLORS.length]);
      } else {
        // Still toggle sub-items open
        const isOpen = el.classList.toggle('open');
        el.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
    });
  });

  // Touch/click toggle for subitems (fallback)
  container.addEventListener('click', (e) => {
    const card = e.target.closest('.category-card');
    if (!card) return;
    if (e.target.closest('.sort-arrow')) return;
  });
}

// ─────────────────────────────────────────────
// CATEGORY MODAL CHART  (Enhancement #3)
// ─────────────────────────────────────────────
function openCategoryModal(catName, histData, color) {
  // Remove existing modal
  const existing = document.getElementById('cat-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'cat-modal-overlay';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.45);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  overlay.innerHTML = `
    <div id="cat-modal" style="
      background:#fff;border-radius:14px;padding:24px;
      max-width:860px;width:100%;max-height:90vh;overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,0.2);position:relative;
    ">
      <button id="cat-modal-close" style="
        position:absolute;top:14px;right:14px;border:none;background:#f3f4f6;
        border-radius:8px;padding:6px 12px;cursor:pointer;font-size:16px;color:#374151;
      ">✕ Close</button>
      <h3 style="margin:0 0 4px;font-size:20px;color:#111827">Historical Annual Inflation</h3>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px">${catName}</p>
      <div style="position:relative;height:360px;width:100%">
        <canvas id="cat-modal-canvas"></canvas>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('cat-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const canvas = document.getElementById('cat-modal-canvas');
  const ctx = canvas.getContext('2d');

  if (window._catModalChart) { window._catModalChart.destroy(); window._catModalChart = null; }

  window._catModalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: histData.map(d => d.date),
      datasets: [{
        label: catName,
        data: histData.map(d => d.rate),
        borderColor: color || '#0070C0',
        backgroundColor: (color || '#0070C0') + '18',
        fill: true,
        tension: 0.25,
        pointRadius: 2,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid:{ display:false }, ticks:{ maxRotation:45, maxTicksLimit:18 } },
        y: { ticks:{ callback: v => (v*100).toFixed(1)+'%' } }
      },
      plugins: {
        legend: { display:false },
        tooltip: { callbacks:{ label: c => (c.raw*100).toFixed(1)+'%' } }
      }
    }
  });
}

// ─────────────────────────────────────────────
// HISTORICAL LINE CHARTS  (Enhancement #4 + #6)
// Quick-range buttons + bottom slider + EGP/USD overlay toggle
// ─────────────────────────────────────────────
function renderLineChart(data, canvasId, sectionId, exchangeRates) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const fullLabels = data.map(d => d.date);
  const fullRates  = data.map(d => d.rate);

  // Build aligned exchange rate array (same date order as fullLabels)
  // Exchange rate dates look like "Jan-26" vs historical "January, 2026" — we align by fuzzy match
  function alignExchangeRates(labels) {
    if (!exchangeRates || !exchangeRates.length) return null;
    return labels.map(lbl => {
      const m = extractMonthName(lbl);
      const yearMatch = lbl.match(/\d{4}/);
      const year = yearMatch ? yearMatch[0].slice(-2) : null;
      if (!m || !year) return null;
      const shortMonth = m.slice(0,3);
      const found = exchangeRates.find(e => {
        const ed = e.date || '';
        return ed.toLowerCase().startsWith(shortMonth.toLowerCase()) && ed.includes(year);
      });
      return found ? found.rate : null;
    });
  }

  let chart = null;
  let showFX = false;
  let currentN = Math.min(36, fullLabels.length);

  function draw(n) {
    currentN = n;
    const N = Math.min(n, fullLabels.length);
    const start = fullLabels.length - N;
    const labels  = fullLabels.slice(start);
    const rates   = fullRates.slice(start);
    const fxSlice = alignExchangeRates(labels);

    const datasets = [{
      label: canvasId === 'annualLineChart' ? 'Annual Inflation' : 'Monthly Inflation',
      data: rates,
      borderColor: '#0070C0',
      backgroundColor: 'rgba(0,112,192,0.07)',
      fill: true,
      tension: 0.2,
      pointRadius: 2,
      borderWidth: 2,
      yAxisID: 'yLeft'
    }];

    if (showFX && fxSlice) {
      datasets.push({
        label: 'EGP/USD',
        data: fxSlice,
        borderColor: '#e67e22',
        backgroundColor: 'rgba(230,126,34,0.06)',
        fill: false,
        tension: 0.2,
        pointRadius: 2,
        borderWidth: 2,
        yAxisID: 'yRight',
        spanGaps: true,
        borderDash: [4,3]
      });
    }

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      // Add/remove right axis dynamically
      if (showFX) {
        chart.options.scales.yRight = {
          type: 'linear', position: 'right',
          title: { display:true, text:'EGP/USD', color:'#e67e22', font:{ size:12 } },
          ticks: { color:'#e67e22', callback: v => v.toFixed(2) },
          grid: { drawOnChartArea: false }
        };
      } else {
        delete chart.options.scales.yRight;
      }
      chart.update();
      return;
    }

    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const scalesConfig = {
      x: { grid:{ display:false }, ticks:{ maxRotation:0, maxTicksLimit:12 } },
      yLeft: {
        type: 'linear', position: 'left',
        ticks: { callback: v => (v*100).toFixed(1)+'%' }
      }
    };
    if (showFX) {
      scalesConfig.yRight = {
        type: 'linear', position: 'right',
        title: { display:true, text:'EGP/USD', color:'#e67e22', font:{ size:12 } },
        ticks: { color:'#e67e22', callback: v => v.toFixed(2) },
        grid: { drawOnChartArea:false }
      };
    }

    chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode:'index', intersect:false },
        scales: scalesConfig,
        plugins: {
          legend: { display: showFX, position:'top', labels:{ font:{ size:12 } } },
          tooltip: {
            callbacks: {
              label: c => {
                if (c.dataset.yAxisID === 'yRight') return `EGP/USD: ${c.raw !== null ? c.raw.toFixed(2) : '—'}`;
                return `${c.dataset.label}: ${(c.raw*100).toFixed(1)}%`;
              }
            }
          }
        }
      }
    });
    requestAnimationFrame(() => chart.update());
  }

  // ── Quick range buttons ──
  const btnContainer = section.querySelector('.range-btns');
  const presets = [6, 12, 24];
  presets.forEach(m => {
    const btn = section.querySelector(`[data-months="${m}"]`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      section.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const slider = section.querySelector('.bottom-slider');
      if (slider) slider.value = m;
      updateLabel(m);
      draw(m);
    });
  });

  // ── Bottom slider ──
  const slider = section.querySelector('.bottom-slider');
  const label  = section.querySelector('.range-label');

  function updateLabel(m) {
    if (label) label.textContent = `Showing last ${Math.min(m, fullLabels.length)} months`;
  }

  if (slider) {
    slider.max = fullLabels.length;
    slider.value = currentN;
    slider.addEventListener('input', () => {
      const m = parseInt(slider.value);
      section.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      updateLabel(m);
      draw(m);
    });
  }

  // ── EGP/USD toggle ──
  const fxBtn = section.querySelector('.fx-toggle-btn');
  if (fxBtn) {
    fxBtn.addEventListener('click', () => {
      showFX = !showFX;
      fxBtn.classList.toggle('active', showFX);
      fxBtn.textContent = showFX ? '✕ Hide EGP/USD' : '$ Show EGP/USD';
      draw(currentN);
    });
  }

  // Initial render
  updateLabel(currentN);
  draw(currentN);
}

// ─────────────────────────────────────────────
// MAIN INIT
// ─────────────────────────────────────────────
(async function init() {
  const [annualText, monthlyText, categoriesText, fxText] = await Promise.all([
    fetchTextOrNull(FILES.annualHistory),
    fetchTextOrNull(FILES.monthlyHistory),
    fetchTextOrNull(FILES.categoriesHistory),
    fetchTextOrNull(FILES.exchangeRates)
  ]);

  const annualRows   = annualText     ? parseCSVString(annualText)     : [];
  const monthlyRows  = monthlyText    ? parseCSVString(monthlyText)    : [];
  const catRows      = categoriesText ? parseCSVString(categoriesText) : [];

  // Exchange rates use TSV
  const fxRows       = fxText ? parseTSV(fxText) : [];

  const annualData   = parseHistorical(annualRows.slice(1));
  const monthlyData  = parseHistorical(monthlyRows.slice(1));
  const categoriesData = parseCategoriesHistory(catRows);
  const exchangeRates  = parseExchangeRates(fxRows);

  let detailsText = await fetchTextOrNull(FILES.inflationDetails);
  if (!detailsText) { console.error('Inflation details CSV missing'); return; }

  const detailRows       = parseCSVString(detailsText);
  const inflationItems   = parseInflationDetails(detailRows);
  const mainCategories   = buildHierarchy(inflationItems);

  const latestAnnual  = annualData[annualData.length   - 1] || null;
  const latestMonthly = monthlyData[monthlyData.length - 1] || null;
  const prevAnnual    = annualData[annualData.length   - 2] || null;
  const prevMonthly   = monthlyData[monthlyData.length - 2] || null;

  createSummaryCards(null, prevAnnual, prevMonthly, latestAnnual, latestMonthly);
  renderCategoryCards(mainCategories, categoriesData);
  setupPieToggle(mainCategories);

  if (annualData.length)  renderLineChart(annualData,  'annualLineChart',  'annual-section',  exchangeRates);
  if (monthlyData.length) renderLineChart(monthlyData, 'monthlyLineChart', 'monthly-section', exchangeRates);
})();
