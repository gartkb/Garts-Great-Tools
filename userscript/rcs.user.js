// ==UserScript==
// @name         Superstore Value Sorter (v15.4 - Manual Calc & Glitch Fix)
// @namespace    http://tampermonkey.net/
// @version      15.4
// @description  Sorts by value. Calculates unit price manually to fix sale/limit/typo errors on store labels.
// @match        https://www.realcanadiansuperstore.ca/*
// @require      https://gartkb.github.io/Garts-Great-Tools/userscript/tm-value-sorter-core.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // 0. GLOBAL STATE (PERSISTENT)
    // =========================================================
    
    const getSavedBool = (key, def) => {
        const val = localStorage.getItem(key);
        if (val === null) return def;
        return val === 'true';
    };

    const STATE = {
        usePoints: getSavedBool('tm_vs_usePoints', true),
        badgePos: localStorage.getItem('tm_vs_badgePos') || 'top-left',
        loadMore: getSavedBool('tm_vs_loadMore', false)
    };

    function saveState() {
        localStorage.setItem('tm_vs_usePoints', STATE.usePoints);
        localStorage.setItem('tm_vs_badgePos', STATE.badgePos);
        localStorage.setItem('tm_vs_loadMore', STATE.loadMore);
    }

    // =========================================================
    // 1. DATA PARSING
    // =========================================================

    function parseCardData(card) {
        const rawText = (card.innerText || "").toLowerCase().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

        // --- STEP 1: EXTRACT POINTS ---
        let pointsValue = 0;
        const pointsMatch = rawText.match(/([0-9,]+)\s*pc optimum points/);
        if (pointsMatch) {
            pointsValue = parseFloat(pointsMatch[1].replace(/,/g, '')) / 1000;
        }

        // --- STEP 2: EXTRACT BEST PRICE ---
        // We do this BEFORE weight, because we want to calculate the unit price ourselves.
        let validPrices = [];
        
        // Handle "2 for $5"
        const multiBuyMatch = rawText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);
        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) validPrices.push(total / qty);
        }

        // Clean text to avoid confusing the regex with unit prices or savings
        const cleanForPrice = rawText
            .replace(/save\s*\$[0-9,.]+/g, "")
            .replace(/after limit\s*\$[0-9,.]+/g, "")
            // Remove the store's displayed unit price so we don't grab it as the item price
            .replace(/\$\s*[0-9,.]+\s*\/\s*[0-9.]*\s*[a-z]+/g, "") 
            .replace(/about\s*\$[0-9,.]+/g, "");
        
        const pMatches = [...cleanForPrice.matchAll(/\$\s*([0-9,.]+)/g)];
        pMatches.forEach(m => {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (val > 0.1) validPrices.push(val);
        });

        let bestShelfPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;
        
        // Apply Points
        let effectivePrice = bestShelfPrice;
        let hasPoints = false;
        if (bestShelfPrice && STATE.usePoints && pointsValue > 0) {
            effectivePrice = Math.max(0.01, bestShelfPrice - pointsValue);
            hasPoints = true;
        }

        // --- STEP 3: EXTRACT WEIGHT/VOLUME (MANUAL PARSING) ---
        // This regex looks for: "1.5 kg", "500 g", "6x200 ml", "284x284.0 g"
        const weightRegex = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:[xX]\s*(\d+(?:\.\d+)?))?\s*(g|kg|ml|l|lb|oz)\b/i;
        const weightMatch = rawText.match(weightRegex);

        if (weightMatch && effectivePrice) {
            let num1 = parseFloat(weightMatch[1]);
            let num2 = weightMatch[2] ? parseFloat(weightMatch[2]) : 1;
            const unit = weightMatch[3];

            // ** GLITCH FIX **: 
            // If text is "284x284.0 g", the store made a typo.
            // If the two numbers are roughly equal (and > 1), assume it's NOT a multipack, but a typo.
            if (num2 > 1 && Math.abs(num1 - num2) < 0.5) {
                num2 = 1; 
            }

            let totalUnits = num1 * num2;
            let normalizedUnits = totalUnits;
            let type = 'weight';
            let labelUnit = '100g';

            // Normalize to 100g / 100ml / 1 lb
            if (unit === 'kg') { normalizedUnits = totalUnits * 1000; }
            else if (unit === 'g') { normalizedUnits = totalUnits; }
            else if (unit === 'l') { normalizedUnits = totalUnits * 1000; type = 'vol'; labelUnit = '100ml'; }
            else if (unit === 'ml') { normalizedUnits = totalUnits; type = 'vol'; labelUnit = '100ml'; }
            else if (unit === 'lb') { normalizedUnits = totalUnits * 453.6; } // convert to g for calculation? 
            else if (unit === 'oz') { normalizedUnits = totalUnits * 28.35; }

            // If we have lb/oz, maybe we want to keep it in imperial? 
            // For now, let's normalize everything to $/100g or $/100ml for easy comparison
            
            // Calculate Unit Price
            // Price per 100 units
            const unitPrice = (effectivePrice / normalizedUnits) * 100;
            
            return {
                val: unitPrice,
                label: `$${unitPrice.toFixed(2)}/${labelUnit}`,
                type: type,
                isDeal: false,
                hasPoints: hasPoints,
                priceUsed: effectivePrice
            };
        }

        // --- STEP 4: FALLBACK (Use Store String) ---
        // Only if regex failed (e.g. items sold by "each" or weird formatting)
        let shelfUnitVal = null;
        let shelfUnitType = 'each';
        const storeUnitMatch = rawText.match(/\$\s*([0-9,.]+)\s*\/\s*([0-9.]*)\s*([a-z]+)/);
        
        if (storeUnitMatch) {
            const rawPrice = parseFloat(storeUnitMatch[1].replace(/,/g, ''));
            const uQty = parseFloat(storeUnitMatch[2]) || 1;
            const uUnit = storeUnitMatch[3];
            
            if (uUnit === 'ea') {
                shelfUnitVal = rawPrice / uQty;
                // If we have an effective price (points/sale), adjust the ratio
                if (effectivePrice && bestShelfPrice) {
                    shelfUnitVal = shelfUnitVal * (effectivePrice / bestShelfPrice);
                }
                return {
                    val: shelfUnitVal,
                    label: `$${shelfUnitVal.toFixed(2)}/ea`,
                    type: 'each',
                    isDeal: false,
                    hasPoints: hasPoints,
                    priceUsed: effectivePrice
                };
            }
        }

        // --- STEP 5: ABSOLUTE FALLBACK ---
        if (effectivePrice) {
             return {
                val: 9999,
                label: "Set Qty",
                type: 'unknown',
                isDeal: false,
                hasPoints: hasPoints,
                priceUsed: effectivePrice
            };
        }

        return null;
    }

    // =========================================================
    // 2. VISUALS & INTERACTION
    // =========================================================

    function applyBadgePosition(badge) {
        badge.style.top = "auto"; badge.style.bottom = "auto";
        badge.style.left = "auto"; badge.style.right = "auto";
        badge.style.transform = "none";

        const P = "6px"; 
        switch (STATE.badgePos) {
            case 'top-right':    badge.style.top = P; badge.style.right = P; break;
            case 'top-left':     badge.style.top = P; badge.style.left = P; break;
            case 'bottom-right': badge.style.bottom = P; badge.style.right = P; break;
            case 'bottom-left':  badge.style.bottom = P; badge.style.left = P; break;
            case 'mid-right':
                badge.style.top = "50%"; badge.style.right = P;
                badge.style.transform = "translateY(-50%)";
                break;
            case 'mid-left':
                badge.style.top = "50%"; badge.style.left = P;
                badge.style.transform = "translateY(-50%)";
                break;
            default: badge.style.top = P; badge.style.left = P;
        }
    }

    function badgeItem(card) {
        if(card.dataset.tmManual) return; 

        const data = parseCardData(card);
        const oldBadge = card.querySelector('.tm-badge');
        if (oldBadge) oldBadge.remove();

        if (!data) return;

        const badge = document.createElement("div");
        badge.className = 'tm-badge';
        badge.innerText = data.label;

        let tooltip = "Click to set manual quantity";
        if (data.priceUsed && data.val > 0) {
            // Reverse calc for tooltip display
            let detectedQty = 0;
            if (data.type === 'each') detectedQty = data.priceUsed / data.val;
            else detectedQty = (data.priceUsed / data.val) * 100; 

            // Round nicely
            detectedQty = Math.round(detectedQty * 100) / 100;
            
            let unitLabel = data.type === 'each' ? 'items' : (data.type === 'vol' ? 'ml' : 'g');
            tooltip = `Detected: ${detectedQty} ${unitLabel}\nPrice: $${data.priceUsed.toFixed(2)}\nClick to edit`;
        }
        badge.title = tooltip;

        Object.assign(badge.style, {
            position: "absolute",
            padding: "3px 6px", borderRadius: "4px", fontSize: "12px",
            fontWeight: "800", zIndex: "20", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            fontFamily: "sans-serif", cursor: "pointer"
        });

        applyBadgePosition(badge);

        if (data.type === 'unknown') {
             badge.style.background = "#eee"; badge.style.color = "#555";
        } else if (data.isDeal) {
            badge.style.background = "#fffaeb"; badge.style.color = "#b7791f"; badge.style.border = "2px solid #b7791f";
            badge.innerText += " ⭐";
        } else if (data.type === 'vol') {
            badge.style.background = "#ebf8ff"; badge.style.color = "#2b6cb0"; badge.style.border = "1px solid #90cdf4";
        } else if (data.type === 'each') {
            badge.style.background = "#faf5ff"; badge.style.color = "#553c9a"; badge.style.border = "1px solid #d6bcfa"; 
        } else {
            badge.style.background = "#f0fff4"; badge.style.color = "#22543d"; badge.style.border = "1px solid #9ae6b4";
        }

        if (data.hasPoints) badge.innerText += " (pts)";

        badge.onclick = (e) => {
            e.preventDefault(); e.stopPropagation(); 
            const currentQty = (data.priceUsed && data.val > 0 && data.type === 'each') ? Math.round(data.priceUsed / data.val) : "";
            const userQty = prompt(`Manual Override for ${data.priceUsed ? '$'+data.priceUsed.toFixed(2) : 'Item'}\nEnter Item Count:`, currentQty);
            const qty = parseFloat(userQty);

            if (qty > 0 && data.priceUsed) {
                const newVal = data.priceUsed / qty;
                badge.innerText = `$${newVal.toFixed(2)}/ea (Manual)`;
                badge.style.background = "#ffffcc"; 
                badge.style.color = "#000";
                card.dataset.tmVal = newVal;
                card.dataset.tmManual = "true"; 
            }
        };

        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        card.appendChild(badge);
        card.dataset.tmVal = data.val;
    }

    function updateAllBadges() {
        const cards = document.querySelectorAll('div[class*="product-grid-component"] > div');
        cards.forEach(card => badgeItem(card));
    }

    function repositionAllBadges() {
        const badges = document.querySelectorAll('.tm-badge');
        badges.forEach(b => applyBadgePosition(b));
    }

    // =========================================================
    // 3. UI & INFINITE LOADING
    // =========================================================

    function initUI() {
        if (document.getElementById('tm-ui-container')) return;

        const container = document.createElement("div");
        container.id = 'tm-ui-container';
        Object.assign(container.style, {
            position: "fixed", bottom: "20px", left: "20px", zIndex: "99999",
            display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start"
        });

        const toggleWrapper = document.createElement("div");
        Object.assign(toggleWrapper.style, {
            background: "rgba(0,0,0,0.8)", padding: "8px 10px", borderRadius: "6px",
            color: "white", fontSize: "12px", display: "flex", flexDirection: "column", gap: "6px",
            fontFamily: "sans-serif"
        });

        function createCheckRow(labelText, checked, onChange) {
            const row = document.createElement("div");
            row.style.display = "flex"; row.style.alignItems = "center"; row.style.gap = "6px";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.checked = checked;
            box.style.cursor = "pointer";
            box.onchange = onChange;
            const lbl = document.createElement("span");
            lbl.innerText = labelText;
            row.appendChild(box);
            row.appendChild(lbl);
            return row;
        }

        const rowPoints = createCheckRow("Incl. Points", STATE.usePoints, (e) => {
            STATE.usePoints = e.target.checked;
            saveState(); 
            document.querySelectorAll('[data-tm-manual]').forEach(c => delete c.dataset.tmManual);
            updateAllBadges();
        });

        const rowLoadMore = createCheckRow("Load +1 Page", STATE.loadMore, (e) => {
            STATE.loadMore = e.target.checked;
            saveState();
        });

        const rowPos = document.createElement("div");
        rowPos.style.display = "flex"; rowPos.style.alignItems = "center"; rowPos.style.gap = "6px";
        const posSelect = document.createElement("select");
        Object.assign(posSelect.style, { fontSize: "11px", padding: "2px", borderRadius: "3px", cursor: "pointer" });
        const opts = [
            {v: 'top-left', t: 'Top Left'}, {v: 'top-right', t: 'Top Right'},
            {v: 'bottom-left', t: 'Btm Left'}, {v: 'bottom-right', t: 'Btm Right'},
            {v: 'mid-left', t: 'Mid Left'}, {v: 'mid-right', t: 'Mid Right'}
        ];
        opts.forEach(o => {
            const opt = document.createElement("option");
            opt.value = o.v; opt.innerText = o.t;
            if(o.v === STATE.badgePos) opt.selected = true;
            posSelect.appendChild(opt);
        });
        posSelect.onchange = (e) => {
            STATE.badgePos = e.target.value;
            saveState();
            repositionAllBadges();
        };
        rowPos.appendChild(posSelect);

        toggleWrapper.appendChild(rowPoints);
        toggleWrapper.appendChild(rowLoadMore);
        toggleWrapper.appendChild(rowPos);

        const btn = document.createElement("button");
        btn.innerHTML = "Sort by Value";
        Object.assign(btn.style, {
            padding: "8px 12px", background: "#2f855a", color: "fff",
            border: "2px solid #fff", borderRadius: "8px", fontWeight: "bold", cursor: "pointer",
            boxShadow: "0 4px 6px rgba(0,0,0,0.3)", fontFamily: "sans-serif"
        });
        
        btn.onclick = async () => {
            if (STATE.loadMore) {
                btn.disabled = true;
                btn.innerHTML = "Fetching Next Page...";
                const success = await fetchNextPage();
                
                if(success) {
                    btn.innerHTML = "Sorting...";
                    sortGlobal();
                    btn.innerHTML = "Done! (+1 Page)";
                } else {
                    btn.innerHTML = "No More Pages";
                    sortGlobal(); 
                }
                setTimeout(() => { btn.disabled = false; btn.innerHTML = "Sort by Value"; }, 2000);
            } else {
                btn.innerHTML = "Sorting...";
                setTimeout(() => { sortGlobal(); btn.innerHTML = "Sort by Value"; }, 10);
            }
        };

        container.appendChild(toggleWrapper);
        container.appendChild(btn);
        document.body.appendChild(container);
    }

    async function fetchNextPage() {
        const nextLink = document.querySelector('a[aria-label="Next Page"]');
        if (!nextLink || nextLink.getAttribute('disabled')) return false;

        const url = nextLink.href;
        try {
            const response = await fetch(url);
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");
            
            const newGrid = doc.querySelector('div[class*="product-grid-component"]');
            if (newGrid && newGrid.children.length > 0) {
                const cards = Array.from(newGrid.children);
                const currentGrid = document.querySelector('div[class*="product-grid-component"]');
                if (currentGrid) {
                    cards.forEach(card => {
                        const importedCard = document.adoptNode(card);
                        currentGrid.appendChild(importedCard);
                        badgeItem(importedCard);
                    });
                }
            } else {
                return false; 
            }

            const oldPagination = document.querySelector('div[aria-label="Pagination"]');
            const newPagination = doc.querySelector('div[aria-label="Pagination"]');
            
            if (oldPagination && newPagination) {
                oldPagination.innerHTML = newPagination.innerHTML;
            } else if (oldPagination) {
                oldPagination.style.display = 'none';
            }

            return true;

        } catch (e) {
            console.error(e);
            return false;
        }
    }

    // =========================================================
    // 4. ENGINE
    // =========================================================

    function processBatch(nodeList) {
        nodeList.forEach(node => { if (node.nodeType === 1) badgeItem(node); });
    }

    const gridObserver = new MutationObserver((mutations) => mutations.forEach(m => processBatch(m.addedNodes)));
    const pageObserver = new MutationObserver((mutations) => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    if (node.matches && node.matches('div[class*="product-grid-component"]')) attachToGrid(node);
                    else if (node.querySelectorAll) node.querySelectorAll('div[class*="product-grid-component"]').forEach(attachToGrid);
                }
            });
        });
    });

    function attachToGrid(grid) {
        if (grid.dataset.tmObserved) return;
        processBatch(grid.childNodes);
        gridObserver.observe(grid, { childList: true });
        grid.dataset.tmObserved = "true";
    }

    function sortGlobal() {
        updateAllBadges();
        const grids = Array.from(document.querySelectorAll('div[class*="product-grid-component"]'));
        if (grids.length === 0) return;
        
        const masterGrid = grids[0];
        let allCards = [];
        grids.forEach(grid => {
            allCards.push(...Array.from(grid.children));
        });
        
        allCards.sort((a, b) => (parseFloat(a.dataset.tmVal)||99999) - (parseFloat(b.dataset.tmVal)||99999));
        
        const frag = document.createDocumentFragment();
        allCards.forEach(c => frag.appendChild(c));
        masterGrid.appendChild(frag);
        
        for (let i = 1; i < grids.length; i++) grids[i].style.display = 'none';
    }

    function init() {
        initUI();
        document.querySelectorAll('div[class*="product-grid-component"]').forEach(attachToGrid);
        pageObserver.observe(document.body, { childList: true, subtree: true });
    }

    setTimeout(init, 2000);

})();
