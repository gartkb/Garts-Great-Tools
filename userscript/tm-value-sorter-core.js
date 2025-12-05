/* ==========================================================================
   DOCUMENTATION & USAGE GUIDE
   ==========================================================================

   HOW TO USE THIS MODULE IN OTHER SCRIPTS:
   --------------------------------------------------------------------------
   1. In your Store Script (Walmart, Costco, etc.), add this header:
      // @require https://raw.githubusercontent.com/YOUR_GITHUB_USER/YOUR_REPO/main/tm-value-sorter-core.js

   2. This module exposes a global object: window.ValueSorter

   3. MAIN API METHOD:
      const result = window.ValueSorter.analyze(title, price, [optionalShelfPrice]);

      INPUTS:
      - title (string): The product name (e.g., "Tide Pods 3-Pack, 50ct").
      - price (number): The extracted price (e.g., 29.97).
      - optionalShelfPrice (number): The unit price scraped from the store itself (if available).
                                     Used to detect "Deals" if our math differs significantly.

      OUTPUT:
      - Returns NULL if no unit/quantity could be parsed.
      - Returns OBJECT if successful:
        {
           val: 0.15,        // (Number) The normalized unit price (for sorting).
           label: "$0.15/ea",// (String) The formatted badge text.
           type: "each",     // (String) 'weight', 'vol', or 'each' (for badge coloring).
           isDeal: false     // (Boolean) True if calculated price is >5% cheaper than shelf price.
        }

   4. BADGING STRATEGY (Recommended Colors):
      - type === 'each'   -> Purple (Countable items: pills, pods, rolls)
      - type === 'vol'    -> Blue   (Liquids: ml, L)
      - type === 'weight' -> Green  (Solids: g, kg, lb)
      - isDeal === true   -> Gold/Orange (Highlight this!)

   ========================================================================== */

// ==UserScript==
// @name         TM Value Sorter Core
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Shared logic for Walmart, Costco, and Superstore Value Sorters. Handles parsing, math, and unit normalization.
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================
    // CONFIGURATION & CONSTANTS
    // =========================================================

    const UNITS = {
        WEIGHT: "g|kg|lb|oz",
        VOL: "ml|l|liq",
        // The Mega-List of Countable Keywords
        // V1.2: Added 'razors' (plural), 'cartridges', and 'shavers'. 
        // Note: We avoid singular 'razor' or 'blade' to prevent matching product types (e.g. "3 blade razor").
        COUNT: [
            "pairs?", "pr", "packs?", "pk", "counts?", "cnt", "ct",
            "pieces?", "pcs", "sets?",
            "rolls?", "sheets?",
            "capsules?", "tablets?", "pills?", "softgels?", "caplets?", "lozenges?", "gumm(y|ies)", "chewables?", "vitamins?",
            "bags?", "tea\\s?bags?", "sachets?",
            "pods?", "k-?cups?", "discs?", "coffee\\s?pods?",
            "pads?", "liners?", "wipes?", "diapers?", "briefs?", "underwear",
            "cartridges?", "refills?", "blades?", "razors", "shavers", // Plural razors implies quantity
            "bars?", "bottles?", "cans?", "box(es)?", "eggs?",
            "servings?", "scoops?"
        ].join("|")
    };

    // If a title contains these words, we prioritize COUNT over WEIGHT
    // V1.2: Added 'razor' and 'shave' to prevent "7oz Shave Gel" from overriding the razor count.
    const FORCE_COUNT_KEYWORDS = [
        "tea", "coffee", "pod", "capsule", "tablet", "pill", "vitamin", "gum",
        "diaper", "wipe", "sheet", "paper", "tissue", "toilet", "towel",
        "laundry", "detergent", "tab", "pac", "soap", "battery", "batteries",
        "razor", "shave", "blade"
    ];

    // =========================================================
    // HELPER CLASSES
    // =========================================================

    class ValueResult {
        constructor(val, type, label, isDeal = false) {
            this.val = val;       // The raw float (for sorting)
            this.type = type;     // 'weight', 'vol', 'each'
            this.label = label;   // The text to display
            this.isDeal = isDeal; // If calculated price is significantly better than shelf price
        }
    }

    // =========================================================
    // MAIN LOGIC
    // =========================================================

    window.ValueSorter = {

        analyze: function(title, price, shelfUnitPrice = null) {
            if (!price || price <= 0) return null;
            if (!title) return null;

            // 1. CLEANUP & SANITIZATION (Crucial for Razors)
            let cleanTitle = title.toLowerCase().replace(/[\r\n]+/g, " ");
            
            // Remove "1 Handle" noise (e.g., "1 Handle, 4 Refills")
            cleanTitle = cleanTitle.replace(/\b1\s+handle\b/g, "");
            
            // Remove "X-Blade" descriptors (e.g., "5-Blade Razor", "3 Blade System")
            // We want to keep "10 Blades" but remove "5-Blade Razor".
            // Logic: Remove Number+Blade if NOT followed by 'refill' or 'cartridge' or 'pack'
            const descriptorRegex = /\b\d+\s*[-]?\s*blades?(?!\s*(?:refill|cartridge|pack|count|ct))\b/g;
            cleanTitle = cleanTitle.replace(descriptorRegex, "");

            // 2. Extract Metrics
            const math = this.extractMath(cleanTitle);   
            const weight = this.extractWeight(cleanTitle); 
            const count = this.extractCount(cleanTitle);   

            // 3. Determine Priority (The Hierarchy)
            let selectedMeasure = null;

            const isForceCount = FORCE_COUNT_KEYWORDS.some(kw => cleanTitle.includes(kw));

            if (isForceCount) {
                // FORCE COUNT HIERARCHY
                if (count) selectedMeasure = { ...count, type: 'each' };
                else if (math && math.type === 'count') selectedMeasure = { ...math, type: 'each' };
                else if (weight) selectedMeasure = weight;
            } else {
                // STANDARD HIERARCHY
                if (math) {
                    if (math.type !== 'count') selectedMeasure = math;
                    else if (!weight) selectedMeasure = { ...math, type: 'each' };
                }
                
                if (!selectedMeasure && weight) selectedMeasure = weight;
                if (!selectedMeasure && count) selectedMeasure = { ...count, type: 'each' };
            }

            // 4. Calculate
            if (selectedMeasure && selectedMeasure.qty > 0) {
                return this.calculateResult(price, selectedMeasure, shelfUnitPrice);
            }

            return null;
        },

        // --- EXTRACTORS ---

        extractMath: function(str) {
            // Regex: Number x Number Unit
            const regex = new RegExp(`(\\d+)\\s*[x×]\\s*([0-9,.]+)\\s*(${UNITS.WEIGHT}|${UNITS.VOL}|${UNITS.COUNT})\\b`);
            const match = str.match(regex);
            
            if (match) {
                const multi = parseFloat(match[1]);
                const unitSize = parseFloat(match[2].replace(/,/g, ''));
                const unitStr = match[3];
                const type = this.getUnitType(unitStr);
                return { qty: multi * unitSize, unit: unitStr, type: type };
            }
            return null;
        },

        extractWeight: function(str) {
            // Regex: Number Unit
            const regex = new RegExp(`(?:\\b|^)([0-9,.]+)\\s*(${UNITS.WEIGHT}|${UNITS.VOL})\\b`);
            const match = str.match(regex);
            
            if (match) {
                const qty = parseFloat(match[1].replace(/,/g, ''));
                const unitStr = match[2];
                return { qty: qty, unit: unitStr, type: this.getUnitType(unitStr) };
            }
            return null;
        },

        extractCount: function(str) {
            // STRATEGY 1: Gap Matching (e.g. "2 Razor Blade Refills")
            // Looks for Number + (up to 3 words) + Refills/Cartridges
            const gapRegex = /\b(\d+)\s+(?:[a-z-]+\s+){0,3}(refills?|cartridges?)\b/;
            const gapMatch = str.match(gapRegex);
            if (gapMatch) {
                return { qty: parseFloat(gapMatch[1]), unit: 'ea', type: 'each' };
            }

            // STRATEGY 2: Standard Count Matching
            // Regex: Number Keywords
            const regex = new RegExp(`(\\d+)\\s*[-]?\\s*(${UNITS.COUNT})\\b`);
            const match = str.match(regex);

            if (match) {
                const qty = parseFloat(match[1].replace(/,/g, ''));
                return { qty: qty, unit: 'ea', type: 'each' };
            }
            // STRATEGY 3: "Pack of X" Fallback
            const packOfRegex = str.match(/pack\s+of\s+([0-9]+)/);
            if (packOfRegex) {
                 return { qty: parseFloat(packOfRegex[1]), unit: 'ea', type: 'each' };
            }

            return null;
        },

        // --- UTILS ---

        getUnitType: function(unit) {
            if (new RegExp(`^(${UNITS.WEIGHT})$`).test(unit)) return 'weight';
            if (new RegExp(`^(${UNITS.VOL})$`).test(unit)) return 'vol';
            return 'count';
        },

        calculateResult: function(price, measure, shelfPrice) {
            let val = 0;
            let type = measure.type;
            const q = measure.qty;
            const u = measure.unit;

            if (type === 'count' || type === 'each') {
                val = price / q;
                type = 'each';
            } else {
                if (u === 'g') val = (price / q) * 100;
                else if (u === 'kg') val = (price / (q * 1000)) * 100;
                else if (u === 'lb') val = (price / (q * 453.592)) * 100;
                else if (u === 'oz') val = (price / (q * 28.3495)) * 100;
                else if (u === 'ml') { val = (price / q) * 100; type = 'vol'; }
                else if (u === 'l') { val = (price / (q * 1000)) * 100; type = 'vol'; }
            }

            let isDeal = false;
            if (shelfPrice && shelfPrice > 0) {
                if (val < (shelfPrice * 0.95)) {
                    isDeal = true;
                }
            }

            return new ValueResult(val, type, this.formatLabel(val, type), isDeal);
        },

        formatLabel: function(val, type) {
            if (val >= 9999) return "";
            if (type === 'each') return `$${val.toFixed(2)}/ea`;
            if (type === 'vol') return `$${val.toFixed(2)}/100ml`;
            return `$${val.toFixed(2)}/100g`;
        }
    };

})();
