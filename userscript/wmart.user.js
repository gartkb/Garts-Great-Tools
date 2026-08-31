// ==UserScript==
// @name         Walmart.ca Value Sorter (v11.2 - Antiperspirant Fix)
// @namespace    http://tampermonkey.net/
// @version      11.2
// @description  Sorts by value. Fixes: robust price/shelf selectors, decimal sizes, sale price handling, multipack (2 Pack) weight, sanity check on shelf fallback.
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
        // --- STEP 1: GET PRICE (Handle Multi-buys + Sale) ---
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

        // Fallback to standard price - try multiple selectors (Walmart DOM has shifted)
        if (!price) {
            // Try 1: original selector
            let priceElement = card.querySelector('[data-automation-id="product-price"] div[aria-hidden="true"]');
            // Try 2: new data-testid container
            if (!priceElement) priceElement = card.querySelector('[data-testid="product-price"] [aria-hidden="true"]');
            // Try 3: any bold price in card (SSR uses .b.black)
            if (!priceElement) priceElement = card.querySelector('.b.black[aria-hidden="true"]');
            // Try 4: fallback - first $X.XX in the price area
            if (priceElement) {
                const pMatch = priceElement.innerText.match(/\$([0-9,.]+)/);
                if (pMatch) price = parseFloat(pMatch[1].replace(/,/g, ''));
            } else {
                // Last resort: scan card text for "current price $X" or first $ price
                // Prefer "Now $X" / "current price $X" over "Was $X"
                let nowMatch = cardText.match(/now\s*\$([0-9,.]+)/);
                if (nowMatch) {
                    price = parseFloat(nowMatch[1].replace(/,/g, ''));
                } else {
                    let curMatch = cardText.match(/current price\s*\$([0-9,.]+)/);
                    if (curMatch) price = parseFloat(curMatch[1].replace(/,/g, ''));
                }
            }
        }

        if (!price) return null;

        // --- STEP 2: GET TITLE ---
        const titleElement = card.querySelector('[data-automation-id="product-title"]');
        if (!titleElement) return null;
        let title = titleElement.innerText;

        // --- STEP 3: GET SHELF UNIT PRICE (For Deal Detection + Fallback) ---
        let shelfUnitVal = null;
        let shelfUnitQty = null;
        let shelfUnitType = null;

        // Try multiple selectors - data-testid is flaky in SSR, class .gray is more stable
        let unitPriceDiv = card.querySelector('[data-testid="product-price-per-unit"]');
        if (!unitPriceDiv) {
            // SSR fallback: the gray unit price div
            const candidates = card.querySelectorAll('div.gray, span.gray, div.f6');
            for (const c of candidates) {
                if (c.innerText && /\/\s*100?\s*(g|ml|ea|kg|l)/i.test(c.innerText)) {
                    unitPriceDiv = c;
                    break;
                }
            }
        }
        // Final fallback: scan all text for pattern like "$10.23/100g" or "5¢/100g" near price
        let unitText = unitPriceDiv ? unitPriceDiv.innerText.toLowerCase().trim() : "";

        // If we still have no unitText but cardText contains a shelf-like pattern, try to extract it
        // This catches cases where data-testid is missing
        if (!unitText) {
            // Look for something like "$8.84/100g" or "5¢/100g" that is NOT the main price
            const shelfScan = cardText.match(/([0-9.]+\s*(?:¢|c)?\s*\/\s*[0-9]*\s*(?:g|ml|ea|kg|l|100g|100ml))/i);
            if (shelfScan) unitText = shelfScan[0];
        }

        if (unitText && !isDealPrice) {
            // Robust: handles "$10.23/100g", "10.23/100g", "5¢/100g", "$5.21/100g", "6.56/100ml"
            // Group1: number, Group2: ¢/c suffix, Group3: denominator (100), Group4: unit
            const match = unitText.match(/([0-9,.]+)\s*([$¢c]?)\s*\/\s*([0-9]*)\s*(g|ml|lb|ea|kg|l)/i);
            if (match) {
                let rawVal = parseFloat(match[1].replace(/,/g, ''));
                let currencySuffix = match[2];

                if (currencySuffix === '¢' || currencySuffix === 'c' || unitText.includes('¢')) {
                    rawVal = rawVal / 100;
                }
                // If the text had a leading "$" but suffix is empty, rawVal is already dollars - keep as is
                // Guard against "5¢" mis-parsed as $5: already divided above

                shelfUnitVal = rawVal;
                shelfUnitQty = parseFloat(match[3]) || 1;
                // Special: if denominator is empty like "/ea" => qty 1
                // If denominator is 100 => qty 100 (meaning $X per 100g)
                if (shelfUnitQty === 0) shelfUnitQty = 1;
                shelfUnitType = match[4].toLowerCase();

                // Sanity: reject absurd shelf prices that would imply insane package size
                // e.g. 5¢/100g with $3.97 => 7940g is absurd for antiperspirant
                if (shelfUnitVal > 0 && shelfUnitVal < 0.10) {
                    // Likely a Walmart data bug (5¢ instead of $5.36) - invalidate to avoid bad estimate
                    // Only keep if price is also tiny (< $1)
                    if (price > 1.5) {
                        shelfUnitVal = null;
                        shelfUnitQty = null;
                        shelfUnitType = null;
                    }
                }
            }
        }

        // --- STEP 3.5: FIX MISSING SIZES IN TITLE (The Main Fix) ---
        // If the title doesn't contain a size, but we have total price & shelf unit price,
        // calculate the exact package size and artificially append it to the title string.
        // This ensures the Core Module (ValueSorter.analyze) can successfully process it!
        const hasSize = /[0-9]*\.?[0-9]+\s*(ml|g|kg|lb|l|oz)\b/i.test(title);
        if (!hasSize && price > 0 && shelfUnitVal > 0 && shelfUnitQty > 0 && shelfUnitType) {
            const estimatedSize = Math.round((price / shelfUnitVal) * shelfUnitQty);
            // Sanity: antiperspirants are 14g - 200g / 50ml - 150ml. Reject 7940g nonsense.
            if (estimatedSize >= 5 && estimatedSize <= 2000) {
                title += ` - ${estimatedSize}${shelfUnitType}`;
            }
        }

        // --- STEP 3.6: MULTIPACK FIX for "70 g (2 Pack)" where title HAS size but count is separate ---
        // ValueSorter core handles "2x 76 g" but not "70 g (2 Pack)". Inject total weight.
        // If title has weight AND a pack count, prefer total weight for sorting.
        // We do this by appending a math expression the core understands.
        const packMatch = title.match(/\(?\s*(\d+)\s*pack\s*\)?/i);
        const weightMatch = title.match(/([0-9]*\.?[0-9]+)\s*(g|ml)\b/i);
        if (hasSize && packMatch && weightMatch && !/x\s*[0-9]/i.test(title)) {
            const packCount = parseFloat(packMatch[1]);
            const singleWeight = parseFloat(weightMatch[1]);
            const unit = weightMatch[2];
            if (packCount > 1 && packCount <= 12 && singleWeight > 0) {
                // Append total that core's extractMath will prefer: "2x70g"
                title += ` (${packMatch[1]}x${singleWeight}${unit})`;
            }
        }

        // --- STEP 4: CALL THE CORE MODULE ---
        if (window.ValueSorter) {
            const result = window.ValueSorter.analyze(title, price, shelfUnitVal);
            if (result) {
                result.isDeal = result.isDeal || isDealPrice;
                result.priceUsed = price;
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
        if(card.dataset.tmManual) return;
        if(card.dataset.tmBadged) return;

        const data = parseCardData(card);
        if (!data) return;

        const badge = document.createElement("div");
        badge.innerText = data.label;

        let tooltip = "Click to set manual quantity";
        if (data.priceUsed && data.val > 0 && data.val < 99999) {
            let qty = 0;
            if (data.type === 'each') {
                qty = data.priceUsed / data.val;
            } else {
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
            cursor: "pointer"
        });

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

    setTimeout(() => {
        initUI();
        processBatch();
        const observer = new MutationObserver(() => processBatch());
        observer.observe(document.body, { childList: true, subtree: true });
    }, 1500);

})();
