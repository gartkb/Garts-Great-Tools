// ==UserScript==
// @name         GW2 Build Filter & Sort (Fixed)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Filter GW2 wiki builds by profession, damage type, boon support, and role.
// @author       You
// @match        *://wiki.guildwars2.com/*
// @match        *://metabattle.com/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration & Data Mapping ---
    // Includes Core, HoT, PoF, EoD, and Janthir Wilds/VoE specs
    const professionMap = {
        'Guardian':     ['Guardian', 'Dragonhunter', 'Firebrand', 'Willbender', 'Luminary'],
        'Warrior':      ['Warrior', 'Berserker', 'Spellbreaker', 'Bladesworn', 'Paragon'],
        'Engineer':     ['Engineer', 'Scrapper', 'Holosmith', 'Mechanist', 'Amalgam'],
        'Ranger':       ['Ranger', 'Druid', 'Soulbeast', 'Untamed', 'Galeshot'],
        'Thief':        ['Thief', 'Daredevil', 'Deadeye', 'Specter', 'Antiquary'],
        'Elementalist': ['Elementalist', 'Tempest', 'Weaver', 'Catalyst', 'Evoker'],
        'Mesmer':       ['Mesmer', 'Chronomancer', 'Mirage', 'Virtuoso', 'Troubadour'],
        'Necromancer':  ['Necromancer', 'Reaper', 'Scourge', 'Harbinger', 'Ritualist'],
        'Revenant':     ['Revenant', 'Herald', 'Renegade', 'Vindicator', 'Conduit']
    };

    // Flatten map for reverse lookup (Spec -> Base Profession)
    const specToBaseMap = {};
    Object.keys(professionMap).forEach(base => {
        professionMap[base].forEach(spec => specToBaseMap[spec] = base);
    });

    // --- CSS Styling ---
    GM_addStyle(`
        #gw2-build-filter-panel {
            background: #202225;
            color: #ddd;
            padding: 15px;
            margin-bottom: 20px;
            border-radius: 5px;
            border: 1px solid #444;
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            align-items: center;
            font-family: sans-serif;
        }
        .filter-group { display: flex; align-items: center; gap: 8px; }
        .filter-label { font-weight: bold; color: #aaa; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px;}
        .gw2-btn {
            background: #2f3136;
            border: 1px solid #40444b;
            color: #dcddde;
            padding: 6px 14px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
            transition: all 0.15s ease-in-out;
        }
        .gw2-btn:hover { background: #40444b; }
        
        /* Active States */
        .gw2-btn.active {
            background: #5865f2; 
            border-color: #5865f2;
            color: white;
            font-weight: bold;
        }
        .gw2-btn.active-red.active { background: #ed4245; border-color: #ed4245; } /* Condi */
        .gw2-btn.active-orange.active { background: #e67e22; border-color: #e67e22; } /* Power */
        .gw2-btn.active-green.active { background: #3ba55c; border-color: #3ba55c; } /* Heal */
        .gw2-btn.active-purple.active { background: #9b59b6; border-color: #9b59b6; } /* Boons */

        select.gw2-input, input.gw2-input {
            padding: 6px;
            border-radius: 4px;
            background: #2f3136;
            color: white;
            border: 1px solid #40444b;
        }
        .hidden-build { display: none !important; }
        .hidden-header { display: none !important; }
    `);

    // --- Parsing Logic ---

    function getBuildTags(row) {
        // 1. Identify Profession / Spec
        // We look for any element with aria-label OR any img with alt text
        // This fixes the issue where aria-label was on a div, not the img
        const elements = row.querySelectorAll('[aria-label], img[alt]');
        let spec = "Unknown";
        
        for(let el of elements) {
            const label = el.getAttribute('aria-label') || el.getAttribute('alt');
            // Check if the label exists in our profession map
            if (label && specToBaseMap[label]) { 
                spec = label;
                break;
            }
        }

        // Fallback: Check raw text if icon matching failed (e.g. text-only rows)
        if (spec === "Unknown") {
            const textContent = row.innerText;
            // Check mostly for elite specs first as they are unique
            for (const s in specToBaseMap) {
                if (textContent.includes(s)) {
                    spec = s;
                    break;
                }
            }
        }

        const titleNode = row.querySelector('.build-row-title');
        const text = titleNode ? titleNode.innerText.toLowerCase() : "";

        // 2. Identify Boons/Roles
        // "Boon Support" implies a flexible build (Quick OR Alac) common on Mesmer/Rev/Engi
        const isGenericBoon = text.includes('boon support');
        
        const tags = {
            base: specToBaseMap[spec] || "Other", // Maps "Scrapper" -> "Engineer"
            spec: spec,                           
            // Damage Types
            isPower: text.includes('power') || text.includes('hybrid') || text.includes('celestial') || text.includes('pbm'),
            isCondi: text.includes('condi') || text.includes('hybrid') || text.includes('celestial'),
            // Boons
            isQuick: text.includes('quickness') || isGenericBoon,
            isAlac: text.includes('alacrity') || isGenericBoon,
            // Roles
            isHeal: text.includes('healer'),
            // Search text
            fullText: text + " " + spec.toLowerCase() + " " + (specToBaseMap[spec]||"").toLowerCase()
        };

        return tags;
    }

    // --- Main UI & Logic ---

    function init() {
        const container = document.querySelector('.mw-parser-output');
        if (!container) return;

        // Insertion point
        const firstElement = container.querySelector('.build-row-header') || container.querySelector('.build-row');
        if (!firstElement) return;

        // 1. Parse Data
        const rows = document.querySelectorAll('.build-row');
        rows.forEach(row => {
            const tags = getBuildTags(row);
            row.dataset.base = tags.base;
            row.dataset.spec = tags.spec;
            row.dataset.isPower = tags.isPower;
            row.dataset.isCondi = tags.isCondi;
            row.dataset.isQuick = tags.isQuick;
            row.dataset.isAlac = tags.isAlac;
            row.dataset.isHeal = tags.isHeal;
            row.dataset.fullText = tags.fullText;
        });

        // 2. Build Panel
        const filterPanel = document.createElement('div');
        filterPanel.id = 'gw2-build-filter-panel';

        // Profession Select
        const profOptions = Object.keys(professionMap).sort().map(p => `<option value="${p}">${p}</option>`).join('');
        const profHTML = `
            <div class="filter-group">
                <span class="filter-label">Profession</span>
                <select id="filter-prof" class="gw2-input">
                    <option value="All">All</option>
                    ${profOptions}
                    <option disabled>──────────</option>
                    <option value="Other">Other</option>
                </select>
            </div>`;

        // Damage Type
        const typeHTML = `
            <div class="filter-group">
                <span class="filter-label">Type</span>
                <button class="gw2-btn active-orange" data-filter="type" data-val="power">Power</button>
                <button class="gw2-btn active-red" data-filter="type" data-val="condi">Condi</button>
            </div>`;

        // Boons
        const boonHTML = `
            <div class="filter-group">
                <span class="filter-label">Boon</span>
                <button class="gw2-btn active-purple" data-filter="boon" data-val="quick">Quickness</button>
                <button class="gw2-btn active-purple" data-filter="boon" data-val="alac">Alacrity</button>
            </div>`;

        // Role
        const roleHTML = `
            <div class="filter-group">
                <span class="filter-label">Role</span>
                <button class="gw2-btn active-green" data-filter="role" data-val="heal">Healer</button>
            </div>`;

        // Search
        const utilHTML = `
            <div class="filter-group" style="margin-left:auto">
                <input type="text" id="filter-search" class="gw2-input" placeholder="Search..." style="width: 120px;">
                <button id="filter-reset" class="gw2-btn">Reset</button>
            </div>`;

        filterPanel.innerHTML = profHTML + typeHTML + boonHTML + roleHTML + utilHTML;
        container.insertBefore(filterPanel, firstElement);

        // 3. Bind Events
        document.getElementById('filter-prof').addEventListener('change', applyFilters);
        document.getElementById('filter-search').addEventListener('input', applyFilters);
        document.getElementById('filter-reset').addEventListener('click', resetFilters);

        filterPanel.querySelectorAll('.gw2-btn[data-filter]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.classList.toggle('active');
                applyFilters();
            });
        });
    }

    function resetFilters() {
        document.getElementById('filter-prof').value = 'All';
        document.getElementById('filter-search').value = '';
        document.querySelectorAll('.gw2-btn.active').forEach(btn => btn.classList.remove('active'));
        applyFilters();
    }

    function getActiveValues(group) {
        return Array.from(document.querySelectorAll(`.gw2-btn[data-filter="${group}"].active`))
            .map(btn => btn.dataset.val);
    }

    function applyFilters() {
        const selectedProf = document.getElementById('filter-prof').value;
        const searchText = document.getElementById('filter-search').value.toLowerCase();

        const activeTypes = getActiveValues('type'); // ['power', 'condi']
        const activeBoons = getActiveValues('boon'); // ['quick', 'alac']
        const activeRoles = getActiveValues('role'); // ['heal']

        const rows = document.querySelectorAll('.build-row');

        rows.forEach(row => {
            const ds = row.dataset;
            let visible = true;

            // 1. Profession Filter
            if (selectedProf !== 'All') {
                if (selectedProf === 'Other') {
                    if (ds.base !== 'Other') visible = false;
                } else {
                    if (ds.base !== selectedProf) visible = false;
                }
            }

            // 2. Type Filter (Power OR Condi)
            // Shows row if it matches at least one active button. 
            // If Hybrid/Celestial, it matches both.
            if (visible && activeTypes.length > 0) {
                let match = false;
                if (activeTypes.includes('power') && ds.isPower === 'true') match = true;
                if (activeTypes.includes('condi') && ds.isCondi === 'true') match = true;
                if (!match) visible = false;
            }

            // 3. Boon Filter (Quickness OR Alacrity)
            if (visible && activeBoons.length > 0) {
                let match = false;
                if (activeBoons.includes('quick') && ds.isQuick === 'true') match = true;
                if (activeBoons.includes('alac') && ds.isAlac === 'true') match = true;
                if (!match) visible = false;
            }

            // 4. Role Filter (Healer)
            // Healer is restrictive (AND logic). If button is on, you MUST be a healer.
            if (visible && activeRoles.includes('heal')) {
                if (ds.isHeal !== 'true') visible = false;
            }

            // 5. Search
            if (visible && searchText) {
                if (!ds.fullText.includes(searchText)) visible = false;
            }

            // Toggle CSS
            if (visible) row.classList.remove('hidden-build');
            else row.classList.add('hidden-build');
        });

        updateHeaders();
    }

    function updateHeaders() {
        const headers = document.querySelectorAll('.build-row-header');
        headers.forEach(header => {
            let next = header.nextElementSibling;
            let hasVisibleChild = false;

            // Scan siblings until next section header
            while (next) {
                if (next.classList.contains('build-row-header') || next.classList.contains('section-header') || next.tagName === 'H2') break;
                
                if (next.classList.contains('build-row') && !next.classList.contains('hidden-build')) {
                    hasVisibleChild = true;
                    break;
                }
                next = next.nextElementSibling;
            }

            if (hasVisibleChild) header.classList.remove('hidden-header');
            else header.classList.add('hidden-header');
        });
    }

    init();

})();