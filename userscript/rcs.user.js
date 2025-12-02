// ==UserScript==
// @name         Superstore Value Sorter (v13.0)
// @namespace    http://tampermonkey.net/
// @version      13.0
// @description  The ultimate tool. Handles Weight, Volume, Counts (Eggs/Paper), Multipacks, Points, Limits, and sorting.
// @match        https://www.realcanadiansuperstore.ca/*
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
        let rawText = (card.innerText || "").toLowerCase().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

        // --- STEP 1: FIND POINTS ---
        let pointsValue = 0;
        const pointsMatch = rawText.match(/([0-9,]+)\s*pc optimum points/);
        if (pointsMatch) {
            pointsValue = parseFloat(pointsMatch[1].replace(/,/g, '')) / 1000;
        }

        // --- STEP 2: CLEANUP ---
        // Remove existing unit prices (e.g. $0.58/1ea, $0.99/100g) so they don't mess up our math
        const cleanText = rawText.replace(/\$[0-9,.]+\s*\/\s*[0-9.]*\s*(g|kg|lb|ml|l|ea)/g, "     ")
                                 .replace(/save\s*\$[0-9,.]+/g, "     ");

        // --- STEP 3: FIND QUANTITY (Weight, Vol, or Count) ---
        let measure = null;

        // A. Multipacks (e.g. 4x100g, 12x1ea)
        const mpMatch = cleanText.match(/\b([0-9]+)\s*[x×]\s*([0-9,.]+)\s*(g|kg|ml|l|lb|ea)\b/);
        if (mpMatch) {
            measure = { qty: parseFloat(mpMatch[1]) * parseFloat(mpMatch[2].replace(/,/g, '')), unit: mpMatch[3] };
        }
        // B. Singles (e.g. 650g, 12 ea)
        else {
            const swMatch = cleanText.match(/(?<!\/)\s*\b([0-9,.]+)\s*(g|kg|ml|l|lb|ea)\b/);
            if (swMatch) {
                measure = { qty: parseFloat(swMatch[1].replace(/,/g, '')), unit: swMatch[2] };
            }
        }

        // --- STEP 4: FIND SHELF PRICE ---
        let validPrices = [];

        // Check Multi-Buy "2 FOR $9.00"
        const multiBuyMatch = cleanText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);
        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) validPrices.push(total / qty);
        }

        // Check Standalone Prices (Limits, Sale, Member)
        const pMatches = [...cleanText.matchAll(/\$([0-9,.]+)/g)];
        pMatches.forEach(m => {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (val > 0.1) validPrices.push(val);
        });

        const bestShelfPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;

        return { shelfPrice: bestShelfPrice, measure, rawText, pointsValue };
    }

    function calculateResult(card) {
        const { shelfPrice, measure, rawText, pointsValue } = parseCardData(card);

        // --- APPLY POINTS LOGIC ---
        let finalPrice = shelfPrice;
        if (shelfPrice && STATE.usePoints && pointsValue > 0) {
            finalPrice = Math.max(0.01, shelfPrice - pointsValue);
        }

        // --- CALCULATION ---
        let calculatedVal = null;
        let type = 'weight'; // weight, vol, or each

        if (finalPrice && measure && measure.qty > 0) {
            let p = finalPrice;
            let q = measure.qty;
            let u = measure.unit;

            if (u === 'g') calculatedVal = (p/q)*100;
            else if (u === 'kg') calculatedVal = (p/(q*1000))*100;
            else if (u === 'lb') calculatedVal = (p/(q*453.6))*100;
            else if (u === 'ml') { calculatedVal = (p/q)*100; type = 'vol'; }
            else if (u === 'l') { calculatedVal = (p/(q*1000))*100; type = 'vol'; }
            else if (u === 'ea') { calculatedVal = (p/q); type = 'each'; }
        }

        // --- SCRAPE FALLBACK ---
        let scrapedVal = null;
        const sMatches = [...rawText.toLowerCase().matchAll(/\$([0-9,.]+)\s*\/\s*([0-9.]*)?\s*([a-z]+)/g)];
        let match = sMatches.find(m => ['g','kg','ml','l','ea'].includes(m[3])) || sMatches.find(m => m[3] === 'lb');

        if (match) {
            const p = parseFloat(match[1].replace(/,/g,''));
            const q = parseFloat(match[2])||1;
            const u = match[3];
            if (u === 'g') scrapedVal = (p/q)*100;
            else if (u === 'kg') scrapedVal = (p/(q*1000))*100;
            else if (u === 'lb') scrapedVal = (p/(q*453.6))*100;
            else if (u === 'ml') { scrapedVal = (p/q)*100; type = 'vol'; }
            else if (u === 'l') { scrapedVal = (p/(q*1000))*100; type = 'vol'; }
            else if (u === 'ea') { scrapedVal = (p/q); type = 'each'; }
        }

        // --- FINAL DECISION ---
        let finalVal = 9999;
        let isDeal = false;

        if (calculatedVal !== null && isFinite(calculatedVal)) {
            // Sanity check (relaxed if points are involved or if it's 'each' which can vary wildly)
            if (pointsValue === 0 && scrapedVal !== null && calculatedVal < (scrapedVal * 0.10)) {
                finalVal = scrapedVal;
            } else {
                finalVal = calculatedVal;
                // Deal detection
                if (scrapedVal !== null && calculatedVal < (scrapedVal * 0.95)) {
                    isDeal = true;
                }
            }
        }
        else if (scrapedVal !== null && isFinite(scrapedVal)) {
            finalVal = scrapedVal;
        }

        // Format Label
        let label = "";
        if (finalVal < 9999) {
            if (type === 'each') label = `$${finalVal.toFixed(2)}/ea`;
            else label = `$${finalVal.toFixed(2)}/${type==='vol'?'100ml':'100g'}`;
        } else {
             return null;
        }

        return {
            val: finalVal,
            label: label,
            type: type,
            isDeal: isDeal,
            hasPoints: (STATE.usePoints && pointsValue > 0)
        };
    }

    // =========================================================
    // 2. VISUALS
    // =========================================================

    function badgeItem(card) {
        const data = calculateResult(card);
        const oldBadge = card.querySelector('.tm-badge');
        if (oldBadge) oldBadge.remove();

        if (!data) return;

        const badge = document.createElement("div");
        badge.className = 'tm-badge';
        badge.innerText = data.label;

        Object.assign(badge.style, {
            position: "absolute", top: "6px", right: "6px",
            padding: "3px 6px", borderRadius: "4px", fontSize: "12px",
            fontWeight: "800", zIndex: "20", boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
        });

        // Colors
        if (data.isDeal) {
            badge.style.background = "#fffaeb";
            badge.style.color = "#b7791f";
            badge.style.border = "2px solid #b7791f";
            badge.innerText += " ⭐";
            if (data.hasPoints) badge.innerText += " (pts)";
        } else if (data.type === 'vol') {
            badge.style.background = "#ebf8ff"; badge.style.color = "#2b6cb0"; badge.style.border = "1px solid #90cdf4";
        } else if (data.type === 'each') {
            badge.style.background = "#faf5ff"; badge.style.color = "#553c9a"; badge.style.border = "1px solid #d6bcfa"; // Purple for Counts
            if (data.hasPoints) badge.innerText += " (pts)";
        } else {
            badge.style.background = "#f0fff4"; badge.style.color = "#22543d"; badge.style.border = "1px solid #9ae6b4";
            if (data.hasPoints) badge.innerText += " (pts)";
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
            color: "white", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px"
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
            boxShadow: "0 4px 6px rgba(0,0,0,0.3)"
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
        allCards.sort((a, b) => (parseFloat(a.dataset.tmVal)||9999) - (parseFloat(b.dataset.tmVal)||9999));
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
