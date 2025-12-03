// ==UserScript==
// @name         Walmart.ca Value Sorter (v9.1 - Socks & General Each)
// @namespace    http://tampermonkey.net/
// @version      9.1
// @description  Sorts by value. Enhanced for Socks (Pairs), Clothing, Razors, Counts, Weights, and Volumes.
// @match        https://www.walmart.ca/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // 1. DATA PARSING
    // =========================================================

    function parseCardData(card) {
        // --- STEP 1: DETECT DEALS (e.g. 3 for $10) ---
        let dealPrice = null;
        let isDeal = false;

        const cardText = card.innerText.toLowerCase().replace(/[\r\n]+/g, " ");
        // Regex for "2 for $10" or "2/$10"
        const multiBuyMatch = cardText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);

        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) {
                dealPrice = total / qty;
                isDeal = true;
            }
        }

        // --- STEP 2: TRY OFFICIAL UNIT PRICE (Best for Grocery/Chemicals) ---
        const unitPriceDiv = card.querySelector('[data-testid="product-price-per-unit"]');

        if (unitPriceDiv && !isDeal) {
            const text = unitPriceDiv.innerText.toLowerCase().trim();
            // Looks for: $0.50 / 100ml
            const match = text.match(/([$¢c]?)\s*([0-9,.]+)\s*(?:[$¢c]?)\s*\/\s*([0-9]*)\s*(g|ml|lb|ea|kg|l)/);

            if (match) {
                let val = 0;
                let type = 'weight';

                const currency = match[1] || "";
                let numeric = parseFloat(match[2].replace(/,/g, ''));
                let measureQty = parseFloat(match[3]) || 1;
                const unit = match[4];

                if (currency === 'c' || currency === '¢' || text.includes('¢')) {
                    numeric = numeric / 100;
                }

                if (unit === 'g') val = (numeric / measureQty) * 100;
                else if (unit === 'kg') val = (numeric / measureQty) / 10;
                else if (unit === 'ml') { val = (numeric / measureQty) * 100; type = 'vol'; }
                else if (unit === 'l') { val = (numeric / measureQty) / 10; type = 'vol'; }
                else if (unit === 'lb') val = (numeric / measureQty) * 22.0462;
                else if (unit === 'ea') { val = (numeric / measureQty); type = 'each'; }

                if (val > 0) {
                    return { val, label: formatLabel(val, type), type, isDeal: false };
                }
            }
        }

        // --- STEP 3: MANUAL CALCULATION (Socks, Razors, Counts) ---
        // 3a. Get Price
        let price = dealPrice;
        if (!price) {
            const priceElement = card.querySelector('[data-automation-id="product-price"] div[aria-hidden="true"]');
            if (priceElement) {
                 const pMatch = priceElement.innerText.match(/\$([0-9,.]+)/);
                 if (pMatch) price = parseFloat(pMatch[1].replace(/,/g, ''));
            }
        }

        if (!price) return null;

        // 3b. Parse Title for Quantities
        const titleElement = card.querySelector('[data-automation-id="product-title"]');
        if (!titleElement) return null;

        const title = titleElement.innerText.toLowerCase();
        let measure = null;

        // --- Regex Strategy ---

        // 1. Weight/Volume (e.g., 900g, 2x500ml)
        const weightMatch = title.match(/(?:\b([0-9]+)\s*[x×]\s*)?([0-9,.]+)\s*(g|kg|ml|l|lb|oz)\b/);

        // 2. "Pack of X" (e.g., Pack of 6)
        const packOfMatch = title.match(/pack\s+of\s+([0-9]+)/);

        // 3. General Counts (20-Pack, 6 Pairs, 100ct, 5 Refills)
        // Handles hyphens like "20-pack" and spaces like "20 pack"
        const countKeywords = "pairs?|pr|pack|pk|count|ct|eggs?|sheets|rolls|pods|pads|diapers|wieners|refills?|cartridges?|pcs|sets|briefs|boxers|tees";
        const countMatch = title.match(new RegExp(`\\b([0-9]+)\\s*[-]?\\s*(${countKeywords})\\b`, 'i'));

        if (weightMatch) {
            let qty = parseFloat(weightMatch[2].replace(/,/g, ''));
            let unit = weightMatch[3];
            if (weightMatch[1]) qty = qty * parseFloat(weightMatch[1]);
            measure = { qty, unit, type: unit === 'ml' || unit === 'l' ? 'vol' : 'weight' };
        }
        else if (packOfMatch) {
             measure = { qty: parseFloat(packOfMatch[1]), unit: 'ea', type: 'each' };
        }
        else if (countMatch) {
            let qty = parseFloat(countMatch[1].replace(/,/g, ''));
            let unitStr = countMatch[2];
            let unitLabel = 'ea';

            // Normalize Labels
            if(unitStr.includes('pair') || unitStr === 'pr') unitLabel = 'pair';
            else if(unitStr.includes('refill')) unitLabel = 'refill';
            else if(unitStr.includes('cart')) unitLabel = 'cart';
            else if(unitStr.includes('roll')) unitLabel = 'roll';

            measure = { qty, unit: unitLabel, type: 'each' };
        }

        // --- Context Overrides (Socks/Clothing) ---
        // If we found a quantity (even just "20 pack"), but the title says "Socks", assume pairs.
        if (measure && measure.type === 'each' && (title.includes('socks') || title.includes('gloves'))) {
            measure.unit = 'pair';
        }

        if (measure) {
            let val = 0;
            let type = measure.type || 'weight';
            let q = measure.qty;

            // Math
            if (measure.unit === 'g') val = (price/q)*100;
            else if (measure.unit === 'kg') val = (price/(q*1000))*100;
            else if (measure.unit === 'ml') { val = (price/q)*100; type = 'vol'; }
            else if (measure.unit === 'l') { val = (price/(q*1000))*100; type = 'vol'; }
            else if (measure.unit === 'lb') val = (price/(q*453.6))*100;
            else if (measure.unit === 'oz') val = (price/(q*28.35))*100;
            else {
                // Each logic
                val = (price/q);
                type = 'each';
            }

            if (val < 9999) {
                return {
                    val: val,
                    label: formatLabel(val, type, measure.unit),
                    type: type,
                    isDeal: isDeal
                };
            }
        }

        return null;
    }

    function formatLabel(val, type, specificUnit) {
        if (type === 'each') {
            let unitLabel = 'ea';
            if (specificUnit && specificUnit !== 'ea') unitLabel = specificUnit;
            // Clean up plurals for label
            unitLabel = unitLabel.replace(/s$/, ''); 
            return `$${val.toFixed(2)}/${unitLabel}`;
        }
        return `$${val.toFixed(2)}/${type === 'vol' ? '100ml' : '100g'}`;
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
            position: "absolute",
            top: "38px",
            right: "0",
            padding: "4px 6px", fontSize: "13px", fontWeight: "800",
            zIndex: "80",
            borderTopLeftRadius: "6px", borderBottomLeftRadius: "6px",
            boxShadow: "-1px 2px 4px rgba(0,0,0,0.2)",
            fontFamily: "sans-serif"
        });

        // Color Logic
        if (data.isDeal) {
            badge.style.background = "#FFFAF0";
            badge.style.color = "#975A16";
            badge.style.border = "1px solid #D69E2E";
            badge.innerText += " (Deal)";
        } else if (data.type === 'vol') {
            badge.style.background = "#EBF8FF"; badge.style.color = "#2B6CB0";
        } else if (data.type === 'each') {
            badge.style.background = "#FAF5FF"; badge.style.color = "#553C9A"; // Purple for Count items
        } else {
            badge.style.background = "#F0FFF4"; badge.style.color = "#22543D";
        }

        // Attach to image container if possible for cleaner look
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
