// ==UserScript==
// @name         Superstore Value Sorter (v14.7 - Fix Parsing)
// @namespace    http://tampermonkey.net/
// @version      14.7
// @description  Sorts by value. Includes Click-to-Edit badges and Configurable/Persistent Position. Fixes unit price confusion.
// @match        https://www.realcanadiansuperstore.ca/*
// @require      https://gartkb.github.io/Garts-Great-Tools/userscript/tm-value-sorter-core.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // 0. GLOBAL STATE (PERSISTENT)
    // =========================================================
    const STATE = {
        usePoints: localStorage.getItem('tm_vs_usePoints') !== 'false', 
        badgePos: localStorage.getItem('tm_vs_badgePos') || 'top-left'
    };

    function saveState() {
        localStorage.setItem('tm_vs_usePoints', STATE.usePoints);
        localStorage.setItem('tm_vs_badgePos', STATE.badgePos);
    }

    // =========================================================
    // 1. DATA PARSING
    // =========================================================

    function parseCardData(card) {
        // Get text but preserve some spacing for regex safety
        const rawText = (card.innerText || "").toLowerCase().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

        // --- STEP 1: POINTS ---
        let pointsValue = 0;
        const pointsMatch = rawText.match(/([0-9,]+)\s*pc optimum points/);
        if (pointsMatch) {
            pointsValue = parseFloat(pointsMatch[1].replace(/,/g, '')) / 1000;
        }

        // --- STEP 2: SHELF UNIT PRICE (Fallback & Exclusion) ---
        let shelfUnitVal = null;
        let shelfUnitType = 'weight';
        let foundUnitPrices = []; // Store prices found here to exclude them later

        // Regex handles "$0.67/100g", "$0.67 / 100 g", "$0.67/lb"
        const unitMatch = rawText.match(/\$([0-9,.]+)\s*\/\s*([0-9.]*)\s*([a-z]+)/);
        if (unitMatch) {
            const rawPrice = parseFloat(unitMatch[1].replace(/,/g, ''));
            foundUnitPrices.push(rawPrice); // Add to exclusion list

            const uQty = parseFloat(unitMatch[2]) || 1;
            const uUnit = unitMatch[3];

            if (uUnit === 'g' || uUnit === 'ml') {
                shelfUnitVal = (rawPrice / uQty) * 100;
                if (uUnit === 'ml') shelfUnitType = 'vol';
            }
            else if (uUnit === 'kg' || uUnit === 'l') {
                shelfUnitVal = (rawPrice / uQty) / 10;
                if (uUnit === 'l') shelfUnitType = 'vol';
            }
            else if (uUnit === 'lb') {
                shelfUnitVal = (rawPrice / uQty) / 4.536;
            }
            else if (uUnit === 'ea') {
                shelfUnitVal = rawPrice / uQty;
                shelfUnitType = 'each';
            }
        }

        // --- STEP 3: SHELF PRICE ---
        let validPrices = [];
        
        // 3a. Handle "2 for $5"
        const multiBuyMatch = rawText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);
        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) validPrices.push(total / qty);
        }

        // 3b. Clean text to remove distractions
        const cleanForPrice = rawText
            .replace(/save\s*\$[0-9,.]+/g, "")           // Remove "Save $2.00"
            .replace(/after limit\s*\$[0-9,.]+/g, "")    // Remove "after limit $8.49"
            .replace(/\$[0-9,.]+\s*\/\s*[0-9.]*\s*[a-z]+/g, "") // Remove "$0.67/100g"
            .replace(/about\s*\$[0-9,.]+/g, "");         // Remove "about $..."

        // 3c. Extract remaining prices
        const pMatches = [...cleanForPrice.matchAll(/\$([0-9,.]+)/g)];
        pMatches.forEach(m => {
            const val = parseFloat(m[1].replace(/,/g, ''));
            // Filter: Must be > $0.10 AND not equal to the unit price we found earlier
            if (val > 0.1 && !foundUnitPrices.includes(val)) {
                validPrices.push(val);
            }
        });

        let bestShelfPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;

        // --- STEP 4: APPLY POINTS ---
        let effectivePrice = bestShelfPrice;
        if (bestShelfPrice && STATE.usePoints && pointsValue > 0) {
            effectivePrice = Math.max(0.01, bestShelfPrice - pointsValue);
        }

        // --- STEP 5: DECISION ---
        if (effectivePrice && window.ValueSorter) {
            let title = "";
            const titleEl = card.querySelector('[class*="product-tile__details__info__name"]');
            title = titleEl ? titleEl.innerText : rawText.substring(0, 100);

            const sizeInText = rawText.match(/(?:\b|^)(\d+[\s\-]*(?:ea|g|kg|ml|l|lb|oz|pk|pack|count|ct|bags?|sachets?|pods?))\b/i);
            if (sizeInText) {
                title += " " + sizeInText[1];
            }

            const result = window.ValueSorter.analyze(title, effectivePrice, shelfUnitVal);
            
            if (result) {
                result.hasPoints = (STATE.usePoints && pointsValue > 0);
                result.priceUsed = effectivePrice; 
                return result;
            }
        }

        // Fallback
        if (shelfUnitVal !== null) {
            return {
                val: shelfUnitVal,
                label: `$${shelfUnitVal.toFixed(2)}/${shelfUnitType === 'vol' ? '100ml' : (shelfUnitType === 'each' ? 'ea' : '100g')}`,
                type: shelfUnitType,
                isDeal: false,
                hasPoints: false,
                priceUsed: effectivePrice || bestShelfPrice
            };
        }

        if (effectivePrice) {
             return {
                val: 9999,
                label: "Set Qty",
                type: 'unknown',
                isDeal: false,
                hasPoints: false,
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
            let qty = 0;
            if (data.type === 'each') qty = data.priceUsed / data.val;
            else qty = (data.priceUsed / data.val) * 100;
            qty = Math.round(qty * 100) / 100;
            let unitLabel = data.type === 'each' ? 'items' : (data.type === 'vol' ? 'ml' : 'g');
            tooltip = `Detected: ${qty} ${unitLabel}\nPrice: $${data.priceUsed.toFixed(2)}\nClick to edit`;
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
    // 3. UI
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

        // 1. Points Toggle
        const row1 = document.createElement("div");
        row1.style.display = "flex"; row1.style.alignItems = "center"; row1.style.gap = "6px";
        
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = STATE.usePoints;
        checkbox.style.cursor = "pointer";
        checkbox.onchange = (e) => {
            STATE.usePoints = e.target.checked;
            saveState(); // SAVE
            document.querySelectorAll('[data-tm-manual]').forEach(c => delete c.dataset.tmManual);
            updateAllBadges();
        };
        const label = document.createElement("span");
        label.innerText = "Incl. Points";
        row1.appendChild(checkbox);
        row1.appendChild(label);

        // 2. Position Select
        const row2 = document.createElement("div");
        row2.style.display = "flex"; row2.style.alignItems = "center"; row2.style.gap = "6px";

        const posSelect = document.createElement("select");
        Object.assign(posSelect.style, { fontSize: "11px", padding: "2px", borderRadius: "3px", cursor: "pointer" });
        
        const opts = [
            {v: 'top-left', t: 'Top Left'},
            {v: 'top-right', t: 'Top Right'},
            {v: 'bottom-left', t: 'Btm Left'},
            {v: 'bottom-right', t: 'Btm Right'},
            {v: 'mid-left', t: 'Mid Left'},
            {v: 'mid-right', t: 'Mid Right'}
        ];
        opts.forEach(o => {
            const opt = document.createElement("option");
            opt.value = o.v; opt.innerText = o.t;
            if(o.v === STATE.badgePos) opt.selected = true;
            posSelect.appendChild(opt);
        });

        posSelect.onchange = (e) => {
            STATE.badgePos = e.target.value;
            saveState(); // SAVE
            repositionAllBadges();
        };
        
        row2.appendChild(posSelect);

        toggleWrapper.appendChild(row1);
        toggleWrapper.appendChild(row2);

        // 3. Sort Button
        const btn = document.createElement("button");
        btn.innerHTML = "Sort by Value";
        Object.assign(btn.style, {
            padding: "8px 12px", background: "#2f855a", color: "fff",
            border: "2px solid #fff", borderRadius: "8px", fontWeight: "bold", cursor: "pointer",
            boxShadow: "0 4px 6px rgba(0,0,0,0.3)", fontFamily: "sans-serif"
        });
        btn.onclick = () => {
            btn.innerHTML = "Sorting...";
            setTimeout(() => { sortGlobal(); btn.innerHTML = "Sort by Value"; }, 10);
        };

        container.appendChild(toggleWrapper);
        container.appendChild(btn);
        document.body.appendChild(container);
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
