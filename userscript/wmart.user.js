// ==UserScript==
// @name         Walmart.ca Value Sorter (v11.0 - Click-to-Edit)
// @namespace    http://tampermonkey.net/
// @version      11.0
// @description  Sorts by value. Includes Click-to-Edit for manual quantity overrides and Smart Tooltips.
// @match        https://www.walmart.ca/*
// @require      https://gartkb.github.io/Garts-Great-Tools/userscript/tm-value-sorter-core.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // 1. DATA PARSING
    // =========================================================

    function parseCardData(card) {
        // --- STEP 1: GET PRICE (Handle Multi-buys) ---
        let price = null;
        let isDealPrice = false;

        const cardText = card.innerText.toLowerCase().replace(/[\r\n]+/g, " ");

        // Check for "2 for $10" type deals
        const multiBuyMatch = cardText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);
        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) {
                price = total / qty;
                isDealPrice = true;
            }
        }

        // Fallback to standard price
        if (!price) {
            const priceElement = card.querySelector('[data-automation-id="product-price"] div[aria-hidden="true"]');
            if (priceElement) {
                 const pMatch = priceElement.innerText.match(/\$([0-9,.]+)/);
                 if (pMatch) price = parseFloat(pMatch[1].replace(/,/g, ''));
            }
        }

        if (!price) return null;

        // --- STEP 2: GET TITLE ---
        const titleElement = card.querySelector('[data-automation-id="product-title"]');
        if (!titleElement) return null;
        const title = titleElement.innerText;

        // --- STEP 3: OPTIONAL - GET SHELF UNIT PRICE (For Deal Detection) ---
        let shelfUnitVal = null;
        const unitPriceDiv = card.querySelector('[data-testid="product-price-per-unit"]');
        if (unitPriceDiv && !isDealPrice) {
            const text = unitPriceDiv.innerText.toLowerCase().trim();
            // Looks for: $0.50 / 100ml
            const match = text.match(/([0-9,.]+)\s*(?:[$¢c]?)\s*\/\s*([0-9]*)\s*(g|ml|lb|ea|kg|l)/);
            if (match) {
                let rawVal = parseFloat(match[1].replace(/,/g, ''));
                if (text.includes('¢') || text.includes(' c')) rawVal = rawVal / 100;
                shelfUnitVal = rawVal; 
            }
        }

        // --- STEP 4: CALL THE CORE MODULE ---
        if (window.ValueSorter) {
            const result = window.ValueSorter.analyze(title, price, shelfUnitVal);
            if (result) {
                result.isDeal = result.isDeal || isDealPrice; // Combine multi-buy deal flag
                result.priceUsed = price; // Store for manual override logic
                return result;
            }
        }

        // Fallback for Manual Entry availability even if parsing fails
        return {
            val: 99999,
            label: "Set Qty",
            type: 'unknown',
            isDeal: isDealPrice,
            priceUsed: price
        };
    }

    // =========================================================
    // 2. VISUALS & INTERACTION
    // =========================================================

    function badgeItem(card) {
        // Prevent overwriting manual edits or re-badging
        if(card.dataset.tmManual) return;
        if(card.dataset.tmBadged) return;

        const data = parseCardData(card);
        if (!data) return;

        const badge = document.createElement("div");
        badge.innerText = data.label;

        // --- TOOLTIP LOGIC ---
        let tooltip = "Click to set manual quantity";
        if (data.priceUsed && data.val > 0 && data.val < 99999) {
            let qty = 0;
            if (data.type === 'each') {
                qty = data.priceUsed / data.val;
            } else {
                // Weight/Vol is normalized to 100g/100ml in the core
                qty = (data.priceUsed / data.val) * 100;
            }
            qty = Math.round(qty * 100) / 100;
            let unitLabel = data.type === 'each' ? 'items' : (data.type === 'vol' ? 'ml' : 'g');
            tooltip = `Detected: ${qty} ${unitLabel}\nPrice: $${data.priceUsed.toFixed(2)}\nClick to edit`;
        }
        badge.title = tooltip;

        Object.assign(badge.style, {
            position: "absolute",
            top: "38px",
            right: "0",
            padding: "4px 6px", fontSize: "13px", fontWeight: "800",
            zIndex: "80",
            borderTopLeftRadius: "6px", borderBottomLeftRadius: "6px",
            boxShadow: "-1px 2px 4px rgba(0,0,0,0.2)",
            fontFamily: "sans-serif",
            cursor: "pointer" // Make it clickable
        });

        // Color Logic
        if (data.type === 'unknown') {
             badge.style.background = "#eee"; badge.style.color = "#555";
        } else if (data.isDeal) {
            badge.style.background = "#FFFAF0";
            badge.style.color = "#975A16";
            badge.style.border = "1px solid #D69E2E";
            badge.innerText += " (Deal)";
        } else if (data.type === 'vol') {
            badge.style.background = "#EBF8FF"; badge.style.color = "#2B6CB0";
        } else if (data.type === 'each') {
            badge.style.background = "#FAF5FF"; badge.style.color = "#553C9A";
        } else {
            badge.style.background = "#F0FFF4"; badge.style.color = "#22543D";
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
                
                // Update sorting values
                card.dataset.tmVal = newVal;
                card.dataset.tmManual = "true";
            }
        };

        // Attach to image container
        let target = card.querySelector('[data-testid="item-stack-product-image-flag-container"]');
        if (target) {
            target.appendChild(badge);
        } else {
            card.style.position = 'relative';
            card.appendChild(badge);
        }

        card.dataset.tmBadged = "true";
        card.dataset.tmVal = data.val;
    }

    // =========================================================
    // 3. SORTING ENGINE
    // =========================================================

    function processBatch() {
        const cards = document.querySelectorAll('div[role="group"]');
        cards.forEach(card => {
            if (card.querySelector('[data-automation-id="product-title"]')) {
                badgeItem(card);
            }
        });
    }

    function sortItems() {
        processBatch();
        const grid = document.querySelector('[data-testid="item-stack"]');
        if (!grid) { console.log("TM: Grid not found"); return; }

        let items = Array.from(grid.children);

        items.sort((a, b) => {
            const cardA = a.querySelector('[data-tm-val]');
            const cardB = b.querySelector('[data-tm-val]');
            // Push items without value to the bottom
            const valA = cardA ? parseFloat(cardA.dataset.tmVal) : 999999;
            const valB = cardB ? parseFloat(cardB.dataset.tmVal) : 999999;
            return valA - valB;
        });

        const frag = document.createDocumentFragment();
        items.forEach(item => frag.appendChild(item));
        grid.appendChild(frag);
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
            padding: "10px 16px", background: "#0071dc", color: "#fff",
            border: "2px solid #ffc220", borderRadius: "20px", fontWeight: "bold",
            cursor: "pointer", boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
            fontSize: "14px"
        });

        btn.onclick = () => {
            const originalText = btn.innerHTML;
            btn.innerHTML = "Sorting...";
            btn.style.background = "#005bb5";
            setTimeout(() => { 
                sortItems(); 
                btn.innerHTML = originalText; 
                btn.style.background = "#0071dc";
            }, 50);
        };
        document.body.appendChild(btn);
    }

    // Wait for dynamic content
    setTimeout(() => {
        initUI();
        processBatch();
        const observer = new MutationObserver(() => processBatch());
        observer.observe(document.body, { childList: true, subtree: true });
    }, 1500);

})();
