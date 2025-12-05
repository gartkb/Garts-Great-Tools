// ==UserScript==
// @name         Superstore Value Sorter (v14.4 - Smart Tooltip)
// @namespace    http://tampermonkey.net/
// @version      14.4
// @description  Sorts by value. Includes Click-to-Edit badges with "Detected Quantity" tooltips.
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
        const rawText = (card.innerText || "").toLowerCase().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

        // --- STEP 1: POINTS ---
        let pointsValue = 0;
        const pointsMatch = rawText.match(/([0-9,]+)\s*pc optimum points/);
        if (pointsMatch) {
            pointsValue = parseFloat(pointsMatch[1].replace(/,/g, '')) / 1000;
        }

        // --- STEP 2: SHELF UNIT PRICE (Fallback) ---
        let shelfUnitVal = null;
        let shelfUnitType = 'weight';
        
        const unitMatch = rawText.match(/\$([0-9,.]+)\s*\/\s*([0-9.]*)?\s*([a-z]+)/);
        if (unitMatch) {
            const uPrice = parseFloat(unitMatch[1].replace(/,/g, ''));
            const uQty = parseFloat(unitMatch[2]) || 1;
            const uUnit = unitMatch[3];

            if (uUnit === 'g' || uUnit === 'ml') {
                shelfUnitVal = (uPrice / uQty) * 100;
                if (uUnit === 'ml') shelfUnitType = 'vol';
            }
            else if (uUnit === 'kg' || uUnit === 'l') {
                shelfUnitVal = (uPrice / uQty) / 10;
                if (uUnit === 'l') shelfUnitType = 'vol';
            }
            else if (uUnit === 'lb') {
                shelfUnitVal = (uPrice / uQty) / 4.536;
            }
            else if (uUnit === 'ea') {
                shelfUnitVal = uPrice / uQty;
                shelfUnitType = 'each';
            }
        }

        // --- STEP 3: SHELF PRICE ---
        let validPrices = [];
        const multiBuyMatch = rawText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);
        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) validPrices.push(total / qty);
        }

        const cleanForPrice = rawText.replace(/save\s*\$[0-9,.]+/g, "")
                                     .replace(/\$[0-9,.]+\s*\/\s*[0-9a-z]+/g, "")
                                     .replace(/about\s*\$[0-9,.]+/g, "");
        
        const pMatches = [...cleanForPrice.matchAll(/\$([0-9,.]+)/g)];
        pMatches.forEach(m => {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (val > 0.1) validPrices.push(val);
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

            // Inject Metadata for Core
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

    function badgeItem(card) {
        if(card.dataset.tmManual) return; 

        const data = parseCardData(card);
        const oldBadge = card.querySelector('.tm-badge');
        if (oldBadge) oldBadge.remove();

        if (!data) return;

        const badge = document.createElement("div");
        badge.className = 'tm-badge';
        badge.innerText = data.label;

        // --- CALCULATE DETECTED QUANTITY FOR TOOLTIP ---
        let tooltip = "Click to set manual quantity";
        if (data.priceUsed && data.val > 0) {
            let qty = 0;
            if (data.type === 'each') {
                qty = data.priceUsed / data.val;
            } else {
                // Weight/Vol is normalized to 100g/100ml
                qty = (data.priceUsed / data.val) * 100;
            }
            // Round to handle floating point errors (e.g. 3.9999 -> 4)
            qty = Math.round(qty * 100) / 100;
            
            let unitLabel = data.type === 'each' ? 'items' : (data.type === 'vol' ? 'ml' : 'g');
            tooltip = `Detected: ${qty} ${unitLabel}\nPrice: $${data.priceUsed.toFixed(2)}\nClick to edit`;
        }
        badge.title = tooltip;

        Object.assign(badge.style, {
            position: "absolute", top: "6px", right: "6px",
            padding: "3px 6px", borderRadius: "4px", fontSize: "12px",
            fontWeight: "800", zIndex: "20", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            fontFamily: "sans-serif", cursor: "pointer"
        });

        // Colors
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

        // --- MANUAL OVERRIDE HANDLER ---
        badge.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation(); 

            const currentQty = (data.priceUsed && data.val > 0 && data.type === 'each') ? Math.round(data.priceUsed / data.val) : "";
            
            const userQty = prompt(
                `Manual Override for ${data.priceUsed ? '$'+data.priceUsed.toFixed(2) : 'Item'}\n` +
                (badge.title ? `(${badge.title.split('\n')[0]})\n` : "") + 
                `\nEnter Item Count (e.g. 4 for 4 cartridges):`, 
                currentQty
            );
            
            const qty = parseFloat(userQty);

            if (qty > 0 && data.priceUsed) {
                const newVal = data.priceUsed / qty;
                badge.innerText = `$${newVal.toFixed(2)}/ea (Manual)`;
                badge.title = `Manual Override: ${qty} items`;
                badge.style.background = "#ffffcc"; 
                badge.style.color = "#000";
                badge.style.border = "1px dashed #999";
                
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
            document.querySelectorAll('[data-tm-manual]').forEach(c => delete c.dataset.tmManual);
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
        for (let i = 1; i < grids.length; i++) grids[i].style.display = 'none';
    }

    function init() {
        initUI();
        document.querySelectorAll('div[class*="product-grid-component"]').forEach(attachToGrid);
        pageObserver.observe(document.body, { childList: true, subtree: true });
    }

    setTimeout(init, 2000);

})();
