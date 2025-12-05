// ==UserScript==
// @name         Costco.ca Universal Value Sorter (v5.0 - Modular Core)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Sorts by value using the Garts-Great-Tools Core Module. Includes Click-to-Edit for manual quantity overrides.
// @match        https://www.costco.ca/*
// @require      https://gartkb.github.io/Garts-Great-Tools/userscript/tm-value-sorter-core.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // 1. DATA PARSING
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

        // --- STEP 3: CALL CORE MODULE ---
        if (window.ValueSorter) {
            // Costco rarely lists a "shelf unit price" on the listing card itself,
            // so we pass null for the 3rd argument.
            const result = window.ValueSorter.analyze(titleText, price, null);
            
            if (result) {
                result.priceUsed = price; // Store for manual calculation
                return result;
            }
        }

        // Fallback for manual entry if parsing fails
        return {
            val: 99999,
            label: "Set Qty",
            type: 'unknown',
            isDeal: false,
            priceUsed: price
        };
    }

    // =========================================================
    // 2. VISUALS & INTERACTION
    // =========================================================

    function badgeItem(card) {
        if(card.dataset.tmManual) return; // Don't overwrite manual edits

        const data = parseCardData(card);
        
        // Remove old badge if exists
        const existingBadge = card.querySelector('.tm-badge');
        if (existingBadge) existingBadge.remove();

        if (!data) return;

        const badge = document.createElement("div");
        badge.className = "tm-badge";
        badge.innerText = data.label;

        // --- CALCULATE DETECTED QUANTITY FOR TOOLTIP ---
        let tooltip = "Click to set manual quantity";
        if (data.priceUsed && data.val > 0 && data.val < 99999) {
            let qty = 0;
            if (data.type === 'each') {
                qty = data.priceUsed / data.val;
            } else {
                // Weight/Vol is normalized to 100g/100ml
                qty = (data.priceUsed / data.val) * 100;
            }
            // Round to handle floating point errors
            qty = Math.round(qty * 100) / 100;
            
            let unitLabel = data.type === 'each' ? 'items' : (data.type === 'vol' ? 'ml' : 'g');
            tooltip = `Detected: ${qty} ${unitLabel}\nPrice: $${data.priceUsed.toFixed(2)}\nClick to edit`;
        }
        badge.title = tooltip;

        Object.assign(badge.style, {
            position: "absolute", top: "0", right: "0",
            padding: "4px 8px", fontSize: "14px", fontWeight: "bold",
            zIndex: "10", borderBottomLeftRadius: "4px",
            boxShadow: "-1px 1px 3px rgba(0,0,0,0.2)",
            fontFamily: "Helvetica, Arial, sans-serif",
            cursor: "pointer"
        });

        // Colors
        if (data.type === 'unknown') {
             badge.style.background = "#eee"; badge.style.color = "#555";
        } else if (data.type === 'vol') {
            badge.style.background = "#e3f2fd"; badge.style.color = "#0d47a1"; badge.style.border = "1px solid #90caf9";
        } else if (data.type === 'each') {
            badge.style.background = "#fff3e0"; badge.style.color = "#e65100"; badge.style.border = "1px solid #ffcc80";
        } else {
            badge.style.background = "#e8f5e9"; badge.style.color = "#1b5e20"; badge.style.border = "1px solid #a5d6a7";
        }

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

        // DOM Placement: Try Image Container A (MUI) or B (Legacy)
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
        const modernGrid = document.querySelector('[data-testid="Grid"]');
        const modernWrapper = document.getElementById('productList');

        if (modernWrapper && modernGrid && modernWrapper.contains(modernGrid)) {
            console.log("TM: Detected Modern Layout");
            let items = Array.from(modernGrid.children);
            let productWrappers = items.filter(item => item.querySelector('[data-tm-val]'));
            let otherItems = items.filter(item => !item.querySelector('[data-tm-val]'));

            productWrappers.sort((a, b) => {
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
        const legacyGrid = document.querySelector('[automation-id="productList"]');
        if (legacyGrid) {
            console.log("TM: Detected Legacy Layout");
            let items = Array.from(legacyGrid.querySelectorAll('.product'));

            items.sort((a, b) => {
                const valA = a.dataset.tmVal ? parseFloat(a.dataset.tmVal) : 999999;
                const valB = b.dataset.tmVal ? parseFloat(b.dataset.tmVal) : 999999;
                return valA - valB;
            });

            // TRANSFORM CSS: Convert old float layout to Flexbox
            legacyGrid.style.display = 'flex';
            legacyGrid.style.flexWrap = 'wrap';
            legacyGrid.style.alignItems = 'stretch';
            legacyGrid.className += " tm-flex-override";

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
