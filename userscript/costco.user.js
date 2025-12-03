// ==UserScript==
// @name         Costco.ca Universal Value Sorter (v4.1 - Fix Legacy Sort)
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Universal support for Costco.ca. Fixes sorting on Vitamin/Legacy pages.
// @match        https://www.costco.ca/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // 1. DATA PARSING (UNIVERSAL)
    // =========================================================

    function getTextFromSelectors(card, selectors) {
        for (let selector of selectors) {
            const el = card.querySelector(selector);
            if (el && el.innerText.trim()) return el.innerText;
        }
        return null;
    }

    function parseCardData(card) {
        // --- STEP 1: GET PRICE ---
        const priceTextRaw = getTextFromSelectors(card, [
            '[data-testid^="Text_Price_"]',
            '[automation-id^="itemPriceOutput_"]',
            '.price'
        ]);

        if (!priceTextRaw) return null;

        const cleanPrice = priceTextRaw.toLowerCase().replace(/[$,]/g, '').match(/(\d+\.\d{2})/);
        const price = cleanPrice ? parseFloat(cleanPrice[0]) : null;

        if (!price) return null;

        // --- STEP 2: GET TITLE ---
        const titleText = getTextFromSelectors(card, [
            '[data-testid^="Text_ProductTile_"][id$="_title"]',
            '[automation-id^="productDescriptionLink_"]',
            '.description a'
        ]);

        if (!titleText) return null;

        const title = titleText.toLowerCase();

        // --- STEP 3: EXTRACT QUANTITY ---
        let measure = null;

        const weightUnits = "g|kg|ml|l|lb|oz";
        const countUnits = [
            "pairs?", "packs?", "counts?", "cnt", "bars?", "cans?", "bottles?",
            "eggs?", "sheets?", "rolls?", "pods?", "pads?", "sachets?",
            "cartridges?", "refills?",
            "gumm(y|ies)", "tablets?", "capsules?", "softgels?", "caplets?", "lozenges?", "chewables?"
        ].join("|");

        const mathRegex = new RegExp(`(\\d+)\\s*[x×]\\s*([0-9,.]+)\\s*(${weightUnits}|${countUnits})\\b`);
        const mathMatch = title.match(mathRegex);

        const weightRegex = new RegExp(`(?:\\b|^)([0-9,.]+)\\s*(${weightUnits})\\b`);
        const weightMatch = title.match(weightRegex);

        const countRegex = new RegExp(`(\\d+)\\s*[-]?\\s*(${countUnits})\\b`);
        const countMatch = title.match(countRegex);

        if (mathMatch) {
            let count = parseFloat(mathMatch[1]);
            let unitSize = parseFloat(mathMatch[2]);
            let unit = mathMatch[3];
            let isWeight = new RegExp(`^(${weightUnits})$`).test(unit);

            if(isWeight) {
                measure = { qty: count * unitSize, unit: unit, type: 'math' };
            } else {
                let normalizedUnit = normalizeUnit(unit);
                measure = { qty: count * unitSize, unit: normalizedUnit, type: 'count' };
            }
        }
        else if (weightMatch) {
            let qty = parseFloat(weightMatch[1].replace(/,/g, ''));
            let unit = weightMatch[2];

            if (countMatch) {
                let count = parseFloat(countMatch[1]);
                if (count > 1) {
                    if ((unit === 'g' && qty < 500) || (unit === 'ml' && qty < 600)) {
                         qty = qty * count;
                    }
                }
            }
            measure = { qty, unit, type: 'weight' };
        }
        else if (countMatch) {
            let qty = parseFloat(countMatch[1]);
            let unitString = countMatch[2];
            let normalizedUnit = normalizeUnit(unitString);
            measure = { qty, unit: normalizedUnit, type: 'count' };
        }

        // --- STEP 4: CALCULATE VALUE ---
        if (measure) {
            let val = 0;
            let type = 'weight';
            let q = measure.qty;
            let u = measure.unit;

            if (measure.type === 'count') {
                val = (price / q);
                type = 'each';
            } else {
                if (u === 'g') val = (price / q) * 100;
                else if (u === 'kg') val = (price / (q * 1000)) * 100;
                else if (u === 'ml') { val = (price / q) * 100; type = 'vol'; }
                else if (u === 'l') { val = (price / (q * 1000)) * 100; type = 'vol'; }
                else if (u === 'lb') val = (price / (q * 453.592)) * 100;
                else if (u === 'oz') val = (price / (q * 28.3495)) * 100;
                else { val = (price / q); type = 'each'; }
            }

            if (val > 0 && val < 99999) {
                return {
                    val: val,
                    label: formatLabel(val, type, u),
                    type: type
                };
            }
        }

        return null;
    }

    function normalizeUnit(unitString) {
        const s = unitString.toLowerCase();
        if (s.startsWith('pair')) return 'pair';
        if (s.startsWith('cartridge')) return 'cartridge';
        if (s.startsWith('refill')) return 'refill';
        if (s.startsWith('gumm')) return 'gummy';
        if (s.startsWith('tablet')) return 'tablet';
        if (s.startsWith('capsule')) return 'capsule';
        if (s.startsWith('softgel')) return 'softgel';
        if (s.startsWith('caplet')) return 'caplet';
        if (s.startsWith('lozenge')) return 'lozenge';
        if (s.startsWith('chewable')) return 'chewable';
        if (s.startsWith('sachet')) return 'sachet';
        if (s.startsWith('bar')) return 'bar';
        if (s.startsWith('bottle')) return 'bottle';
        if (s.startsWith('can')) return 'can';
        if (s.startsWith('roll')) return 'roll';
        return 'ea';
    }

    function formatLabel(val, type, specificUnit) {
        if (type === 'each') {
            if (specificUnit !== 'ea') return `$${val.toFixed(2)}/${specificUnit}`;
            return `$${val.toFixed(2)}/ea`;
        }
        if (type === 'vol') return `$${val.toFixed(2)}/100ml`;
        return `$${val.toFixed(2)}/100g`;
    }

    // =========================================================
    // 2. VISUALS
    // =========================================================

    function badgeItem(card) {
        if(card.dataset.tmBadged) return;

        const data = parseCardData(card);
        if (!data) return;

        const badge = document.createElement("div");
        badge.innerText = data.label;

        Object.assign(badge.style, {
            position: "absolute", top: "0", right: "0",
            padding: "4px 8px", fontSize: "14px", fontWeight: "bold",
            zIndex: "10", borderBottomLeftRadius: "4px",
            boxShadow: "-1px 1px 3px rgba(0,0,0,0.2)",
            fontFamily: "Helvetica, Arial, sans-serif"
        });

        if (data.type === 'vol') {
            badge.style.background = "#e3f2fd"; badge.style.color = "#0d47a1"; badge.style.border = "1px solid #90caf9";
        } else if (data.type === 'each') {
            badge.style.background = "#fff3e0"; badge.style.color = "#e65100"; badge.style.border = "1px solid #ffcc80";
        } else {
            badge.style.background = "#e8f5e9"; badge.style.color = "#1b5e20"; badge.style.border = "1px solid #a5d6a7";
        }

        // Try Image Container A (MUI) or B (Legacy)
        let target = card.querySelector('[data-testid^="ProductImage_"]') || card.querySelector('.product-img-holder');

        if (!target) {
            card.style.position = 'relative';
            card.appendChild(badge);
        } else {
            target.style.position = 'relative';
            target.appendChild(badge);
        }

        card.dataset.tmBadged = "true";
        card.dataset.tmVal = data.val;
    }

    // =========================================================
    // 3. SORTING ENGINE (UNIVERSAL)
    // =========================================================

    function processBatch() {
        // Selector A: Modern Grid Items
        const modernCards = document.querySelectorAll('div[data-testid^="ProductTile_"]');
        // Selector B: Legacy Grid Items (exclude spacers/ads)
        const legacyCards = document.querySelectorAll('[automation-id="productList"] .product');

        modernCards.forEach(badgeItem);
        legacyCards.forEach(badgeItem);
    }

    function sortItems() {
        processBatch();

        // --- SCENARIO 1: MODERN REACT GRID ---
        // Used for Raisins, Socks, etc.
        const modernGrid = document.querySelector('[data-testid="Grid"]');
        const modernWrapper = document.getElementById('productList');

        if (modernWrapper && modernGrid && modernWrapper.contains(modernGrid)) {
            console.log("TM: Detected Modern Layout");
            let items = Array.from(modernGrid.children);
            let productWrappers = items.filter(item => item.querySelector('[data-tm-val]'));
            let otherItems = items.filter(item => !item.querySelector('[data-tm-val]'));

            productWrappers.sort((a, b) => {
                // In Modern layout, value is deep inside the wrapper
                const cardA = a.querySelector('[data-tm-val]');
                const cardB = b.querySelector('[data-tm-val]');
                const valA = cardA ? parseFloat(cardA.dataset.tmVal) : 999999;
                const valB = cardB ? parseFloat(cardB.dataset.tmVal) : 999999;
                return valA - valB;
            });

            const frag = document.createDocumentFragment();
            productWrappers.forEach(item => frag.appendChild(item));
            otherItems.forEach(item => frag.appendChild(item));
            modernGrid.appendChild(frag);
            return;
        }

        // --- SCENARIO 2: LEGACY LAYOUT (BOOTSTRAP FLOATS) ---
        // Used for Vitamins, Razors, etc.
        const legacyGrid = document.querySelector('[automation-id="productList"]');
        if (legacyGrid) {
            console.log("TM: Detected Legacy Layout");
            // Grab only the product columns
            let items = Array.from(legacyGrid.querySelectorAll('.product'));

            items.sort((a, b) => {
                // In Legacy layout, value is ON the item itself because we passed '.product' to badgeItem
                const valA = a.dataset.tmVal ? parseFloat(a.dataset.tmVal) : 999999;
                const valB = b.dataset.tmVal ? parseFloat(b.dataset.tmVal) : 999999;
                return valA - valB;
            });

            // TRANSFORM CSS: Convert old float layout to Flexbox
            legacyGrid.style.display = 'flex';
            legacyGrid.style.flexWrap = 'wrap';
            legacyGrid.style.alignItems = 'stretch';
            legacyGrid.className += " tm-flex-override";

            // Clear grid
            legacyGrid.innerHTML = "";

            const frag = document.createDocumentFragment();
            items.forEach(item => {
                item.style.float = "none";
                item.style.height = "auto";
                frag.appendChild(item);
            });
            legacyGrid.appendChild(frag);
            return;
        }

        console.log("TM: No Sortable Grid Found");
    }

    // =========================================================
    // 4. UI
    // =========================================================

    function initUI() {
        if(document.getElementById('tm-sort-btn')) return;

        const btn = document.createElement("button");
        btn.id = "tm-sort-btn";
        btn.innerHTML = "Sort by Value";
        Object.assign(btn.style, {
            position: "fixed", bottom: "20px", left: "20px", zIndex: "99999",
            padding: "12px 20px", background: "#3071a9", color: "white",
            border: "2px solid #e31837", borderRadius: "4px", fontWeight: "bold",
            cursor: "pointer", boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
            fontSize: "14px", fontFamily: "Arial, sans-serif"
        });

        btn.onclick = () => {
            const originalText = btn.innerHTML;
            btn.innerHTML = "Sorting...";
            btn.style.background = "#e31837";
            setTimeout(() => { sortItems(); btn.innerHTML = originalText; btn.style.background = "#3071a9"; }, 50);
        };

        document.body.appendChild(btn);
    }

    setTimeout(() => {
        initUI();
        processBatch();
        const observer = new MutationObserver(() => processBatch());
        const targetNode = document.body;
        observer.observe(targetNode, { childList: true, subtree: true });
    }, 2000);

})();
