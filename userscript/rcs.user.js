// ==UserScript==
// @name         Superstore Value Sorter (v16.3 - Mobile Layout Fix)
// @namespace    http://tampermonkey.net/
// @version      16.3
// @description  Sorts safely across lazy-loaded chunks while protecting ad banners and fixing mobile off-screen overflow.
// @match        https://www.realcanadiansuperstore.ca/*
// @require      https://gartkb.github.io/Garts-Great-Tools/userscript/tm-value-sorter-core.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // 0. GLOBAL STATE
    // =========================================================
    
    const getSavedBool = (key, def) => {
        const val = localStorage.getItem(key);
        if (val === null) return def;
        return val === 'true';
    };

    const STATE = {
        usePoints: getSavedBool('tm_vs_usePoints', true),
        badgePos: localStorage.getItem('tm_vs_badgePos') || 'top-left',
        loadMore: getSavedBool('tm_vs_loadMore', false)
    };

    function saveState() {
        localStorage.setItem('tm_vs_usePoints', STATE.usePoints);
        localStorage.setItem('tm_vs_badgePos', STATE.badgePos);
        localStorage.setItem('tm_vs_loadMore', STATE.loadMore);
    }

    // =========================================================
    // 1. DATA PARSING
    // =========================================================

    function parseCardData(card) {
        if (!card || !card.innerText) return null;

        const rawText = card.innerText.toLowerCase().replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

        let pointsValue = 0;
        const pointsMatch = rawText.match(/([0-9,]+)\s*pc optimum points/);
        if (pointsMatch) {
            pointsValue = parseFloat(pointsMatch[1].replace(/,/g, '')) / 1000;
        }

        const cleanForPrice = rawText
            .replace(/save\s*\$[0-9,.]+/g, "")
            .replace(/after limit\s*\$[0-9,.]+/g, "")
            .replace(/\$\s*[0-9,.]+\s*\/\s*[0-9.]*\s*[a-z]+/g, "") 
            .replace(/about\s*\$[0-9,.]+/g, ""); 

        let validPrices =[];
        
        const multiBuyMatch = rawText.match(/\b([0-9]+)\s*(?:for|\/)\s*\$([0-9,.]+)/);
        if (multiBuyMatch) {
            const qty = parseFloat(multiBuyMatch[1]);
            const total = parseFloat(multiBuyMatch[2].replace(/,/g, ''));
            if (qty > 0) validPrices.push(total / qty);
        }
        
        const priceRegex = /\$\s*([0-9,.]+)/g;
        let m;
        while ((m = priceRegex.exec(cleanForPrice)) !== null) {
            const val = parseFloat(m[1].replace(/,/g, ''));
            if (val > 0.1) validPrices.push(val);
        }

        let bestShelfPrice = validPrices.length > 0 ? Math.min(...validPrices) : null;
        
        let effectivePrice = bestShelfPrice;
        let hasPoints = false;
        if (bestShelfPrice && STATE.usePoints && pointsValue > 0) {
            effectivePrice = Math.max(0.01, bestShelfPrice - pointsValue);
            hasPoints = true;
        }

        const weightRegex = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:[xX]\s*(\d+(?:\.\d+)?))?\s*(g|kg|ml|l|lb|oz)\b/i;
        const weightMatch = rawText.match(weightRegex);

        if (weightMatch && effectivePrice) {
            let num1 = parseFloat(weightMatch[1]);
            let num2 = weightMatch[2] ? parseFloat(weightMatch[2]) : 1;
            const unit = weightMatch[3];

            if (num2 > 1 && Math.abs(num1 - num2) < 0.5) { num2 = 1; } 

            let totalUnits = num1 * num2;
            let normalizedUnits = totalUnits;
            let type = 'weight';
            let labelUnit = '100g';

            if (unit === 'kg') { normalizedUnits = totalUnits * 1000; }
            else if (unit === 'g') { normalizedUnits = totalUnits; }
            else if (unit === 'l') { normalizedUnits = totalUnits * 1000; type = 'vol'; labelUnit = '100ml'; }
            else if (unit === 'ml') { normalizedUnits = totalUnits; type = 'vol'; labelUnit = '100ml'; }
            else if (unit === 'lb') { normalizedUnits = totalUnits * 453.6; } 
            else if (unit === 'oz') { normalizedUnits = totalUnits * 28.35; }

            const unitPrice = (effectivePrice / normalizedUnits) * 100;
            
            return {
                val: unitPrice,
                label: `$${unitPrice.toFixed(2)}/${labelUnit}`,
                type: type,
                isDeal: false,
                hasPoints: hasPoints,
                priceUsed: effectivePrice
            };
        }

        const meatMatch = rawText.match(/\$\s*([0-9,.]+)\s*\/\s*([0-9.]*)\s*(kg|lb|g)\b/i);
        
        if (meatMatch) {
            let uPrice = parseFloat(meatMatch[1].replace(/,/g, ''));
            let uQty = parseFloat(meatMatch[2]) || 1; 
            let unit = meatMatch[3];
            let finalVal = 0;

            if (unit === 'kg') { finalVal = (uPrice / uQty) / 10; } 
            else if (unit === 'lb') { finalVal = (uPrice / uQty) / 4.53592; } 
            else if (unit === 'g') { finalVal = (uPrice / uQty) * 100; } 

            if (STATE.usePoints && pointsValue > 0) {
                 const aboutMatch = rawText.match(/about\s*\$([0-9,.]+)/);
                 if (aboutMatch) {
                     const aboutPrice = parseFloat(aboutMatch[1].replace(/,/g, ''));
                     if (aboutPrice > 0) {
                        const discountRatio = (aboutPrice - pointsValue) / aboutPrice;
                        if (discountRatio > 0 && discountRatio < 1) {
                            finalVal = finalVal * discountRatio;
                            hasPoints = true;
                        }
                     }
                 }
            }

            return {
                val: finalVal,
                label: `$${finalVal.toFixed(2)}/100g`,
                type: 'weight',
                isDeal: false,
                hasPoints: hasPoints, 
                priceUsed: uPrice 
            };
        }

        const storeUnitMatch = rawText.match(/\$\s*([0-9,.]+)\s*\/\s*([0-9.]*)\s*(ea|each|pk)/);
        
        if (storeUnitMatch) {
            const rawPrice = parseFloat(storeUnitMatch[1].replace(/,/g, ''));
            const uQty = parseFloat(storeUnitMatch[2]) || 1;
            
            let shelfUnitVal = rawPrice / uQty;
            if (effectivePrice && bestShelfPrice) {
                shelfUnitVal = shelfUnitVal * (effectivePrice / bestShelfPrice);
            }
            return {
                val: shelfUnitVal,
                label: `$${shelfUnitVal.toFixed(2)}/ea`,
                type: 'each',
                isDeal: false,
                hasPoints: hasPoints,
                priceUsed: effectivePrice
            };
        }

        if (effectivePrice) {
             return {
                val: 9999,
                label: "Set Qty",
                type: 'unknown',
                isDeal: false,
                hasPoints: hasPoints,
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
        if (card.dataset.tmManual) return; 

        try {
            const data = parseCardData(card);
            const oldBadge = card.querySelector('.tm-badge');
            if (oldBadge) oldBadge.remove();

            if (!data) return; 

            const badge = document.createElement("div");
            badge.className = 'tm-badge';
            badge.innerText = data.label;

            let tooltip = "Click to set manual quantity";
            if (data.priceUsed && data.val > 0) {
                let detectedQty = 0;
                if (data.type === 'each') detectedQty = data.priceUsed / data.val;
                else detectedQty = (data.priceUsed / data.val) * 100; 

                detectedQty = Math.round(detectedQty * 100) / 100;
                
                let unitLabel = data.type === 'each' ? 'items' : (data.type === 'vol' ? 'ml' : 'g');
                tooltip = `Detected: ${detectedQty} ${unitLabel}\nPrice: $${data.priceUsed.toFixed(2)}\nClick to edit`;
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
        } catch (err) {
            console.error("TM Sorter: Error processing card", card, err);
        }
    }

    function getGridContainer(gridElement) {
        if (!gridElement) return null;
        let bestNode = gridElement;
        let maxScore = 0;
        let maxChildren = 0;
        
        function traverse(node, depth) {
            if (!node || node.nodeType !== 1 || depth > 10) return;
            
            let childCount = node.children.length;
            if (childCount > 1) {
                let score = 0;
                for (let i = 0; i < childCount; i++) {
                    const txt = node.children[i].innerText || "";
                    if (txt.includes('$') || txt.includes('¢')) {
                        score++;
                    }
                }
                if (score > maxScore || (score === maxScore && childCount > maxChildren)) {
                    maxScore = score;
                    maxChildren = childCount;
                    bestNode = node;
                }
            }
            Array.from(node.children).forEach(child => traverse(child, depth + 1));
        }
        
        traverse(gridElement, 0);
        
        if (maxScore === 0) {
            let current = gridElement;
            while (current && current.children.length === 1) {
                current = current.children[0];
            }
            return current;
        }
        
        return bestNode;
    }

    function updateAllBadges() {
        const grids = Array.from(document.querySelectorAll('div[class*="product-grid-component"]'));
        const containers = grids.map(g => getGridContainer(g)).filter(Boolean);
        containers.forEach(container => {
            Array.from(container.children).forEach(card => badgeItem(card));
        });
    }

    function repositionAllBadges() {
        const badges = document.querySelectorAll('.tm-badge');
        badges.forEach(b => applyBadgePosition(b));
    }

    // =========================================================
    // 3. UI, LAZY LOADING, & INFINITE PAGINATION
    // =========================================================

    async function forceLoadAll() {
        return new Promise((resolve) => {
            const distance = 800; 
            const delay = 100;    
            let maxScrolls = 35;  
            let scrolls = 0;
            
            const startY = window.scrollY;

            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                scrolls++;

                if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 100 || scrolls >= maxScrolls) {
                    clearInterval(timer);
                    
                    const grid = document.querySelector('div[class*="product-grid-component"]');
                    if (grid) {
                        const topPos = grid.getBoundingClientRect().top + window.scrollY - 150;
                        window.scrollTo({ top: topPos, behavior: 'auto' });
                    } else {
                        window.scrollTo({ top: startY, behavior: 'auto' });
                    }
                    
                    setTimeout(resolve, 800);
                }
            }, delay);
        });
    }

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

        function createCheckRow(labelText, checked, onChange) {
            const row = document.createElement("div");
            row.style.display = "flex"; row.style.alignItems = "center"; row.style.gap = "6px";
            const box = document.createElement("input");
            box.type = "checkbox";
            box.checked = checked;
            box.style.cursor = "pointer";
            box.onchange = onChange;
            const lbl = document.createElement("span");
            lbl.innerText = labelText;
            row.appendChild(box);
            row.appendChild(lbl);
            return row;
        }

        const rowPoints = createCheckRow("Incl. Points", STATE.usePoints, (e) => {
            STATE.usePoints = e.target.checked;
            saveState(); 
            document.querySelectorAll('[data-tm-manual]').forEach(c => delete c.dataset.tmManual);
            updateAllBadges();
        });

        const rowLoadMore = createCheckRow("Load +1 Page", STATE.loadMore, (e) => {
            STATE.loadMore = e.target.checked;
            saveState();
        });

        const rowPos = document.createElement("div");
        rowPos.style.display = "flex"; rowPos.style.alignItems = "center"; rowPos.style.gap = "6px";
        const posSelect = document.createElement("select");
        Object.assign(posSelect.style, { fontSize: "11px", padding: "2px", borderRadius: "3px", cursor: "pointer" });
        const opts =[
            {v: 'top-left', t: 'Top Left'}, {v: 'top-right', t: 'Top Right'},
            {v: 'bottom-left', t: 'Btm Left'}, {v: 'bottom-right', t: 'Btm Right'},
            {v: 'mid-left', t: 'Mid Left'}, {v: 'mid-right', t: 'Mid Right'}
        ];
        opts.forEach(o => {
            const opt = document.createElement("option");
            opt.value = o.v; opt.innerText = o.t;
            if(o.v === STATE.badgePos) opt.selected = true;
            posSelect.appendChild(opt);
        });
        posSelect.onchange = (e) => {
            STATE.badgePos = e.target.value;
            saveState();
            repositionAllBadges();
        };
        rowPos.appendChild(posSelect);

        toggleWrapper.appendChild(rowPoints);
        toggleWrapper.appendChild(rowLoadMore);
        toggleWrapper.appendChild(rowPos);

        const btn = document.createElement("button");
        btn.innerHTML = "Sort by Value";
        Object.assign(btn.style, {
            padding: "8px 12px", background: "#2f855a", color: "fff",
            border: "2px solid #fff", borderRadius: "8px", fontWeight: "bold", cursor: "pointer",
            boxShadow: "0 4px 6px rgba(0,0,0,0.3)", fontFamily: "sans-serif"
        });
        
        btn.onclick = async () => {
            btn.disabled = true;

            try {
                btn.innerHTML = "Loading items...";
                await forceLoadAll();
                
                if (STATE.loadMore) {
                    btn.innerHTML = "Fetching +1 Page...";
                    await fetchNextPage();
                    await new Promise(r => setTimeout(r, 600));
                }

                btn.innerHTML = "Sorting...";
                await new Promise(r => setTimeout(r, 10)); 
                
                sortGlobal();

                btn.innerHTML = STATE.loadMore ? "Done! (+1 Page)" : "Done!";
                setTimeout(() => { btn.innerHTML = "Sort by Value"; }, 2000);
            } catch (e) {
                console.error("TM Sorter Error:", e);
                btn.innerHTML = "Error!";
                setTimeout(() => { btn.innerHTML = "Sort by Value"; }, 2000);
            } finally {
                btn.disabled = false;
            }
        };

        container.appendChild(toggleWrapper);
        container.appendChild(btn);
        document.body.appendChild(container);
    }

    async function fetchNextPage() {
        const nextLink = document.querySelector('a[aria-label="Next Page"]');
        if (!nextLink || nextLink.getAttribute('disabled')) return false;

        const url = nextLink.href;
        const response = await fetch(url);
        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");
        
        const newGridElement = doc.querySelector('div[class*="product-grid-component"]');
        const newContainer = getGridContainer(newGridElement);
        
        if (newContainer && newContainer.children.length > 0) {
            const cards = Array.from(newContainer.children);
            
            const currentGrids = Array.from(document.querySelectorAll('div[class*="product-grid-component"]'));
            const currentContainers = currentGrids.map(g => getGridContainer(g)).filter(Boolean);
            
            if (currentContainers.length > 0) {
                const currentContainer = currentContainers[0];
                cards.forEach(card => {
                    const importedCard = document.adoptNode(card);
                    currentContainer.appendChild(importedCard);
                    badgeItem(importedCard);
                });
            }
        } else {
            return false; 
        }

        const oldPagination = document.querySelector('div[aria-label="Pagination"]');
        const newPagination = doc.querySelector('div[aria-label="Pagination"]');
        
        if (oldPagination && newPagination) {
            oldPagination.innerHTML = newPagination.innerHTML;
        } else if (oldPagination) {
            oldPagination.style.display = 'none';
        }

        return true;
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
        
        const container = getGridContainer(grid);
        if (container && container.children.length > 0) {
            Array.from(container.children).forEach(badgeItem);
            gridObserver.observe(container, { childList: true });
            grid.dataset.tmObserved = "true";
        } else {
            const tempObserver = new MutationObserver(() => {
                const c = getGridContainer(grid);
                if (c && c.children.length > 0) {
                    tempObserver.disconnect();
                    Array.from(c.children).forEach(badgeItem);
                    gridObserver.observe(c, { childList: true });
                    grid.dataset.tmObserved = "true";
                }
            });
            tempObserver.observe(grid, { childList: true, subtree: true });
        }
    }

    function getCommonAncestor(elements) {
        if (elements.length === 0) return null;
        let ancestor = elements[0];
        for (let i = 1; i < elements.length; i++) {
            while (ancestor && !ancestor.contains(elements[i])) {
                ancestor = ancestor.parentElement;
            }
        }
        return ancestor;
    }

    function sortGlobal() {
        updateAllBadges();
        
        const grids = Array.from(document.querySelectorAll('div[class*="product-grid-component"]'));
        let containers = grids.map(g => getGridContainer(g)).filter(Boolean);
        
        containers = containers.filter(c => c.children.length > 0);
        if (containers.length === 0) return;

        // 1. Find the primary product grid to act as an anchor point
        const largestContainer = containers.reduce((a, b) => a.children.length > b.children.length ? a : b);
        
        // 2. Define a "Safe Zone" to prevent the Wormhole from consuming the entire page layout.
        let safeAncestor = largestContainer;
        let levels = 0;
        while (safeAncestor && safeAncestor.parentElement && levels < 5) {
            const parent = safeAncestor.parentElement;
            if (['BODY', 'MAIN', 'HEADER', 'FOOTER'].includes(parent.tagName)) break;
            
            if (parent.className && typeof parent.className === 'string') {
                const cn = parent.className.toLowerCase();
                // If we hit a major layout wrapper, stop climbing
                if (cn.includes('layout') || cn.includes('page-wrapper') || cn.includes('main-content') || cn.includes('sidebar')) {
                    break; 
                }
            }
            safeAncestor = parent;
            levels++;
        }

        // 3. Only group grids strictly inside the Safe Zone
        containers = containers.filter(c => safeAncestor.contains(c));
        if (containers.length === 0) return;

        let allCards =[];
        containers.forEach(container => {
            const validCards = Array.from(container.children).filter(c => c.nodeType === 1);
            allCards.push(...validCards);
        });

        if (allCards.length === 0) return;

        allCards.sort((a, b) => (parseFloat(a.dataset.tmVal)||99999) - (parseFloat(b.dataset.tmVal)||99999));
        
        allCards.forEach((c, index) => {
            c.style.order = index + 1;
        });

        // 4. Implement CSS Layout Wormhole to visually group React chunks
        if (containers.length > 1) {
            const firstContainer = containers[0];
            const computed = window.getComputedStyle(firstContainer);
            
            const commonParent = getCommonAncestor(containers);
            
            if (commonParent && commonParent !== document.body) {
                if (computed.display.includes('grid')) {
                    commonParent.style.display = 'grid';
                    
                    // --- MOBILE LAYOUT FIX ---
                    // Instead of copying rigid pixel values that break responsive layouts,
                    // we dynamically inject responsive columns based on screen width.
                    const isMobile = window.innerWidth <= 768;
                    const minWidth = isMobile ? '145px' : '220px';
                    commonParent.style.gridTemplateColumns = `repeat(auto-fill, minmax(${minWidth}, 1fr))`;
                    commonParent.style.width = '100%';
                    commonParent.style.boxSizing = 'border-box';
                    // -------------------------

                    commonParent.style.gap = computed.gap || '16px';
                    commonParent.style.padding = computed.padding;
                    commonParent.style.alignItems = computed.alignItems;
                } else {
                    commonParent.style.display = 'flex';
                    commonParent.style.flexWrap = 'wrap';
                    commonParent.style.gap = computed.gap || '16px';
                }

                containers.forEach((container) => {
                    let current = container;
                    while (current && current !== commonParent && current !== document.body) {
                        current.style.display = 'contents';
                        current = current.parentElement;
                    }
                });

                // PROTECT NON-PRODUCT UI ELEMENTS (Ads, Banners, Headers)
                let passedGrid = false;
                Array.from(commonParent.children).forEach(child => {
                    let isWormholePath = containers.some(c => child === c || child.contains(c));
                    if (isWormholePath) {
                        passedGrid = true;
                    } else {
                        // Expand the ad to full width so it doesn't get squished into a tiny grid cell
                        child.style.gridColumn = '1 / -1';
                        child.style.width = '100%';
                        child.style.display = 'block';
                        // Maintain layout: keep top items at top, bottom items at bottom
                        child.style.order = passedGrid ? 999999 : -1;
                    }
                });
            }
        } else {
            const c = containers[0];
            const computed = window.getComputedStyle(c);
            if (!computed.display.includes('grid') && !computed.display.includes('flex')) {
                c.style.display = 'flex';
                c.style.flexWrap = 'wrap';
            }
        }
    }

    function init() {
        initUI();
        document.querySelectorAll('div[class*="product-grid-component"]').forEach(attachToGrid);
        pageObserver.observe(document.body, { childList: true, subtree: true });
    }

    setTimeout(init, 2000);

})();
