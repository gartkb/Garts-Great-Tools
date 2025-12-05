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

   5. EXAMPLE IMPLEMENTATION:
      const card = document.querySelector('.product-card');
      const title = card.querySelector('.title').innerText;
      const price = parseFloat(card.querySelector('.price').innerText.replace('$',''));

      const data = window.ValueSorter.analyze(title, price);

      if (data) {
          // Create Badge with data.label
          // Sort Grid using data.val
      }

   ========================================================================== */

// ==UserScript==
// @name         TM Value Sorter Core
// @namespace    http://tampermonkey.net/
// @version      1.1
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
        // V1.1 Update: Added support for "tea bags", "coffee pods", "k-cups"
        COUNT: [
            "pairs?", "pr", "packs?", "pk", "counts?", "cnt", "ct",
            "pieces?", "pcs", "sets?",
            "rolls?", "sheets?",
            "capsules?", "tablets?", "pills?", "softgels?", "caplets?", "lozenges?", "gumm(y|ies)", "chewables?", "vitamins?",
            "bags?", "tea\\s?bags?", "sachets?", // Handles "teabags" and "tea bags"
            "pods?", "k-?cups?", "discs?", "coffee\\s?pods?",
            "pads?", "liners?", "wipes?", "diapers?", "briefs?", "underwear",
            "cartridges?", "refills?", "blades?",
            "bars?", "bottles?", "cans?", "box(es)?", "eggs?",
            "servings?", "scoops?"
        ].join("|")
    };

    // If a title contains these words, we prioritize COUNT over WEIGHT
    // (e.g. "Green Tea 40g (20 bags)" -> We want 20 bags, not 40g)
    const FORCE_COUNT_KEYWORDS = [
        "tea", "coffee", "pod", "capsule", "tablet", "pill", "vitamin", "gum",
        "diaper", "wipe", "sheet", "paper", "tissue", "toilet", "towel",
        "laundry", "detergent", "tab", "pac", "soap", "battery", "batteries"
    ];

    // =========================================================
    // HELPER CLASSES
    // =========================================================

    class ValueResult {
        constructor(val, type, label, isDeal = false) {
            this.val = val;       // The raw float (for sorting)
            this.type = type;     // 'weight', 'vol', 'each' (for coloring)
            this.label = label;   // The text to display
            this.isDeal = isDeal; // If calculated price is significantly better than shelf price
        }
    }

    // =========================================================
    // MAIN LOGIC
    // =========================================================

    window.ValueSorter = {

        /**
         * Main Entry Point
         * @param {string} title - Product title
         * @param {number} price - Product price (float)
         * @param {number|null} shelfUnitPrice - (Optional) The unit price scraped from the store itself (for comparison)
         */
        analyze: function(title, price, shelfUnitPrice = null) {
            if (!price || price <= 0) return null;
            if (!title) return null;

            // V1.1: Be less aggressive with removing characters so we don't accidentally merge "20g" and "bags"
            const cleanTitle = title.toLowerCase().replace(/[\r\n]+/g, " ");

            // 1. Extract Metrics
            const math = this.extractMath(cleanTitle);   // e.g., 3x100ml
            const weight = this.extractWeight(cleanTitle); // e.g., 500g
            const count = this.extractCount(cleanTitle);   // e.g., 20 pack

            // 2. Determine Priority (The Hierarchy)
            let selectedMeasure = null;

            // Check for context overrides (e.g., Tea, Pods)
            const isForceCount = FORCE_COUNT_KEYWORDS.some(kw => cleanTitle.includes(kw));

            if (isForceCount) {
                // HIERARCHY A: Force Count (Tea, Meds, Paper)
                // 1. Count (20 bags)
                // 2. Math (3 x 20 bags)
                // 3. Fallback to Weight if no count found (e.g. Loose Leaf Tea)
                if (count) selectedMeasure = { ...count, type: 'each' };
                else if (math && math.type === 'count') selectedMeasure = { ...math, type: 'each' };
                else if (weight) selectedMeasure = weight;
            } else {
                // HIERARCHY B: Standard (Food, Liquids, General)
                // 1. Math (3 x 100g) - usually most accurate for multipacks
                // 2. Weight / Vol
                // 3. Count
                if (math) {
                    if (math.type !== 'count') selectedMeasure = math; // Prefer 3x100g
                    else if (!weight) selectedMeasure = { ...math, type: 'each' }; // 3x50ct
                }
                
                if (!selectedMeasure && weight) selectedMeasure = weight;
                if (!selectedMeasure && count) selectedMeasure = { ...count, type: 'each' };
            }

            // 3. Calculate
            if (selectedMeasure && selectedMeasure.qty > 0) {
                return this.calculateResult(price, selectedMeasure, shelfUnitPrice);
            }

            return null;
        },

        // --- EXTRACTORS ---

        extractMath: function(str) {
            // Regex: Number x Number Unit (e.g., 3x100ml, 4 x 150g, 2x60ct)
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
            // Regex: Number Unit (e.g., 500g, 2.5 kg)
            // Specific checks to avoid matching dates or unrelated numbers often found in titles
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
            // Regex: Number Keywords (e.g., 20 pack, 50ct, 100 sheets)
            const regex = new RegExp(`(\\d+)\\s*[-]?\\s*(${UNITS.COUNT})\\b`);
            const match = str.match(regex);

            if (match) {
                const qty = parseFloat(match[1].replace(/,/g, ''));
                return { qty: qty, unit: 'ea', type: 'each' };
            }
            // Fallback: "Pack of X"
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

            // Normalization Logic
            if (type === 'count' || type === 'each') {
                val = price / q;
                type = 'each'; // Unify 'count' to 'each'
            } else {
                // Weight/Vol Logic -> Normalize to 100g/100ml
                if (u === 'g') val = (price / q) * 100;
                else if (u === 'kg') val = (price / (q * 1000)) * 100;
                else if (u === 'lb') val = (price / (q * 453.592)) * 100;
                else if (u === 'oz') val = (price / (q * 28.3495)) * 100;
                else if (u === 'ml') { val = (price / q) * 100; type = 'vol'; }
                else if (u === 'l') { val = (price / (q * 1000)) * 100; type = 'vol'; }
            }

            // Deal Detection
            // If the calculated math is significantly lower than what the store shelf says,
            // it implies a hidden multipack deal or a data error we want to highlight.
            let isDeal = false;
            if (shelfPrice && shelfPrice > 0) {
                // If calculated value is < 95% of shelf price
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
