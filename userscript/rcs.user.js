// ==UserScript==
// @name         Superstore Value Sorter (v14.0 - Modular Core)
// @namespace    http://tampermonkey.net/
// @version      14.0
// @description  Sorts by value using the Garts-Great-Tools Core Module. Handles Points and Multi-buys.
// @match        https://www.realcanadiansuperstore.ca/*
// @require      https://gartkb.github.io/Garts-Great-Tools/userscript/tm-value-sorter-core.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Global State
    const STATE = {
        usePoints: true // Default: ON
    };

    // =========================================================
    // 1. DATA PARSING
    // =========================================================

    function parseCardData(card) {
        // Normalize text
        const rawText = (card.innerText || "").toLowerCase().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

        // --- STEP 1: FIND POINTS ---
        let pointsValue = 0;
        const pointsMatch = rawText.match(/([0-9,]+)\s*pc optimum points/);
        if (pointsMatch) {
            pointsValue = parseFloat(pointsMatch[1].replace(/,/g, '')) / 1000; // 1000 pts = $1
        }

        // --- STEP 2: FIND SHELF PRICE (The lowest actual price on card) ---
        let validPrices = [];

        // A. Check Multi-Buy "2 FOR $9.00"
        const multiBuyMatch = rawText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);
        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) validPrices.push(total / qty);
        }

        // B. Check Standalone Prices (Limits, Sale, Member)
        // We exclude specific patterns like "save $2" or unit prices
        const cleanForPrice = rawText.replace(/save\s*\$[0-9,.]+/g, "")
                                     .replace(/\$[0-9,.]+\s*\/\s*[0-9a-z]+/g, ""); 
        
        const pMatches = [...cleanForPrice.matchAll(/\$([0-9,.]+)/g)];
        pMatches.forEach(m => {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (val > 0.1) validPrices.push(val);
        });

        let bestShelfPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;

        if (!bestShelfPrice) return null;

        // --- STEP 3: APPLY POINTS LOGIC ---
        let effectivePrice = bestShelfPrice;
        if (STATE.usePoints && pointsValue > 0) {
            effectivePrice = Math.max(0.01, bestShelfPrice - pointsValue);
        }

        // --- STEP 4: GET TITLE ---
        // RCS titles are usually in an h3 or specific class, but finding the first significant text block works well
        let title = "";
        const titleEl = card.querySelector('[class*="product-tile__details__info__name"]');
        if (titleEl) {
            title = titleEl.innerText;
        } else {
            // Fallback: use raw text but strip prices
            title = rawText.substring(0, 100); 
        }

        // --- STEP 5: GET STORE UNIT PRICE (For Deal Comparison) ---
        // We scrape this to pass to the Core so it knows if our calculated price is a "Deal"
        let shelfUnitVal = null;
        // Matches: $1.25/100g or $0.50/100ml or $0.10/1ea
        const unitMatch = rawText.match(/\$([0-9,.]+)\s*\/\s*([0-9.]*)?\s*([a-z]+)/);
        if (unitMatch) {
            const uPrice = parseFloat(unitMatch[1].replace(/,/g, ''));
            const uQty = parseFloat(unitMatch[2]) || 1; // e.g. /100g vs /g
            // We standardize crudely to passing "price per 1 unit" to the core for comparison
            shelfUnitVal = uPrice / uQty; 
            
            // Adjust for 100g/100ml common notation
            if(unitMatch[3] === 'g' || unitMatch[3] === 'ml') {
                if(unitMatch[2] == 100) shelfUnitVal = uPrice; // Keep it as "per 100"
                else shelfUnitVal = uPrice * 100; // Normalize to "per 100"
            }
        }

        // --- STEP 6: CALL CORE ---
        if (window.ValueSorter) {
            const result = window.ValueSorter.analyze(title, effectivePrice, shelfUnitVal);
            if (result) {
                // Attach point info to result for badging
                result.hasPoints = (STATE.usePoints && pointsValue > 0);
            }
            return result;
        }

        return null;
    }

    // =========================================================
    // 2. VISUALS
    // =========================================================

    function badgeItem(card) {
        const data = parseCardData(card);
        
        // Cleanup old badges
        const oldBadge = card.querySelector('.tm-badge');
        if (oldBadge) oldBadge.remove();

        if (!data) return;

        const badge = document.createElement("div");
        badge.className = 'tm-badge';
        badge.innerText = data.label;

        Object.assign(badge.style, {
            position: "absolute", top: "6px", right: "6px",
            padding: "3px 6px", borderRadius: "4px", fontSize: "12px",
            fontWeight: "800", zIndex: "20", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            fontFamily: "sans-serif"
        });

        // Colors (Mapped from Core Types)
        if (data.isDeal) {
            badge.style.background = "#fffaeb";
            badge.style.color = "#b7791f";
            badge.style.border = "2px solid #b7791f";
            badge.innerText += " ⭐";
        } else if (data.type === 'vol') {
            badge.style.background = "#ebf8ff"; 
            badge.style.color = "#2b6cb0"; 
            badge.style.border = "1px solid #90cdf4";
        } else if (data.type === 'each') {
            badge.style.background = "#faf5ff"; 
            badge.style.color = "#553c9a"; 
            badge.style.border = "1px solid #d6bcfa"; 
        } else {
            // Weight
            badge.style.background = "#f0fff4"; 
            badge.style.color = "#22543d"; 
            badge.style.border = "1px solid #9ae6b4";
        }

        // Add Points indicator if applicable
        if (data.hasPoints) {
            badge.innerText += " (pts)";
        }

        if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
        card.appendChild(badge);
        card.dataset.tmVal = data.val;
    }

    function updateAllBadges() {
        const cards = document.querySelectorAll('div[class*="product-grid-component"] > div');
        cards.forEach(card => badgeItem(card));
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
            background: "rgba(0,0,0,0.7)", padding: "6px 10px", borderRadius: "6px",
            color: "white", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px",
            fontFamily: "sans-serif"
        });

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = STATE.usePoints;
        checkbox.style.cursor = "pointer";
        checkbox.onchange = (e) => {
            STATE.usePoints = e.target.checked;
            updateAllBadges();
        };
        const label = document.createElement("span");
        label.innerText = "Incl. Points";
        toggleWrapper.appendChild(checkbox);
        toggleWrapper.appendChild(label);

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
        // Hide subsequent grids to merge pagination/infinite scroll blocks
        for (let i = 1; i < grids.length; i++) grids[i].style.display = 'none';
    }

    function init() {
        initUI();
        document.querySelectorAll('div[class*="product-grid-component"]').forEach(attachToGrid);
        pageObserver.observe(document.body, { childList: true, subtree: true });
    }

    setTimeout(init, 2000);

})();
