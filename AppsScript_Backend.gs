// v1.20.6: robust 2026 replenishment matching; unique item rows no longer depend on broad sublocation labels.
// Lightweight key used by the GitHub PWA. This is intentionally only a casual-access guard,
// not strong authentication, because the frontend is public and the key can be inspected there.
const WA_PWA_API_KEY = 'wa_7uK4nP9qR2mX8cV5sD1fH6jL3bT0yE';

/**
 * Serves the all-in-one mobile web app (Logger + Live Inventory Viewers with Grouped Bins).
 */
function doGet(e) {
  // API mode used by the GitHub-hosted PWA. Normal /exec requests still serve the original app.
  if (e && e.parameter && e.parameter.api === '1') {
    return handleApiGet_(e);
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Van Inventory Hub</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { -webkit-tap-highlight-color: transparent; }
    .autocomplete-items div:active { background-color: #e0e7ff; }

    .choice-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .choice-tile { --tile-bg:#f8fafc; --tile-border:#cbd5e1; --tile-text:#334155; --tile-active:#4f46e5; --tile-selected:#eef2ff; min-height:44px; padding:10px 12px; border:1px solid var(--tile-border); border-radius:12px; background:var(--tile-bg); color:var(--tile-text); font-size:12px; font-weight:600; text-align:center; cursor:pointer; }
    .choice-tile[aria-pressed="true"] { background:var(--tile-selected); border-color:var(--tile-active); box-shadow:0 0 0 2px var(--tile-active); font-weight:700; }
    .choice-tile:focus-visible, .inv-tab-btn:focus-visible { outline:3px solid var(--tile-active,#4f46e5); outline-offset:3px; }
    [data-van="2026"] { --tile-bg:#f0fdf4; --tile-border:#86efac; --tile-text:#166534; --tile-active:#15803d; --tile-selected:#dcfce7; }
    [data-van="2015"] { --tile-bg:#fefce8; --tile-border:#fde047; --tile-text:#854d0e; --tile-active:#a16207; --tile-selected:#fefce8; }
    [data-van="2021"] { --tile-bg:#fef2f2; --tile-border:#fca5a5; --tile-text:#991b1b; --tile-active:#b91c1c; --tile-selected:#fee2e2; }
    .inv-tab-btn[data-van], .van-reference { background:var(--tile-bg)!important; border:1px solid var(--tile-border)!important; color:var(--tile-text)!important; }
    .inv-tab-btn[data-van][aria-pressed="true"] { background:var(--tile-selected)!important; box-shadow:inset 0 0 0 2px var(--tile-active); }
    .van-reference { border-radius:6px; padding:2px 5px; }
    .van-storage-group { background:var(--tile-bg)!important; border-color:var(--tile-border)!important; }
    .van-storage-group > div:first-child { color:var(--tile-text)!important; }
    .van-storage-group > div:first-child > span:first-child { background:var(--tile-active)!important; }
    .van-bin-tile { background:var(--tile-bg)!important; border-color:var(--tile-border)!important; color:var(--tile-text)!important; }
    .van-bin-tile[aria-pressed="true"] { background:var(--tile-selected)!important; border-color:var(--tile-active)!important; box-shadow:0 0 0 1px var(--tile-active); }
    .van-bin-tile [data-bin-count] { background:var(--tile-selected)!important; color:var(--tile-text)!important; }
    .van-bin-tile[aria-pressed="true"] [data-bin-count] { background:var(--tile-active)!important; color:white!important; }
    #activeBinHeader[data-van] { background:var(--tile-selected)!important; border-color:var(--tile-border)!important; }
    #activeBinHeader[data-van] span, #activeBinHeader[data-van] button, #btnBinAll[data-van] { color:var(--tile-text)!important; }
  </style>
</head>
<body class="bg-slate-100 text-slate-900 min-h-screen flex flex-col font-sans pb-12">
  <!-- Mobile Header -->
  <header class="bg-indigo-600 text-white px-4 py-3 sticky top-0 z-30 shadow-md">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center space-x-2">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        <h1 class="font-bold text-base tracking-tight">Van Inventory Hub</h1>
      </div>
      <button onclick="refreshActiveView()" title="Refresh Data" class="p-1 rounded bg-indigo-700 hover:bg-indigo-800 text-indigo-100 text-xs flex items-center space-x-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
    <!-- Top-Level Mode Navigation -->
    <div class="grid grid-cols-2 gap-1.5 p-1 bg-indigo-800/60 rounded-xl text-xs font-semibold">
      <button 
        type="button" 
        id="modeBtnLog" 
        onclick="switchTopMode('log')" 
        class="py-2 rounded-lg text-center bg-white text-indigo-700 shadow-sm transition-all"
      >
        📝 Log Tool Movement
      </button>
      <button 
        type="button" 
        id="modeBtnInv" 
        onclick="switchTopMode('inventory')" 
        class="py-2 rounded-lg text-center text-indigo-100 hover:text-white transition-all"
      >
        📦 View Live Inventory
      </button>
    </div>
  </header>
  <!-- ========================================== -->
  <!-- 1. VIEW INVENTORY MODE                     -->
  <!-- ========================================== -->
  <div id="inventoryContainer" class="hidden max-w-md w-full mx-auto p-4 flex-1 space-y-3">
    <!-- Sub-Tabs for Inventory Locations -->
    <div class="flex overflow-x-auto gap-1.5 pb-1 text-xs font-semibold scrollbar-none">
      <button onclick="loadInventoryTab('2026')" id="invTab2026" class="inv-tab-btn shrink-0 px-3 py-2 rounded-xl bg-indigo-600 text-white shadow-xs">
        🚐 2026 Van
      </button>
      <button onclick="loadInventoryTab('2021')" id="invTab2021" class="inv-tab-btn shrink-0 px-3 py-2 rounded-xl bg-white text-slate-700 border border-slate-200">
        🚐 2021 Van
      </button>
      <button onclick="loadInventoryTab('2015')" id="invTab2015" class="inv-tab-btn shrink-0 px-3 py-2 rounded-xl bg-white text-slate-700 border border-slate-200">
        🚐 2015 Van
      </button>
      <button onclick="loadInventoryTab('class')" id="invTabClass" class="inv-tab-btn shrink-0 px-3 py-2 rounded-xl bg-white text-slate-700 border border-slate-200">
        🛠️ Class Stock
      </button>
      <button onclick="loadInventoryTab('summary')" id="invTabSummary" class="inv-tab-btn shrink-0 px-3 py-2 rounded-xl bg-white text-slate-700 border border-slate-200">
        📊 Tool Summary
      </button>
    </div>
    <!-- Whole-van discrepancies, independent of bin/search filters -->
    <section id="baselineAlerts" class="hidden rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 space-y-3" aria-label="Items outside baseline quantities" aria-live="polite">
      <div>
        <h2 id="baselineAlertsTitle" class="text-base font-extrabold text-amber-950">⚠️ Inventory needs attention</h2>
        <p id="baselineAlertsSummary" class="text-xs font-semibold text-amber-900 mt-1"></p>
      </div>
      <div id="baselineAlertsList" class="space-y-2"></div>
    </section>
    <!-- Inventory Filter & Search Bar -->
    <div class="relative">
      <input 
        type="text" 
        id="invSearch" 
        placeholder="Filter tools or notes..." 
        oninput="renderFilteredInventory()"
        class="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none shadow-2xs"
      />
      <button type="button" onclick="clearInvSearch()" id="clearInvSearchBtn" class="hidden absolute right-3 top-2.5 text-slate-400 font-bold text-xs">✕</button>
    </div>
    <!-- Storage Area & Bin Tiles Section (Visible on Van Tabs) -->
    <div id="binTilesSection" class="hidden space-y-3">
      <div class="flex items-center justify-between text-xs pt-1">
        <span class="font-bold text-slate-700 uppercase tracking-wider text-[11px]">Storage Areas & Bins</span>
        <button onclick="selectBinFilter('ALL')" id="btnBinAll" class="text-indigo-600 font-bold text-xs hover:underline">
          View All Bins
        </button>
      </div>
      <!-- Container for Storage Area Groups -->
      <div id="binTilesGroups" class="space-y-3"></div>
    </div>
    <!-- Active Bin Indicator -->
    <div id="activeBinHeader" class="hidden flex items-center justify-between bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg text-xs">
      <span class="font-bold text-indigo-900 truncate" id="activeBinLabel">Filtered by Bin</span>
      <button onclick="selectBinFilter('ALL')" class="text-indigo-600 font-bold hover:underline shrink-0 ml-2">Clear Filter ✕</button>
    </div>
    <!-- Loading Indicator -->
    <div id="invLoading" class="p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-2">
      <svg class="animate-spin h-6 w-6 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>Loading live inventory...</span>
    </div>
    <!-- Inventory Item Cards Container -->
    <div id="invCardsList" class="space-y-2"></div>
  </div>
  <!-- ========================================== -->
  <!-- 2. LOG TOOL MOVEMENT MODE                  -->
  <!-- ========================================== -->
  <main id="logContainer" class="max-w-md w-full mx-auto p-4 flex-1">
    <!-- Success Banner -->
    <div id="successBox" class="hidden mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 shadow-sm">
      <div class="flex items-center space-x-2">
        <svg class="w-5 h-5 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
        </svg>
        <span class="font-semibold text-sm" id="successMsg">Logged successfully!</span>
      </div>
      <button onclick="resetForm()" class="mt-2 text-xs font-semibold text-emerald-700 underline">Log another item</button>
    </div>
    <!-- Main Entry Form -->
    <form id="logForm" onsubmit="handleFormSubmit(event)" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-4">
      <!-- Employee Selection (Tiles) -->
<div>
  <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Employee</label>
  <!-- Hidden input keeps your form working with handleFormSubmit -->
  <input type="hidden" id="employee" value="Kyle Meyer">
  <div id="employeeTileGrid" class="grid grid-cols-2 sm:grid-cols-3 gap-2">
    <button type="button" onclick="selectEmployeeTile(this, 'Kyle Meyer')" 
            class="employee-tile py-2.5 px-3 rounded-xl border text-sm font-semibold text-center transition-all bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500">
      Kyle Meyer
    </button>
    <button type="button" onclick="selectEmployeeTile(this, 'Matt Pursley')" 
            class="employee-tile py-2.5 px-3 rounded-xl border text-sm font-semibold text-center transition-all bg-slate-50 border-slate-300 text-slate-700 hover:bg-white hover:border-slate-400">
      Matt Pursley
    </button>
    <button type="button" onclick="selectEmployeeTile(this, 'Peter Bissell')" 
            class="employee-tile py-2.5 px-3 rounded-xl border text-sm font-semibold text-center transition-all bg-slate-50 border-slate-300 text-slate-700 hover:bg-white hover:border-slate-400">
      Peter Bissell
    </button>
    <button type="button" onclick="selectEmployeeTile(this, 'Ryan Bonner')" 
            class="employee-tile py-2.5 px-3 rounded-xl border text-sm font-semibold text-center transition-all bg-slate-50 border-slate-300 text-slate-700 hover:bg-white hover:border-slate-400">
      Ryan Bonner
    </button>
    <button type="button" onclick="selectEmployeeTile(this, 'Nick Hutter')" 
            class="employee-tile py-2.5 px-3 rounded-xl border text-sm font-semibold text-center transition-all bg-slate-50 border-slate-300 text-slate-700 hover:bg-white hover:border-slate-400">
      Nick Hutter
    </button>
    <button type="button" onclick="selectEmployeeTile(this, 'Taylor Weber')"
            class="employee-tile choice-tile" aria-pressed="false">
      Taylor Weber
    </button>
  </div>
</div>
      <!-- Searchable Item Picker (Autocomplete) -->
      <div class="relative">
        <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
          Item <span class="text-indigo-600 font-normal">(Type to search)</span>
        </label>
        <div class="relative">
          <input 
            type="text" 
            id="itemSearch" 
            placeholder="e.g. 7/16 Bit, C Clamp, Shinto..." 
            autocomplete="off"
            required
            oninput="onSearchInput(this.value)"
            class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-3 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none"
          />
          <button type="button" onclick="clearItemSearch()" id="clearBtn" class="hidden absolute right-3 top-3 text-slate-400 font-bold">✕</button>
        </div>
        <div id="autocompleteList" class="autocomplete-items hidden absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto z-50 divide-y divide-slate-100"></div>
      </div>
      <!-- ACTION TABS (Exact Original Names) -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Action / Event</label>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <button type="button" onclick="selectActionTab('Restocked from tool room')" id="tabRestock" class="action-tab p-3 rounded-xl border-2 border-indigo-600 bg-indigo-50 text-indigo-700 flex flex-col justify-between shadow-xs font-bold text-left min-h-[66px]">
            <span class="text-sm">📦</span>
            <span class="leading-tight mt-1">Restocked from tool room</span>
          </button>
          <button type="button" onclick="selectActionTab('Broke, Needs replacement')" id="tabBroke" class="action-tab p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex flex-col justify-between hover:bg-slate-100 font-semibold text-left min-h-[66px]">
            <span class="text-sm">⚠️</span>
            <span class="leading-tight mt-1">Broke, Needs replacement</span>
          </button>
          <button type="button" onclick="selectActionTab('Missing, Needs replacement')" id="tabMissing" class="action-tab p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex flex-col justify-between hover:bg-slate-100 font-semibold text-left min-h-[66px]">
            <span class="text-sm">❓</span>
            <span class="leading-tight mt-1">Missing, Needs replacement</span>
          </button>
          <button type="button" onclick="selectActionTab('Repaired')" id="tabRepaired" class="action-tab p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex flex-col justify-between hover:bg-slate-100 font-semibold text-left min-h-[66px]">
            <span class="text-sm">🔧</span>
            <span class="leading-tight mt-1">Repaired</span>
          </button>
          <button type="button" onclick="selectActionTab('Moved/Transferred Stock')" id="tabTransfer" class="action-tab p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex flex-col justify-between hover:bg-slate-100 font-semibold text-left min-h-[66px]">
            <span class="text-sm">🔄</span>
            <span class="leading-tight mt-1">Moved/Transferred Stock</span>
          </button>
          <button type="button" onclick="selectActionTab('Other Event (Found, Disposed, Purchased, Sold)')" id="tabOther" class="action-tab p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex flex-col justify-between hover:bg-slate-100 font-semibold text-left min-h-[66px]">
            <span class="text-sm">📋</span>
            <span class="leading-tight mt-1">Other Event (Found, Disposed, Purchased, Sold)</span>
          </button>
        </div>
      </div>
      <!-- Quantity Stepper -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Quantity</label>
        <div class="flex items-center space-x-3">
          <button type="button" onclick="adjustQty(-1)" class="w-12 h-11 bg-slate-200 active:bg-slate-300 rounded-xl font-bold text-lg text-slate-700 flex items-center justify-center">−</button>
          <input type="number" id="quantity" min="1" value="1" required class="flex-1 text-center font-bold text-lg bg-slate-50 border border-slate-300 rounded-xl py-2 focus:ring-2 focus:ring-indigo-500 outline-none">
          <button type="button" onclick="adjustQty(1)" class="w-12 h-11 bg-slate-200 active:bg-slate-300 rounded-xl font-bold text-lg text-slate-700 flex items-center justify-center">+</button>
        </div>
      </div>
      <!-- Sub-Fields: Restocked -->
      <div id="secRestock" class="tab-content space-y-3 pt-1">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Which van was restocked?</label>
          <select id="whichVanRestocked" onchange="onRestockVanChange(this.value)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="2015 Van">2015 Van</option>
            <option value="2021 Van">2021 Van</option>
            <option value="2026 Van">2026 Van</option>
          </select>
        </div>
        <div id="sec2026Storage" class="hidden">
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">2026 Van storage area</label>
          <select id="storageArea2026" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="Floor Level Bins">Floor Level Bins</option>
            <option value="2nd Level Bins">2nd Level Bins</option>
            <option value="Materials Bin">Materials Bin</option>
            <option value="Back of Van">Back of Van</option>
          </select>
        </div>
      </div>
      <!-- Sub-Fields: Broke or Missing -->
      <div id="secBrokeMissing" class="tab-content hidden space-y-3 pt-1">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Which Van or Location had the tool?</label>
          <select id="vanOrLocationBroke" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="2015 Van">2015 Van</option>
            <option value="2021 Van">2021 Van</option>
            <option value="2026 Van Floor">2026 Van Floor Level</option>
            <option value="2026 2nd Level">2026 Van 2nd Level</option>
            <option value="2026 Van Other">2026 Van Other</option>
            <option value="Class Stock">Class Stock</option>
          </select>
        </div>
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
          <label class="block text-xs font-bold text-slate-700">Did you replace them?</label>
          <select id="didYouReplace" onchange="onReplaceChange(this.value)" class="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="Yes, from class stock">Yes, from class stock</option>
            <option value="Yes, from repaired bin">Yes, from repaired bin</option>
            <option value="Yes, split locations/partially replaced">Yes, split locations/partially replaced</option>
            <option value="No replacement available">No replacement available</option>
          </select>
          <!-- Split quantities -->
          <div id="secSplitQuantities" class="hidden pt-1 space-y-3">
            <div>
              <label class="block text-[11px] font-medium text-slate-500 mb-1">Qty from Repaired bin</label>
              <div class="flex items-center space-x-3">
                <button type="button" onclick="adjustSplitQty('qtyRepairedBin', -1)" aria-label="Decrease repaired bin quantity" class="w-12 h-11 shrink-0 bg-slate-200 active:bg-slate-300 rounded-xl font-bold text-lg text-slate-700 flex items-center justify-center">−</button>
                <input type="number" id="qtyRepairedBin" min="0" value="0" aria-label="Repaired bin quantity" class="min-w-0 flex-1 text-center font-bold text-lg bg-white border border-slate-300 rounded-xl py-2 focus:ring-2 focus:ring-indigo-500 outline-none">
                <button type="button" onclick="adjustSplitQty('qtyRepairedBin', 1)" aria-label="Increase repaired bin quantity" class="w-12 h-11 shrink-0 bg-slate-200 active:bg-slate-300 rounded-xl font-bold text-lg text-slate-700 flex items-center justify-center">+</button>
              </div>
            </div>
            <div>
              <label class="block text-[11px] font-medium text-slate-500 mb-1">Qty from Class Stock</label>
              <div class="flex items-center space-x-3">
                <button type="button" onclick="adjustSplitQty('qtyClassStock', -1)" aria-label="Decrease class stock quantity" class="w-12 h-11 shrink-0 bg-slate-200 active:bg-slate-300 rounded-xl font-bold text-lg text-slate-700 flex items-center justify-center">−</button>
                <input type="number" id="qtyClassStock" min="0" value="0" aria-label="Class stock quantity" class="min-w-0 flex-1 text-center font-bold text-lg bg-white border border-slate-300 rounded-xl py-2 focus:ring-2 focus:ring-indigo-500 outline-none">
                <button type="button" onclick="adjustSplitQty('qtyClassStock', 1)" aria-label="Increase class stock quantity" class="w-12 h-11 shrink-0 bg-slate-200 active:bg-slate-300 rounded-xl font-bold text-lg text-slate-700 flex items-center justify-center">+</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- Sub-Fields: Repaired -->
      <div id="secRepaired" class="tab-content hidden space-y-3 pt-1">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Moved to</label>
          <select id="repairedMovedTo" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="Repaired Bin">Repaired Bin</option>
            <option value="2015 Van">2015 Van</option>
            <option value="2021 Van">2021 Van</option>
            <option value="2026 Van Floor Level">2026 Van Floor Level</option>
            <option value="2026 Van 2nd Level">2026 Van 2nd Level</option>
            <option value="2026 Van Other">2026 Van Other</option>
            <option value="Class Stock">Class Stock</option>
          </select>
        </div>
      </div>
      <!-- Sub-Fields: Moved / Transferred -->
      <div id="secTransfer" class="tab-content hidden space-y-3 pt-1">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Moved From</label>
          <select id="transferMovedFrom" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="Class Stock">Class Stock</option>
            <option value="2015 Van">2015 Van</option>
            <option value="2021 Van">2021 Van</option>
            <option value="2026 Van Floor Level">2026 Van Floor Level</option>
            <option value="2026 Van 2nd Level">2026 Van 2nd Level</option>
            <option value="2026 Van Other">2026 Van Other</option>
            <option value="Broken Bin">Broken Bin</option>
            <option value="Repaired Bin">Repaired Bin</option>
            <option value="Missing">Missing</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Moved To</label>
          <select id="transferMovedTo" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="Class Stock">Class Stock</option>
            <option value="2015 Van">2015 Van</option>
            <option value="2021 Van">2021 Van</option>
            <option value="2026 Van Floor Level">2026 Van Floor Level</option>
            <option value="2026 Van 2nd Level">2026 Van 2nd Level</option>
            <option value="2026 Van Other">2026 Van Other</option>
            <option value="Broken Bin">Broken Bin</option>
            <option value="Repaired Bin">Repaired Bin</option>
            <option value="Missing">Missing</option>
          </select>
        </div>
      </div>
      <!-- Sub-Fields: Other Event -->
      <div id="secOther" class="tab-content hidden space-y-3 pt-1">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Event</label>
          <select id="otherEventSub" onchange="onOtherEventChange(this.value)" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="Found">Found</option>
            <option value="Disposed of">Disposed of</option>
            <option value="Added/Purchased">Added/Purchased</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Moved from</label>
          <select id="otherMovedFrom" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">Purchased</option>
            <option value="Class Stock">Class Stock</option>
            <option value="2015 Van">2015 Van</option>
            <option value="2021 Van">2021 Van</option>
            <option value="2026 Van Floor">2026 Van Floor Level</option>
            <option value="2026 2nd Level">2026 Van 2nd Level</option>
            <option value="2026 Van Other">2026 Van Other</option>
            <option value="Broken Bin">Broken Bin</option>
            <option value="Repaired Bin">Repaired Bin</option>
            <option value="E-commerce Stock">E-commerce Stock</option>
            <option value="Missing">Missing</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Moved to</label>
          <select id="otherMovedTo" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">Disposed</option>
            <option value="Class Stock">Class Stock</option>
            <option value="2015 Van">2015 Van</option>
            <option value="2021 Van">2021 Van</option>
            <option value="2026 Van Floor Level">2026 Van Floor Level</option>
            <option value="2026 Van 2nd Level">2026 Van 2nd Level</option>
            <option value="2026 Van Other">2026 Van Other</option>
            <option value="Broken Bin">Broken Bin</option>
            <option value="Repaired Bin">Repaired Bin</option>
            <option value="E-commerce Stock">E-commerce Stock</option>
            <option value="Tool Room">Tool Room</option>
          </select>
        </div>
      </div>
      <!-- Notes Field -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Notes (Optional)</label>
        <input type="text" id="notes" placeholder="Optional notes or details..." class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
      </div>
      <!-- Submit Button -->
      <button 
        type="submit" 
        id="submitBtn" 
        class="w-full mt-2 py-3.5 px-4 bg-indigo-600 active:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center space-x-2"
      >
        <span>Submit Log Entry</span>
      </button>
    </form>
  </main>
  <script>
    let allItems = [];
    let currentAction = 'Restocked from tool room';
    let currentTopMode = 'log'; // 'log' | 'inventory'
    let currentInvTab = '2026'; // '2026' | '2021' | '2015' | 'class' | 'summary'
    let currentSelectedBin = 'ALL';
    let invCache = {};

    // Tile controls retain the original selects as hidden value stores.
    function vanKey(value) {
      const match = String(value).match(/2015|2021|2026/);
      return match ? match[0] : '';
    }
    function selectEmployeeTile(button, employeeName) {
      document.getElementById('employee').value = employeeName;
      document.querySelectorAll('.employee-tile').forEach(function(tile) {
        const selected = tile === button;
        tile.className = 'employee-tile choice-tile';
        tile.setAttribute('aria-pressed', String(selected));
      });
    }
    function syncChoiceTiles(select) {
      const grid = document.getElementById(select.id + 'TileGrid');
      if (!grid) return;
      Array.from(grid.children).forEach(function(button, index) {
        button.disabled = select.disabled || select.options[index].disabled;
        button.setAttribute('aria-pressed', String(index === select.selectedIndex));
      });
    }
    function filterLocationTiles(select, allowed) {
      const grid = document.getElementById(select.id + 'TileGrid');
      Array.from(select.options).forEach(function(option, index) {
        const visible = allowed(option.value);
        option.disabled = !visible;
        const button = grid.children[index];
        button.hidden = !visible;
        button.style.display = visible ? '' : 'none';
      });
      if (select.selectedIndex < 0 || select.options[select.selectedIndex].disabled) {
        const firstAvailable = Array.from(select.options).find(function(option) { return !option.disabled; });
        if (firstAvailable) select.value = firstAvailable.value;
      }
    }
    function onOtherEventChange(eventName) {
      const from = document.getElementById('otherMovedFrom');
      const to = document.getElementById('otherMovedTo');
      const regularLocation = function(value) {
        return Boolean(vanKey(value)) || ['Broken Bin', 'Repaired Bin', 'Class Stock'].includes(value);
      };
      if (eventName === 'Found') {
        filterLocationTiles(from, function(value) { return value === 'Missing'; });
        filterLocationTiles(to, regularLocation);
        from.value = 'Missing';
      } else if (eventName === 'Disposed of') {
        filterLocationTiles(from, regularLocation);
        filterLocationTiles(to, function(value) { return value === ''; });
        to.value = '';
      } else if (eventName === 'Added/Purchased') {
        filterLocationTiles(from, function(value) { return value === ''; });
        filterLocationTiles(to, function(value) {
          return Boolean(vanKey(value)) || ['Tool Room', 'Class Stock', 'E-commerce Stock'].includes(value);
        });
        from.value = '';
        to.value = 'Tool Room';
      }
      // Hide the fixed, automatically selected source/destination controls.
      from.parentElement.hidden = eventName === 'Found' || eventName === 'Added/Purchased';
      from.parentElement.style.display = from.parentElement.hidden ? 'none' : '';
      to.parentElement.hidden = eventName === 'Disposed of';
      to.parentElement.style.display = to.parentElement.hidden ? 'none' : '';
      syncChoiceTiles(from);
      syncChoiceTiles(to);
    }
    function initializeChoiceTiles() {
      document.querySelectorAll('#logForm select').forEach(function(select) {
        const grid = document.createElement('div');
        grid.id = select.id + 'TileGrid';
        grid.className = 'choice-grid';
        grid.setAttribute('role', 'group');
        const label = select.parentElement.querySelector('label');
        if (label) grid.setAttribute('aria-label', label.textContent.trim());
        Array.from(select.options).forEach(function(option, index) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'choice-tile';
          button.textContent = option.textContent;
          const van = vanKey(option.value) || (select.id === 'storageArea2026' ? '2026' : '');
          if (van) button.dataset.van = van;
          button.addEventListener('click', function() {
            select.selectedIndex = index;
            select.dispatchEvent(new Event('change', { bubbles:true }));
            syncChoiceTiles(select);
          });
          grid.appendChild(button);
        });
        select.hidden = true;
        select.style.display = 'none';
        select.insertAdjacentElement('afterend', grid);
        select.addEventListener('change', function() { syncChoiceTiles(select); });
        syncChoiceTiles(select);
      });
      const employee = document.getElementById('employee').value;
      document.querySelectorAll('.employee-tile').forEach(function(button) {
        button.className = 'employee-tile choice-tile';
        button.setAttribute('aria-pressed', String(button.textContent.trim() === employee));
      });
      ['2015','2021','2026'].forEach(function(year) {
        const tab = document.getElementById('invTab' + year);
        tab.dataset.van = year;
        tab.setAttribute('aria-pressed', String(year === currentInvTab));
      });
      document.querySelectorAll('#logForm label').forEach(function(label) {
        const year = vanKey(label.textContent);
        if (year) { label.dataset.van = year; label.classList.add('van-reference'); }
      });
    }
    initializeChoiceTiles();
    onOtherEventChange(document.getElementById('otherEventSub').value);

    window.onload = function() {
      google.script.run
        .withSuccessHandler(function(items) { allItems = items; })
        .getToolItems();
    };
    // MODE SWITCHER (LOG vs INVENTORY)
    function switchTopMode(mode) {
      currentTopMode = mode;
      const logCont = document.getElementById('logContainer');
      const invCont = document.getElementById('inventoryContainer');
      const btnLog = document.getElementById('modeBtnLog');
      const btnInv = document.getElementById('modeBtnInv');
      if (mode === 'log') {
        logCont.classList.remove('hidden');
        invCont.classList.add('hidden');
        btnLog.className = 'py-2 rounded-lg text-center bg-white text-indigo-700 shadow-sm transition-all';
        btnInv.className = 'py-2 rounded-lg text-center text-indigo-100 hover:text-white transition-all';
      } else {
        logCont.classList.add('hidden');
        invCont.classList.remove('hidden');
        btnInv.className = 'py-2 rounded-lg text-center bg-white text-indigo-700 shadow-sm transition-all';
        btnLog.className = 'py-2 rounded-lg text-center text-indigo-100 hover:text-white transition-all';
        loadInventoryTab(currentInvTab);
      }
    }
    // INVENTORY TABS
    function loadInventoryTab(tabKey) {
      currentInvTab = tabKey;
      currentSelectedBin = 'ALL';
      document.querySelectorAll('.inv-tab-btn').forEach(btn => {
        btn.className = 'inv-tab-btn shrink-0 px-3 py-2 rounded-xl bg-white text-slate-700 border border-slate-200';
        btn.setAttribute('aria-pressed', 'false');
      });
      const activeBtn = document.getElementById('invTab' + (tabKey.charAt(0).toUpperCase() + tabKey.slice(1)));
      if (activeBtn) {
        activeBtn.setAttribute('aria-pressed', 'true');
        activeBtn.className = 'inv-tab-btn shrink-0 px-3 py-2 rounded-xl bg-indigo-600 text-white shadow-xs font-bold';
      }
      if (invCache[tabKey]) {
        renderBinTiles();
        renderFilteredInventory();
      } else {
        fetchInventoryFromSheet(tabKey);
      }
    }
    function refreshActiveView() {
      if (currentTopMode === 'inventory') {
        delete invCache[currentInvTab];
        fetchInventoryFromSheet(currentInvTab);
      } else {
        google.script.run
          .withSuccessHandler(function(items) { allItems = items; })
          .getToolItems();
      }
    }
    function fetchInventoryFromSheet(tabKey) {
      const loader = document.getElementById('invLoading');
      const list = document.getElementById('invCardsList');
      const binSec = document.getElementById('binTilesSection');
      document.getElementById('baselineAlerts').classList.add('hidden');
      loader.classList.remove('hidden');
      list.innerHTML = '';
      binSec.classList.add('hidden');
      google.script.run
        .withSuccessHandler(function(res) {
          loader.classList.add('hidden');
          invCache[tabKey] = res;
          renderBinTiles();
          renderFilteredInventory();
        })
        .withFailureHandler(function(err) {
          loader.classList.add('hidden');
          list.innerHTML = '<div class="p-4 bg-red-50 text-red-600 text-xs rounded-xl text-center">Failed to load: ' + err.message + '</div>';
        })
        .getInventoryData(tabKey);
    }
    function selectBinFilter(binName) {
      currentSelectedBin = (currentSelectedBin === binName && binName !== 'ALL') ? 'ALL' : binName;
      renderBinTiles();
      renderFilteredInventory();
    }
    // RENDER BIN TILES GROUPED BY STORAGE AREA (IN SHEET ROW ORDER)
    function renderBinTiles() {
      const binSec = document.getElementById('binTilesSection');
      const groupsContainer = document.getElementById('binTilesGroups');
      const activeHeader = document.getElementById('activeBinHeader');
      const activeLabel = document.getElementById('activeBinLabel');
      const isVanTab = (currentInvTab === '2026' || currentInvTab === '2021' || currentInvTab === '2015');
      if (!isVanTab) {
        binSec.classList.add('hidden');
        activeHeader.classList.add('hidden');
        return;
      }
      const data = invCache[currentInvTab] || [];
      if (data.length === 0) {
        binSec.classList.add('hidden');
        activeHeader.classList.add('hidden');
        return;
      }
      // Group bins by Storage Area preserving original sequential encounter order
      const areasOrdered = [];
      const areasMap = {};
      data.forEach(item => {
        const areaName = (item.area || 'General Storage').trim();
        const binName = (item.bin || 'General Bin').trim();
        if (!areasMap[areaName]) {
          areasMap[areaName] = {
            area: areaName,
            binsOrdered: [],
            binsMap: {}
          };
          areasOrdered.push(areasMap[areaName]);
        }
        const aObj = areasMap[areaName];
        if (!aObj.binsMap[binName]) {
          const bObj = { bin: binName, count: 0 };
          aObj.binsMap[binName] = bObj;
          aObj.binsOrdered.push(bObj);
        }
        aObj.binsMap[binName].count++;
      });
      activeHeader.dataset.van = currentInvTab;
      document.getElementById('btnBinAll').dataset.van = currentInvTab;
      groupsContainer.innerHTML = '';
      areasOrdered.forEach(areaObj => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'space-y-1.5 bg-slate-50/70 p-2.5 rounded-2xl border border-slate-200/80';
        groupDiv.classList.add('van-storage-group');
        groupDiv.dataset.van = currentInvTab;
        // Area Section Header
        const header = document.createElement('div');
        header.className = 'flex items-center space-x-1.5 px-0.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider';
        header.innerHTML = \`
          <span class="w-2 h-2 rounded-full bg-indigo-500"></span>
          <span>\${escapeLocationHtml(formatLocation(areaObj.area, ''))}</span>
        \`;
        groupDiv.appendChild(header);
        // Bins Grid for this Area
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-2 gap-1.5';
        areaObj.binsOrdered.forEach(bInfo => {
          const isSelected = (currentSelectedBin === bInfo.bin);
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.onclick = function() { selectBinFilter(bInfo.bin); };
          tile.className = isSelected
            ? 'p-2.5 rounded-xl border-2 border-indigo-600 bg-indigo-50 text-indigo-900 font-bold shadow-xs text-left transition-all flex flex-col justify-between'
            : 'p-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 hover:border-indigo-300 shadow-2xs text-left transition-all flex flex-col justify-between';
          tile.classList.add('van-bin-tile');
          tile.dataset.van = currentInvTab;
          tile.setAttribute('aria-pressed', String(isSelected));
          tile.innerHTML = \`
            <div class="flex items-start justify-between w-full">
              <span class="text-xs font-bold leading-tight line-clamp-2">\${bInfo.bin}</span>
              <span data-bin-count class="\${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'} text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 shrink-0">
                \${bInfo.count}
              </span>
            </div>
          \`;
          grid.appendChild(tile);
        });
        groupDiv.appendChild(grid);
        groupsContainer.appendChild(groupDiv);
      });
      binSec.classList.remove('hidden');
      if (currentSelectedBin !== 'ALL') {
        activeLabel.textContent = 'Bin: ' + currentSelectedBin;
        activeHeader.classList.remove('hidden');
      } else {
        activeHeader.classList.add('hidden');
      }
    }
    function clearInvSearch() {
      document.getElementById('invSearch').value = '';
      document.getElementById('clearInvSearchBtn').classList.add('hidden');
      renderFilteredInventory();
    }
    // Present named bins before physical storage positions; retain original sheet values.
    function locationDisplayParts(area, bin) {
      const areaText = String(area || '').trim();
      const binText = String(bin || '').trim();
      const separator = areaText.indexOf(' - ');
      if (separator >= 0) {
        return [areaText.slice(separator + 3), binText, areaText.slice(0, separator)].filter(Boolean);
      }
      return [binText, areaText].filter(Boolean);
    }
    function formatLocation(area, bin) {
      return locationDisplayParts(area, bin).join(' • ');
    }
    function escapeLocationHtml(text) {
      const span = document.createElement('span');
      span.textContent = text;
      return span.innerHTML;
    }
    function getBaselineDiscrepancies(data) {
      return data.map(function(item) {
        const current = Number(item.quantity);
        const baseline = Number(item.baseline);
        return { item: item, current: current, baseline: baseline, difference: current - baseline };
      }).filter(function(entry) {
        return Number.isFinite(entry.current) && Number.isFinite(entry.baseline) && entry.difference !== 0;
      }).sort(function(a, b) {
        return (a.difference < 0 ? 0 : 1) - (b.difference < 0 ? 0 : 1);
      });
    }
    function renderBaselineAlerts() {
      const section = document.getElementById('baselineAlerts');
      const list = document.getElementById('baselineAlertsList');
      list.replaceChildren();
      if (!['2015', '2021', '2026'].includes(currentInvTab) || !invCache[currentInvTab]) {
        section.classList.add('hidden');
        return;
      }
      const entries = getBaselineDiscrepancies(invCache[currentInvTab]);
      if (!entries.length) {
        section.classList.add('hidden');
        return;
      }
      const shortages = entries.filter(function(entry) { return entry.difference < 0; });
      const needed = shortages.reduce(function(total, entry) { return total - entry.difference; }, 0);
      const excess = entries.length - shortages.length;
      document.getElementById('baselineAlertsTitle').textContent = '⚠️ ' + currentInvTab + ' Van — Inventory needs attention';
      document.getElementById('baselineAlertsSummary').textContent = shortages.length + ' shortage entries · ' + needed + ' units needed' + (excess ? ' · ' + excess + ' above-baseline entries' : '');
      entries.forEach(function(entry) {
        const card = document.createElement('div');
        card.className = 'rounded-xl border border-amber-200 bg-white p-3 space-y-2';
        const title = document.createElement('h3');
        title.className = 'text-xl font-extrabold leading-tight text-slate-900';
        title.textContent = entry.item.item;
        card.appendChild(title);
        const location = document.createElement('p');
        location.className = 'text-xs font-semibold text-slate-600';
        location.textContent = formatLocation(entry.item.area, entry.item.bin) || 'Location unspecified';
        card.appendChild(location);
        const quantities = document.createElement('div');
        quantities.className = 'grid grid-cols-2 gap-2';
        [['Current', entry.current], ['Baseline', entry.baseline]].forEach(function(pair) {
          const box = document.createElement('div');
          box.className = 'rounded-lg bg-slate-50 border border-slate-200 p-2';
          const label = document.createElement('span');
          label.className = 'block text-xs font-semibold text-slate-500';
          label.textContent = pair[0];
          const value = document.createElement('strong');
          value.className = 'block text-xl text-slate-900';
          value.textContent = pair[1];
          box.append(label, value);
          quantities.appendChild(box);
        });
        card.appendChild(quantities);
        const status = document.createElement('p');
        status.className = 'text-sm font-extrabold ' + (entry.difference < 0 ? 'text-red-700' : 'text-amber-800');
        status.textContent = entry.difference < 0 ? 'Replace / restock: ' + (-entry.difference) + ' needed' : entry.difference + ' above baseline';
        card.appendChild(status);
        const note = document.createElement('p');
        note.className = 'text-xs text-slate-700 whitespace-pre-wrap break-words';
        note.textContent = 'Notes: ' + (String(entry.item.notes || '').trim() || 'None');
        card.appendChild(note);
        list.appendChild(card);
      });
      section.classList.remove('hidden');
    }
    function renderFilteredInventory() {
      renderBaselineAlerts();
      const searchInput = document.getElementById('invSearch');
      const clearBtn = document.getElementById('clearInvSearchBtn');
      const query = (searchInput.value || '').toLowerCase().trim();
      const list = document.getElementById('invCardsList');
      const data = invCache[currentInvTab] || [];
      if (query.length > 0) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
      list.innerHTML = '';
      if (data.length === 0) {
        list.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs">No items found in this sheet.</div>';
        return;
      }
      const filtered = data.filter(row => {
        if (currentSelectedBin !== 'ALL' && row.bin !== currentSelectedBin) {
          return false;
        }
        if (query) {
          const text = Object.values(row).join(' ').toLowerCase();
          return text.includes(query);
        }
        return true;
      });
      if (filtered.length === 0) {
        list.innerHTML = '<div class="p-8 text-center text-slate-400 text-xs">No matching tools found in this bin.</div>';
        return;
      }
      filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-1';
        if (currentInvTab === 'summary') {
          card.innerHTML = \`
            <div class="flex items-start justify-between">
              <h3 class="text-xs font-bold text-slate-900">\${item.item}</h3>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Class Stock: \${item.classStock ?? 0}</span>
            </div>
            <div class="grid grid-cols-3 gap-1 pt-1.5 text-[11px] text-slate-600 text-center">
              <div class="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                <span data-van="2015" class="van-reference text-[10px] block font-medium">2015 Van</span>
                <span class="font-bold text-slate-800">\${item.van2015 ?? 0}</span>
              </div>
              <div class="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                <span data-van="2021" class="van-reference text-[10px] block font-medium">2021 Van</span>
                <span class="font-bold text-slate-800">\${item.van2021 ?? 0}</span>
              </div>
              <div class="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                <span data-van="2026" class="van-reference text-[10px] block font-medium">2026 Van</span>
                <span class="font-bold text-slate-800">\${item.van2026 ?? 0}</span>
              </div>
            </div>
            <div class="flex items-center justify-between text-[10px] pt-1 text-slate-500">
              <span>Broken: <strong class="text-red-600">\${item.broken ?? 0}</strong> • Repaired: <strong class="text-emerald-600">\${item.repaired ?? 0}</strong></span>
              <span>Missing: <strong class="text-amber-600">\${item.missing ?? 0}</strong></span>
            </div>
          \`;
        } else if (currentInvTab === 'class') {
          card.innerHTML = \`
            <div class="flex items-start justify-between">
              <h3 class="text-xs font-bold text-slate-900">\${item.tool}</h3>
            </div>
            <div class="grid grid-cols-3 gap-2 pt-1 text-xs">
              <div class="bg-indigo-100 text-indigo-800 p-2 rounded-lg border border-indigo-200">
                <span class="text-[10px] text-indigo-600 block">Class Stock</span>
                <span class="text-base font-bold">\${item.classStock}</span>
              </div>
              <div class="bg-red-50 text-red-800 p-2 rounded-lg border border-red-200">
                <span class="text-[10px] text-red-500 block">Broken Bin</span>
                <span class="text-base font-bold">\${item.brokenBin}</span>
              </div>
              <div class="bg-emerald-50 text-emerald-800 p-2 rounded-lg border border-emerald-200">
                <span class="text-[10px] text-emerald-500 block">Repaired Bin</span>
                <span class="text-base font-bold">\${item.repairedBin}</span>
              </div>
            </div>
          \`;
        } else {
          const isAtBaseline = Number(item.quantity) >= Number(item.baseline);
          const hasNote = item.notes && item.notes.trim().length > 0;
          card.innerHTML = \`
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-xs font-bold text-slate-900">\${item.item}</h3>
                <p class="text-[10px] text-slate-400">\${escapeLocationHtml(formatLocation(item.area, item.bin))}</p>
              </div>
              <div class="text-right">
                <span class="inline-block px-2 py-0.5 rounded text-xs font-extrabold \${isAtBaseline ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
                  \${item.quantity ?? '-'} <span class="text-[10px] font-normal text-slate-400">/ \${item.baseline ?? '-'}</span>
                </span>
              </div>
            </div>
            \${hasNote ? \`
              <div class="mt-1 pt-1 border-t border-slate-100 flex items-center space-x-1 text-[11px] text-slate-700">
                <span class="text-indigo-600 font-semibold">Note:</span>
                <span class="bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60 text-slate-800">\${item.notes}</span>
              </div>
            \` : ''}
          \`;
        }
        list.appendChild(card);
      });
    }
    // LOGGER AUTOCOMPLETE & SUBMIT LOGIC
    function onSearchInput(val) {
      const list = document.getElementById('autocompleteList');
      const clearBtn = document.getElementById('clearBtn');
      list.innerHTML = '';
      if (!val || val.trim().length === 0) {
        list.classList.add('hidden');
        clearBtn.classList.add('hidden');
        return;
      }
      clearBtn.classList.remove('hidden');
      const query = val.toLowerCase().trim();
      const matches = allItems.filter(item => item.toLowerCase().includes(query)).slice(0, 15);
      if (matches.length === 0) {
        list.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">No matching tools</div>';
        list.classList.remove('hidden');
        return;
      }
      matches.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'p-3 text-sm cursor-pointer hover:bg-indigo-50 font-medium text-slate-800';
        itemDiv.textContent = item;
        itemDiv.onclick = function() {
          document.getElementById('itemSearch').value = item;
          list.classList.add('hidden');
        };
        list.appendChild(itemDiv);
      });
      list.classList.remove('hidden');
    }
    function clearItemSearch() {
      document.getElementById('itemSearch').value = '';
      document.getElementById('autocompleteList').classList.add('hidden');
      document.getElementById('clearBtn').classList.add('hidden');
    }
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#itemSearch') && !e.target.closest('#autocompleteList')) {
        document.getElementById('autocompleteList').classList.add('hidden');
      }
    });
    function selectActionTab(actionName) {
      currentAction = actionName;
      document.querySelectorAll('.action-tab').forEach(tab => {
        tab.className = 'action-tab p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex flex-col justify-between hover:bg-slate-100 font-semibold text-left min-h-[66px]';
      });
      let activeTabId = 'tabRestock';
      if (actionName === 'Broke, Needs replacement') activeTabId = 'tabBroke';
      else if (actionName === 'Missing, Needs replacement') activeTabId = 'tabMissing';
      else if (actionName === 'Repaired') activeTabId = 'tabRepaired';
      else if (actionName === 'Moved/Transferred Stock') activeTabId = 'tabTransfer';
      else if (actionName === 'Other Event (Found, Disposed, Purchased, Sold)') activeTabId = 'tabOther';
      const activeBtn = document.getElementById(activeTabId);
      if (activeBtn) {
        activeBtn.className = 'action-tab p-3 rounded-xl border-2 border-indigo-600 bg-indigo-50 text-indigo-700 flex flex-col justify-between shadow-xs font-bold text-left min-h-[66px]';
      }
      document.querySelectorAll('.tab-content').forEach(sec => sec.classList.add('hidden'));
      if (actionName === 'Restocked from tool room') {
        document.getElementById('secRestock').classList.remove('hidden');
      } else if (actionName === 'Broke, Needs replacement' || actionName === 'Missing, Needs replacement') {
        document.getElementById('secBrokeMissing').classList.remove('hidden');
      } else if (actionName === 'Repaired') {
        document.getElementById('secRepaired').classList.remove('hidden');
      } else if (actionName === 'Moved/Transferred Stock') {
        document.getElementById('secTransfer').classList.remove('hidden');
      } else if (actionName === 'Other Event (Found, Disposed, Purchased, Sold)') {
        document.getElementById('secOther').classList.remove('hidden');
      }
    }
    function onRestockVanChange(val) {
      const storageSec = document.getElementById('sec2026Storage');
      if (val === '2026 Van') {
        storageSec.classList.remove('hidden');
      } else {
        storageSec.classList.add('hidden');
      }
    }
    function onReplaceChange(val) {
      const splitSec = document.getElementById('secSplitQuantities');
      if (val === 'Yes, split locations/partially replaced') {
        splitSec.classList.remove('hidden');
      } else {
        splitSec.classList.add('hidden');
      }
    }
    function adjustSplitQty(inputId, delta) {
      const input = document.getElementById(inputId);
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) + delta);
    }
    function adjustQty(delta) {
      const el = document.getElementById('quantity');
      let val = parseInt(el.value, 10) || 1;
      val = Math.max(1, val + delta);
      el.value = val;
    }
    function handleFormSubmit(e) {
      e.preventDefault();
      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Saving to Sheet...</span>';
      const payload = {
        employee: document.getElementById('employee').value,
        item: document.getElementById('itemSearch').value,
        action: currentAction,
        quantity: document.getElementById('quantity').value,
        notes: document.getElementById('notes').value,
        whichVanRestocked: document.getElementById('whichVanRestocked').value,
        storageArea2026: document.getElementById('storageArea2026').value,
        vanOrLocationBroke: document.getElementById('vanOrLocationBroke').value,
        didYouReplace: document.getElementById('didYouReplace').value,
        qtyRepairedBin: document.getElementById('qtyRepairedBin').value,
        qtyClassStock: document.getElementById('qtyClassStock').value,
        repairedMovedTo: document.getElementById('repairedMovedTo').value,
        transferMovedFrom: document.getElementById('transferMovedFrom').value,
        transferMovedTo: document.getElementById('transferMovedTo').value,
        otherEventSub: document.getElementById('otherEventSub').value,
        otherMovedFrom: document.getElementById('otherMovedFrom').value,
        otherMovedTo: document.getElementById('otherMovedTo').value
      };
      google.script.run
        .withSuccessHandler(function(res) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Submit Log Entry</span>';
          if (res.success) {
            document.getElementById('successMsg').textContent = 'Successfully logged ' + res.item + '!';
            document.getElementById('successBox').classList.remove('hidden');
            delete invCache['2026'];
            delete invCache['2021'];
            delete invCache['2015'];
            delete invCache['summary'];
            delete invCache['class'];
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            alert('Error saving: ' + res.error);
          }
        })
        .withFailureHandler(function(err) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Submit Log Entry</span>';
          alert('Network error: ' + err.message);
        })
        .submitLogEntry(payload);
    }
    function resetForm() {
      document.getElementById('itemSearch').value = '';
      document.getElementById('quantity').value = '1';
      document.getElementById('notes').value = '';
      document.getElementById('successBox').classList.add('hidden');
      document.getElementById('clearBtn').classList.add('hidden');
    }
  </script>
</body>
</html>`;
  return HtmlService.createHtmlOutput(html)
    .setTitle('Van Inventory Hub')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}
/**
 * Reads inventory from a specific tab and returns structured JSON in sheet row order.
 */
function normalizeInventoryHeader_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function inventoryHeaderIndex_(headers, aliases, fallbackOneBased) {
  const wanted = aliases.map(normalizeInventoryHeader_);
  const normalized = headers.map(normalizeInventoryHeader_);
  for (let i = 0; i < normalized.length; i++) {
    if (wanted.includes(normalized[i])) return i;
  }
  return fallbackOneBased - 1;
}

/**
 * Reads inventory from a specific tab and returns structured JSON in sheet row order.
 */
/**
 * Applies the dedicated replenishment-status event stream to van inventory returned to the PWA.
 * These events intentionally do not alter any legacy stock location or Google Form movement field.
 * The van sheets remain the base inventory; the latest PWA status event overrides a matching
 * status item's displayed van quantity to 0 (needs attention) or 1 (replenished).
 */
function ensurePwaFormResponseColumns_(sheet) {
  const requiredColumns = 25; // X = Offline Event ID, Y = PWA Status Location
  const missing = requiredColumns - sheet.getMaxColumns();
  if (missing > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
  }

  if (!sheet.getRange(1, 24).getValue()) {
    sheet.getRange(1, 24).setValue('Offline Event ID');
  }
  if (!sheet.getRange(1, 25).getValue()) {
    sheet.getRange(1, 25).setValue('PWA Status Location');
  }
}

function applyPwaReplenishmentStatus_(tabKey, inventoryRows) {
  if (!Array.isArray(inventoryRows) || !inventoryRows.length) return inventoryRows;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const history = ss.getSheetByName('Form Responses 1');
  if (!history || history.getLastRow() < 2) return inventoryRows;
  ensurePwaFormResponseColumns_(history);

  // C = Item, D = Event/Action, Y = dedicated PWA status location.
  const values = history.getRange(2, 3, history.getLastRow() - 1, 23).getValues();
  const latestByItemLocation = {};

  values.forEach(r => {
    const item = String(r[0] || '').trim();       // C
    const action = String(r[1] || '').trim();     // D
    const statusLocation = String(r[22] || '').trim(); // Y
    if (!item || !statusLocation) return;
    if (action !== 'Needs replenishing / recharging' && action !== 'Needs replenishing' && action !== 'Replenished') return;

    latestByItemLocation[item.toLowerCase() + '|' + normalizePwaStatusLocation_(statusLocation)] =
      action === 'Replenished' ? 1 : 0;
  });

  Object.keys(latestByItemLocation).forEach(key => {
    const split = key.lastIndexOf('|');
    const itemKey = key.slice(0, split);
    const locationKey = key.slice(split + 1);
    if (!pwaStatusLocationMatchesTab_(locationKey, tabKey)) return;

    let matches = inventoryRows.filter(row => String(row.item || '').trim().toLowerCase() === itemKey);
    // If the item only appears once in the 2026 van, its row is already unambiguous.
    // This is important for individually listed boards/dowels whose area/bin cells may
    // not use the old Floor/2nd Level wording. Only filter by sublocation for duplicates.
    if (tabKey === '2026' && matches.length > 1) {
      matches = matches.filter(row => pwaStatusLocationMatches2026Row_(locationKey, row));
    }

    // Avoid changing multiple physical rows when the selected van/location is ambiguous.
    if (matches.length === 1) matches[0].quantity = latestByItemLocation[key];
  });

  return inventoryRows;
}

function normalizePwaStatusLocation_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace('2026 van floor level', '2026 van floor')
    .replace('2026 van 2nd level', '2026 2nd level');
}

function pwaStatusLocationMatchesTab_(location, tabKey) {
  if (tabKey === '2015') return location.indexOf('2015 van') !== -1;
  if (tabKey === '2021') return location.indexOf('2021 van') !== -1;
  if (tabKey === '2026') return location.indexOf('2026') !== -1;
  return false;
}

function pwaStatusLocationMatches2026Row_(location, row) {
  const where = (String(row.area || '') + ' ' + String(row.bin || '')).toLowerCase();
  if (location.indexOf('floor') !== -1) {
    return where.indexOf('floor') !== -1 || where.indexOf('bottom') !== -1;
  }
  if (location.indexOf('2nd') !== -1 || location.indexOf('second') !== -1) {
    return where.indexOf('2nd') !== -1 || where.indexOf('second') !== -1 || where.indexOf('middle') !== -1;
  }
  if (location.indexOf('other') !== -1) {
    return where.indexOf('floor') === -1 && where.indexOf('bottom') === -1 &&
      where.indexOf('2nd') === -1 && where.indexOf('second') === -1 && where.indexOf('middle') === -1;
  }
  return true;
}

function getInventoryData(tabKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (tabKey === '2026' || tabKey === '2021' || tabKey === '2015') {
    const sheetName = tabKey === '2026' ? '2026 Van' : (tabKey === '2021' ? '2021 van' : '2015 van');
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 5) return [];

    // Read by header name when possible so manually entered Notes still work even if
    // one of the van-sheet columns is moved. Fall back to the original B:H layout.
    const lastCol = Math.max(sheet.getLastColumn(), 8);
    const headers = sheet.getRange(4, 1, 1, lastCol).getDisplayValues()[0];
    const areaCol = inventoryHeaderIndex_(headers, ['Storage Area', 'Area'], 2);
    const binCol = inventoryHeaderIndex_(headers, ['Bin/Location', 'Bin / Location', 'Bin', 'Location'], 3);
    const itemCol = inventoryHeaderIndex_(headers, ['Item', 'Tool'], 4);
    const qtyCol = inventoryHeaderIndex_(headers, ['Quantity', 'Qty'], 5);
    const notesCol = inventoryHeaderIndex_(headers, ['Notes', 'Note'], 6);
    const baselineCol = inventoryHeaderIndex_(headers, ['Baseline Quantity', 'Baseline Qty', 'Baseline'], 8);
    const rows = sheet.getRange(5, 1, lastRow - 4, lastCol).getValues();
    const result = [];
    rows.forEach(r => {
      const item = String(r[itemCol] || '').trim();
      if (!item || /^\d+\s+items?$/i.test(item)) return;
      result.push({
        area: String(r[areaCol] || '').trim(),
        bin: String(r[binCol] || '').trim(),
        item: item,
        quantity: r[qtyCol] !== '' ? r[qtyCol] : 0,
        notes: String(r[notesCol] || '').trim(),
        baseline: r[baselineCol] !== '' ? r[baselineCol] : 0
      });
    });
    return applyPwaReplenishmentStatus_(tabKey, result);
  }

  if (tabKey === 'class') {
    const sheet = ss.getSheetByName('CLASS REPLACEMENTS');
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    // Missing lives on Tool Summary, so merge it into the Class Stock response by tool name.
    const missingByTool = {};
    const summarySheet = ss.getSheetByName('Tool Summary');
    if (summarySheet && summarySheet.getLastRow() >= 2) {
      const summaryRows = summarySheet.getRange(2, 1, summarySheet.getLastRow() - 1, 9).getValues();
      summaryRows.forEach(r => {
        const name = String(r[0] || '').trim();
        const key = name.toLowerCase();
        if (!name || key === 'total' || key === 'item' || key === 'tool') return;
        missingByTool[key] = r[8] !== '' ? r[8] : 0;
      });
    }

    // Columns A to D: TOOL, Broken Bin, Repaired Bin, Class stock.
    // Ignore title/header rows so the first card is the first actual tool (e.g. Brace Drill).
    const rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const result = [];
    rows.forEach(r => {
      const tool = String(r[0] || '').trim();
      const key = tool.toLowerCase();
      if (!tool || key === 'tool' || key === 'item') return;
      result.push({
        tool: tool,
        brokenBin: r[1] !== '' ? r[1] : 0,
        repairedBin: r[2] !== '' ? r[2] : 0,
        classStock: r[3] !== '' ? r[3] : 0,
        missing: Object.prototype.hasOwnProperty.call(missingByTool, key) ? missingByTool[key] : 0
      });
    });
    return result;
  }

  if (tabKey === 'summary') {
    const sheet = ss.getSheetByName('Tool Summary');
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    // Columns A to I: Item, Class Stock, 2015 Van, 2021 Van, 2026 Van, Broken Bin, Repaired Bin, E-comm, Missing
    const rows = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    const result = [];
    rows.forEach(r => {
      const item = String(r[0] || '').trim();
      const key = item.toLowerCase();
      if (!item || key === 'total' || key === 'item' || key === 'tool') return;
      result.push({
        item: item,
        classStock: r[1] !== '' ? r[1] : 0,
        van2015: r[2] !== '' ? r[2] : 0,
        van2021: r[3] !== '' ? r[3] : 0,
        van2026: r[4] !== '' ? r[4] : 0,
        broken: r[5] !== '' ? r[5] : 0,
        repaired: r[6] !== '' ? r[6] : 0,
        missing: r[8] !== '' ? r[8] : 0
      });
    });
    return result;
  }
  return [];
}

/**
 * Fetches tool items for logger autocomplete.
 *
 * Tool Summary remains the primary list, but MISC column B is also included so
 * a new item created from the PWA becomes searchable even when Tool Summary's
 * aggregation formulas do not automatically add that item.
 */
function getToolItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const values = [];

  const summary = ss.getSheetByName('Tool Summary');
  if (summary && summary.getLastRow() >= 2) {
    values.push(...summary.getRange(2, 1, summary.getLastRow() - 1, 1).getValues().flat());
  }

  const misc = ss.getSheetByName('MISC') || ss.getSheetByName('Misc');
  if (misc && misc.getLastRow() >= 5) {
    values.push(...misc.getRange(5, 2, misc.getLastRow() - 4, 1).getValues().flat());
  }

  const byKey = {};
  values.forEach(value => {
    const item = String(value || '').trim();
    const key = item.toLowerCase();
    if (!item || ['total', 'item', 'tool'].includes(key)) return;
    if (!Object.prototype.hasOwnProperty.call(byKey, key)) byKey[key] = item;
  });

  return Object.values(byKey).sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
  );
}

/**
 * Adds a genuinely new PWA-entered item to the MISC inventory table.
 * MISC layout: B Item, C Location, D Notes, E Quantity, F Unit, G extra field.
 * New items are created as standalone rows with blank location/notes/unit and Qty 0.
 */
function isKnownToolItem_(itemName) {
  const key = String(itemName || '').trim().toLowerCase();
  if (!key) return false;
  return getToolItems().some(existing =>
    String(existing || '').trim().toLowerCase() === key
  );
}

function ensureNewPwaItemInMisc_(itemName) {
  const item = String(itemName || '').trim();
  if (!item) return false;

  const key = item.toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const misc = ss.getSheetByName('MISC') || ss.getSheetByName('Misc');
  if (!misc) throw new Error("Sheet 'MISC' not found.");

  // Guard against duplicates independently of Tool Summary. This helper is only
  // called when the item was not in the app's known-item list before submission.
  if (misc.getLastRow() >= 5) {
    const miscItems = misc.getRange(5, 2, misc.getLastRow() - 4, 1).getValues().flat();
    const alreadyInMisc = miscItems.some(existing =>
      String(existing || '').trim().toLowerCase() === key
    );
    if (alreadyInMisc) return false;
  }

  const targetRow = Math.max(5, misc.getLastRow() + 1);
  if (targetRow > misc.getMaxRows()) {
    misc.insertRowsAfter(misc.getMaxRows(), targetRow - misc.getMaxRows());
  }

  // Carry the table's visual formatting into the new row without copying values/formulas.
  if (targetRow > 5) {
    try {
      misc.getRange(targetRow - 1, 2, 1, 6).copyTo(
        misc.getRange(targetRow, 2, 1, 6),
        SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
        false
      );
    } catch (_) {}
  }

  misc.getRange(targetRow, 2, 1, 6).setValues([[item, '', '', 0, '', '']]);
  return true;
}

/**
 * Appends row to 'Form Responses 1' matching Google Form schema.
 */
function submitLogEntry(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Form Responses 1');
    if (!sheet) throw new Error("Sheet 'Form Responses 1' not found.");
    ensurePwaFormResponseColumns_(sheet);
    let now = formData && formData.clientTimestamp ? new Date(formData.clientTimestamp) : new Date();
    if (isNaN(now.getTime())) now = new Date();
    const timestampStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "M/d/yyyy HH:mm:ss");
    const row = new Array(25).fill('');
    row[0] = timestampStr;                    // Col A: Timestamp
    row[1] = formData.employee;               // Col B: Employee
    row[2] = formData.item;                   // Col C: Item
    row[3] = formData.action;                 // Col D: Event/Action
    const action = formData.action;
    const qty = Number(formData.quantity) || 1;
    if (action === 'Needs replenishing / recharging' || action === 'Needs replenishing' || action === 'Replenished') {
      row[5] = 1;                              // Col F: status quantity is always one unit
      row[24] = formData.statusLocation;       // Col Y: dedicated PWA status location
      if (formData.notes) row[8] = formData.notes;
    } else if (action === 'Restocked from tool room') {
      row[5] = qty;                            // Col F: Quantity
      row[20] = formData.whichVanRestocked;    // Col U: Which van was restocked?
      row[21] = qty;                           // Col V: Qty restocked
      if (formData.notes) row[8] = formData.notes;
    } else if (action === 'Broke, Needs replacement' || action === 'Missing, Needs replacement') {
      row[5] = qty;                            // Col F: Quantity
      row[9] = formData.vanOrLocationBroke;    // Col J: Location
      row[10] = formData.didYouReplace;        // Col K: Did you replace them?
      if (formData.didYouReplace === 'Yes, from repaired bin') {
        row[6] = 'Repaired bin';               // Col G: Replacement source
      } else if (formData.didYouReplace === 'Yes, from class stock') {
        row[6] = 'Class stock';                // Col G: Replacement source
      } else if (formData.didYouReplace === 'Yes, split locations/partially replaced') {
        row[16] = Number(formData.qtyRepairedBin) || ''; // Col Q: Repaired bin
        row[17] = Number(formData.qtyClassStock) || '';  // Col R: Class Stock
      }
      if (formData.notes) row[8] = formData.notes;
    } else if (action === 'Repaired') {
      row[5] = qty;                            // Col F: Quantity
      row[19] = formData.repairedMovedTo;      // Col T: Moved to
      if (formData.notes) row[8] = formData.notes;
    } else if (action === 'Moved/Transferred Stock') {
      row[4] = formData.transferMovedFrom;     // Col E: Moved From
      row[5] = qty;                            // Col F: Quantity
      row[7] = formData.transferMovedTo;       // Col H: Moved To 
      if (formData.notes) row[8] = formData.notes;
    } else if (action === 'Other Event (Found, Disposed, Purchased, Sold)') {
      row[5] = qty;                            // Col F: Quantity
      row[11] = formData.otherEventSub;        // Col L: Event
      row[12] = formData.otherMovedFrom;       // Col M: Moved from
      row[13] = formData.otherMovedTo;         // Col N: Moved To
      if (formData.notes) {
        row[8] = formData.notes;               // Col I: Notes
        row[14] = formData.notes;              // Col O: Notes
      }
    }
    sheet.appendRow(row);
    return { success: true, item: formData.item };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * JSONP API for the GitHub-hosted PWA.
 * JSONP is used because Apps Script web apps do not provide normal configurable CORS headers.
 */
function handleApiGet_(e) {
  const callback = String((e.parameter && e.parameter.callback) || 'callback');
  if (!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput('/* invalid callback */')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  let result;
  try {
    const suppliedKey = String((e.parameter && e.parameter.key) || '');
    if (suppliedKey !== WA_PWA_API_KEY) {
      throw new Error('Unauthorized.');
    }

    const action = String(e.parameter.action || 'ping');

    if (action === 'ping') {
      result = { success: true, data: { status: 'ok', time: new Date().toISOString() } };
    } else if (action === 'tools') {
      result = { success: true, data: getToolItems() };
    } else if (action === 'inventory') {
      result = { success: true, data: getInventoryData(String(e.parameter.tab || '2026')) };
    } else if (action === 'submit') {
      const raw = String(e.parameter.payload || '');
      if (!raw) throw new Error('Missing payload.');
      const formData = JSON.parse(raw);
      result = submitLogEntryIdempotent_(formData);
    } else {
      throw new Error('Unknown API action: ' + action);
    }
  } catch (err) {
    result = { success: false, error: err && err.message ? err.message : String(err) };
  }

  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(result) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * Writes a queued/offline event exactly once.
 * Column X of Form Responses 1 stores the PWA event ID for duplicate protection.
 */
function submitLogEntryIdempotent_(formData) {
  const eventId = String((formData && formData.eventId) || '').trim();
  if (!eventId) throw new Error('Missing eventId.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Form Responses 1');
    if (!sheet) throw new Error("Sheet 'Form Responses 1' not found.");

    const eventIdCol = 24; // Column X
    const statusLocationCol = 25; // Column Y
    ensurePwaFormResponseColumns_(sheet);

    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const found = sheet.getRange(2, eventIdCol, lastRow - 1, 1)
        .createTextFinder(eventId)
        .matchEntireCell(true)
        .findNext();
      if (found) {
        return { success: true, duplicate: true, item: formData.item };
      }
    }

    // Capture whether this item was already in the app's search sources BEFORE the
    // event is written. That makes the MISC decision deterministic even if sheet
    // formulas recalculate immediately after the new Form Responses row appears.
    const wasKnownBeforeSubmit = isKnownToolItem_(formData.item);

    const response = submitLogEntry(formData);
    if (!response || !response.success) return response;

    // submitLogEntry appends one row. Record the id on that same row while still holding the lock.
    const writtenRow = sheet.getLastRow();
    sheet.getRange(writtenRow, eventIdCol).setValue(eventId);

    // Only the PWA's idempotent submission path auto-creates MISC items. The event
    // is already safely logged and tagged with its event ID before this runs, so a
    // MISC-sheet problem can never cause the same tool event to be logged twice.
    try {
      response.miscAdded = wasKnownBeforeSubmit ? false : ensureNewPwaItemInMisc_(formData.item);
    } catch (miscErr) {
      console.warn('Could not add new PWA item to MISC:', miscErr);
      response.miscAdded = false;
      response.miscAddWarning = miscErr && miscErr.message ? miscErr.message : String(miscErr);
    }

    return response;
  } finally {
    lock.releaseLock();
  }
}
