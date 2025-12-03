// ==UserScript==
// @name         Walmart.ca Value Sorter (v9.0 - Razors & Refills)
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Sorts by value. Now handles Razors (Refills/Cartridges/CT), Clothing, Pairs, Counts, Weights, and Volumes.
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
        const multiBuyMatch = cardText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);

        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) {
                dealPrice = total / qty;
                isDeal = true;
            }
        }

        // --- STEP 2: TRY OFFICIAL UNIT PRICE (Best for Standard Items) ---
        // We prefer this unless we have a deal override.
        const unitPriceDiv = card.querySelector('[data-testid="product-price-per-unit"]');

        if (unitPriceDiv && !isDeal) {
            const text = unitPriceDiv.innerText.toLowerCase().trim();
            const match = text.match(/([$¢c]?)\s*([0-9,.]+)\s*(?:[$¢c]?)\s*\/\s*([0-9]*)\s*(g|ml|lb|ea|kg|l)/);

            if (match) {
                let val = 0;
                let type = 'weight';

                const currency = match[1] || "";
                let numeric = parseFloat(match[2].replace(/,/g, ''));
                let measureQty = parseFloat(match[3]) || 1;
                const unit = match[4];

                if (currency === 'c' || currency === '¢' || text.includes('¢') || (text.includes('c/') && !text.includes('$'))) {
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

        // --- STEP 3: MANUAL CALCULATION (Pairs, Eggs, Counts, Refills) ---
        let price = dealPrice;
        if (!price) {
            const priceElement = card.querySelector('[data-automation-id="product-price"] div[aria-hidden="true"]');
            if (priceElement) {
                 const pMatch = priceElement.innerText.match(/\$([0-9,.]+)/);
                 if (pMatch) price = parseFloat(pMatch[1].replace(/,/g, ''));
            }
        }

        if (!price) return null;

        // Parse Title for Quantities
        let measure = null;
        const titleElement = card.querySelector('[data-automation-id="product-title"]');

        if (titleElement) {
            const title = titleElement.innerText.toLowerCase();

            // 1. Weight/Volume (900 g)
            const weightMatch = title.match(/(?:\b([0-9]+)\s*[x×]\s*)?([0-9,.]+)\s*(g|kg|ml|l|lb|oz)\b/);

            // 2. Counts (12 Eggs, 6 Pairs, 30 Pack, 8CT, 5 Refills)
            // Updated to include 'refills', 'cartridges', 'pcs', and 'ct' (often attached like 8ct)
            const countKeywords = "pairs?|count|ct|pack|eggs?|sheets|rolls|pods|pads|diapers|wieners|refills?|cartridges?|pcs";
            const countMatch = title.match(new RegExp(`(?:\\b([0-9]+)\\s*[x×]\\s*)?([0-9,.]+)\\s*(${countKeywords})\\b`, 'i'));

            if (weightMatch) {
                let qty = parseFloat(weightMatch[2].replace(/,/g, ''));
                let unit = weightMatch[3];
                if (weightMatch[1]) qty = qty * parseFloat(weightMatch[1]);
                measure = { qty, unit };
            }
            else if (countMatch) {
                let qty = parseFloat(countMatch[2].replace(/,/g, ''));
                let unit = countMatch[3]; // Keep the specific unit (e.g. 'refills')
                if (countMatch[1]) qty = qty * parseFloat(countMatch[1]);
                measure = { qty, unit };
            }
        }

        if (measure) {
            let val = 0;
            let type = 'weight';
            let q = measure.qty;
            let u = measure.unit;

            // Math
            if (u === 'g') val = (price/q)*100;
            else if (u === 'kg') val = (price/(q*1000))*100;
            else if (u === 'ml') { val = (price/q)*100; type = 'vol'; }
            else if (u === 'l') { val = (price/(q*1000))*100; type = 'vol'; }
            else if (u === 'lb') val = (price/(q*453.6))*100;
            else if (u === 'oz') val = (price/(q*28.35))*100;
            else {
                // Handles: ea, eggs, pairs, packs, refills, ct, etc
                val = (price/q);
                type = 'each';
            }

            if (val < 9999) {
                return {
                    val: val,
                    label: formatLabel(val, type, u),
                    type: type,
                    isDeal: isDeal
                };
            }
        }

        return null;
    }

    function formatLabel(val, type, specificUnit) {
        if (type === 'each') {
            if (!specificUnit) return `$${val.toFixed(2)}/ea`;

            // Customize labels for razors/clothing
            if (specificUnit.startsWith('pair')) return `$${val.toFixed(2)}/pair`;
            if (specificUnit.includes('refill')) return `$${val.toFixed(2)}/refill`;
            if (specificUnit.includes('cartridge')) return `$${val.toFixed(2)}/cart`;

            return `$${val.toFixed(2)}/ea`;
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
            padding: "4px 6px", fontSize: "12px", fontWeight: "800",
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
            badge.style.background = "#FAF5FF"; badge.style.color = "#553C9A";
        } else {
            badge.style.background = "#F0FFF4"; badge.style.color = "#22543D";
        }

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
            padding: "10px 16px", background: "#0071dc", color: "fff",
            border: "2px solid #ffc220", borderRadius: "20px", fontWeight: "bold",
            cursor: "pointer", boxShadow: "0 4px 6px rgba(0,0,0,0.3)"
        });

        btn.onclick = () => {
            const originalText = btn.innerHTML;
            btn.innerHTML = "Sorting...";
            setTimeout(() => { sortItems(); btn.innerHTML = originalText; }, 50);
        };
        document.body.appendChild(btn);
    }

    setTimeout(() => {
        initUI();
        processBatch();
        const observer = new MutationObserver(() => processBatch());
        observer.observe(document.body, { childList: true, subtree: true });
    }, 1500);

})();
