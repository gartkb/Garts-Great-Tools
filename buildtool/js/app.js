import api from './api.js';
import { SLOT_ICON_MAP, WEAPON_ICON_MAP, getSlotIconId, getWeaponIcon } from './slot-icons-updated.js';
import { encodeBuild, decodeBuild } from './chatlink.js';

// Hardcoded bonuses for skills (mostly signets) because the GW2 API does not expose numeric stat bonuses for them directly.
const UNCONDITIONAL_SKILL_BONUSES = {
    // Guardian
    9151: { stat: 'ConditionDamage', value: 180, display: '+180 Condition Damage' }, // Signet of Wrath
    9163: { stat: 'Concentration', value: 120, display: '+120 Concentration' }, // Signet of Mercy
    9093: { stat: 'Power', value: 180, display: '+180 Power' }, // Bane Signet
    // Warrior
    14404: { stat: 'Power', value: 180, display: '+180 Power' }, // Signet of Might
    14410: { stat: 'Precision', value: 180, display: '+180 Precision' }, // Signet of Fury

    // Elementalist
    5542: { stat: 'Precision', value: 180, display: '+180 Precision' }, // Signet of Fire

    // Thief
    13046: { stat: 'Power', value: 180, display: '+180 Power' }, // Assassin's Signet
    13062: { stat: 'Precision', value: 180, display: '+180 Precision' }, // Signet of Agility
    // Ranger
    12500: { stat: 'Toughness', value: 180, display: '+180 Toughness' }, // Signet of Stone
    12491: { stat: 'CritDamage', value: 180, display: '+180 Ferocity' }, // Signet of the Wild
    // Mesmer
    10232: { stat: 'ConditionDamage', value: 180, display: '+180 Condition Damage' }, // Signet of Domination
    10234: { stat: 'ConditionDuration', value: 180, display: '+180 Expertise' }, // Signet of Midnight
    // Necromancer
    10622: { stat: 'Power', value: 180, display: '+180 Power' } // Signet of Spite
};

/**
 * Main Application Controller
 */
class App {
    constructor() {
        this.state = {
            currentBuild: {
                name: 'New Build',
                profession: null,
                specializations: [null, null, null],
                traits: { 0: [], 1: [], 2: [] },
                equipment: {},
                skills: {
                    heal: null,
                    utility: [null, null, null],
                    elite: null
                },
                professionExtras: {
                    // Ranger: { pet1: null, pet2: null }
                    // Revenant: { legend1: null, legend2: null, activeLegendSlot: 1 }
                    // Scrapper: { toolbeltSkills: [] } // auto-calculated
                },
                notes: ''
            },
            professionsCache: [],
            availableSpecializations: [],
            availableStats: [],
            availableUpgrades: { upgrades: [], relics: [] },
            availableConsumables: { food: [], utility: [] }, // NEW
            feastStats: {}, // NEW: Cache for feast stats lookup
            ascendedFeastGlobals: [
                "+10% Karma",
                "+5% All Experience Gained",
                "+20% Magic Find",
                "+20% Gold Find",
                "+10% WXP Gained"
            ], // NEW: Global bonuses for ascended feasts
            tpPrices: {}, // NEW: Cache for Trading Post prices
            utilityStatFilter: '', // NEW: Filter for utility items
            currentStats: {}, // NEW: stores live stats to calculate utility % buffs
            sortUtilityActive: false, // NEW: tracks if sort button is active for UtilityItems
            availableSkills: { heal: [], utility: [], elite: [] },
            availablePets: [], // For Ranger
            availableLegends: [], // For Revenant
            activeLegendSlot: 1, // For Revenant: tracks which legend is active (1 or 2)
            currentSkillCacheKey: null,
            currentSlotSelection: null,
            currentSlotType: 'Stat', // 'Stat', 'Rune', 'Sigil', 'Relic', 'Heal', 'Utility', 'Elite'
            weaponTypes: {
                WeaponA1: '', WeaponA2: '',
                WeaponB1: '', WeaponB2: ''
            },
            activeWeaponSet: 'A', // 'A' or 'B' - tracks which weapon set is active
            itemCache: {}, // Cache for fetched item details from API
            // Import from Game state
            apiKeys: JSON.parse(localStorage.getItem('gw2ApiKeys') || '[]'),
            selectedCharacterData: null
        };

        // Slot categories for apply-to feature
        this.slotCategories = {
            armor: ['Helm', 'Shoulders', 'Coat', 'Gloves', 'Leggings', 'Boots'],
            armorRunes: ['HelmRune', 'ShouldersRune', 'CoatRune', 'GlovesRune', 'LeggingsRune', 'BootsRune'],
            weapons: ['WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2'],
            weaponSigils1: ['WeaponA1Sigil1', 'WeaponA2Sigil1', 'WeaponB1Sigil1', 'WeaponB2Sigil1'],
            weaponSigils2: ['WeaponA1Sigil2', 'WeaponB1Sigil2'], // Only 2H weapons have Sigil2
            trinkets: ['Backpack', 'Accessory1', 'Accessory2', 'Amulet', 'Ring1', 'Ring2']
        };

        this.init();
    }

    // Helper to convert stat name to CSS class name for icon sprite
    getStatIconClass(statName) {
        if (!statName) return '';
        // Convert to lowercase and replace spaces/special characters with underscores
        // Map PVE stat combo names to CSS class names
        const nameMap = {
            'Apostate': 'apostate',
            'Apothecary': 'apothecary',
            'Assassin': 'assassin',
            'Berserker': 'berserker',
            'Bringer': 'bringer',
            'Captain': 'captain',
            'Carrion': 'carrion',
            'Cavalier': 'cavalier',
            'Celestial': 'celestial',
            'Cleric': 'cleric',
            'Commander': 'commander',
            'Crusader': 'crusader',
            'Demolisher': 'demolisher',
            'Dire': 'dire',
            'Diviner': 'diviner',
            'Dragon': 'dragon',
            'Forsaken': 'forsaken',
            'Giver': 'giver',
            'Grieving': 'grieving',
            'Harrier': 'harrier',
            'Knight': 'knight',
            'Magi': 'magi',
            'Marauder': 'marauder',
            'Marshal': 'marshal',
            'Minstrel': 'minstrel',
            'Nomad': 'nomad',
            'Plaguedoctor': 'plaguedoctor',
            'Rabid': 'rabid',
            'Rampager': 'rampager',
            'Ritualist': 'ritualist',
            'Sentinel': 'sentinel',
            'Seraph': 'seraph',
            'Settler': 'settler',
            'Shaman': 'shaman',
            'Sinister': 'sinister',
            'Soldier': 'soldier',
            'Trailblazer': 'trailblazer',
            'Valkyrie': 'valkyrie',
            'Vigilant': 'vigilant',
            'Viper': 'viper',
            'Wanderer': 'wanderer',
            'Zealot': 'zealot'
        };

        // Normalize name: remove apostrophe 's for matching
        const normalizedName = statName.replace(/'s\b/g, '').trim();

        // Try exact match first with normalized name
        if (nameMap[normalizedName]) {
            return nameMap[normalizedName];
        }

        // Log warning if we couldn't find a mapping for a known stat combo
        const knownStats = new Set([
            'Berserker', 'Zealot', 'Soldier', 'Forsaken', 'Valkyrie', 'Harrier',
            'Commander', 'Demolisher', 'Marauder', 'Vigilant', 'Crusader', 'Wanderer',
            'Diviner', 'Dragon', 'Viper', 'Grieving', 'Marshal', 'Captain', 'Rampager',
            'Assassin', 'Seraph', 'Knight', 'Cavalier', 'Nomad', 'Settler', 'Giver',
            'Trailblazer', 'Minstrel', 'Sentinel', 'Shaman', 'Ritualist', 'Plaguedoctor',
            'Sinister', 'Carrion', 'Rabid', 'Dire', 'Apostate', 'Bringer', 'Cleric',
            'Magi', 'Apothecary', 'Celestial'
        ]);

        if (knownStats.has(normalizedName)) {
            console.warn(`Stat icon mapping missing for known stat: "${statName}" (normalized: "${normalizedName}")`);
        }

        // Fallback: lowercase and replace non-alphanumeric with underscores
        return statName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    async init() {
        console.log("Initializing App...");
        try {
            // Use Promise.allSettled to ensure all promises complete (success or failure)
            // This prevents one failed API call from blocking the entire initialization
            await Promise.allSettled([
                this.loadProfessions(),
                this.loadAllStats(),
                this.loadUpgrades()
            ]);
        } catch (e) {
            console.error("Error during data loading:", e);
        }

        // Always set up UI components regardless of API call results
        this.setupEventListeners();
        this.setupEquipmentSlots();
        this.setupSkillSlots();
        this.recalculateStats();
        this.renderSavedBuilds();
    }

    async loadAllStats() {
        try {
            const rawStats = await api.getAllItemStats();
            const statsMap = new Map();

            rawStats.forEach(s => {
                if (!s.name || !s.attributes) return;

                // Normalize attributes to array format
                let attrs = s.attributes;
                if (!Array.isArray(attrs)) {
                    attrs = Object.keys(attrs).map(key => ({
                        attribute: key,
                        multiplier: attrs[key],
                        value: 0
                    }));
                }
                if (attrs.length === 0) return;
                s.attributes = attrs;

                const hasJewelValue = s.attributes.some(attr => attr.value > 0);
                const statType = hasJewelValue ? 'trinket' : 'armor';
                const key = `${s.name}_${statType}`;

                if (statType === 'trinket') {
                    // Find the largest built-in jewel value for this specific API ID
                    const currentMaxVal = Math.max(...s.attributes.map(a => a.value || 0));

                    // SAFETY TRAP: PvP Amulets inject 1000+ stats into 'value'.
                    // The highest PvE Ascended jewel is 32. Ignore anything higher.
                    if (currentMaxVal > 100) return;

                    if (statsMap.has(key)) {
                        // Only overwrite if this ID has a HIGHER jewel value (guarantees Ascended Level 80)
                        const existing = statsMap.get(key);
                        const existingMaxVal = Math.max(...existing.attributes.map(a => a.value || 0));

                        if (currentMaxVal > existingMaxVal) {
                            statsMap.set(key, s);
                        }
                    } else {
                        statsMap.set(key, s);
                    }
                } else {
                    // Armor/Weapons (value = 0) share the exact same multipliers regardless of rarity
                    statsMap.set(key, s);
                }
            });

            // Filter to only PVE stat combos
            const pveStatCombos = new Set([
                'Berserker', 'Zealot', 'Soldier', 'Forsaken', 'Valkyrie', 'Harrier',
                'Commander', 'Demolisher', 'Marauder', 'Vigilant', 'Crusader', 'Wanderer',
                'Diviner', 'Dragon', 'Viper', 'Grieving', 'Marshal', 'Captain', 'Rampager',
                'Assassin', 'Seraph', 'Knight', 'Cavalier', 'Nomad', 'Settler', 'Giver',
                'Trailblazer', 'Minstrel', 'Sentinel', 'Shaman', 'Ritualist', 'Plaguedoctor',
                'Sinister', 'Carrion', 'Rabid', 'Dire', 'Apostate', 'Bringer', 'Cleric',
                'Magi', 'Apothecary', 'Celestial'
            ]);

            // Save our perfected backend lookup map
            this.state.statsLookup = statsMap;

            // DEDUPLICATE FOR UI: 
            // Because we saved an _armor AND a _trinket version for everything, 
            // the modal will show two "Berserker's" options. Let's merge them for the user UI.
            const uniqueForUI = new Map();
            Array.from(statsMap.values()).forEach(stat => {
                const baseName = stat.name.replace(/'s\b/g, '').trim();
                if (pveStatCombos.has(baseName) && !uniqueForUI.has(stat.name)) {
                    uniqueForUI.set(stat.name, stat);
                }
            });

            this.state.availableStats = Array.from(uniqueForUI.values())
                .sort((a, b) => a.name.localeCompare(b.name));

        } catch (e) {
            console.error("Failed to load item stats", e);
        }
    }

    async loadUpgrades() {
        try {
            const res = await fetch(`data/upgrades.json?v=${Date.now()}`);
            this.state.availableUpgrades = await res.json();

            // Load consumables
            const consRes = await fetch(`data/consumables.json?v=${Date.now()}`);
            this.state.availableConsumables = await consRes.json();

            // NEW: Load feast stats and inject them into consumables
            try {
                const feastRes = await fetch(`data/feast-stats.json?v=${Date.now()}`);
                if (feastRes.ok) {
                    this.state.feastStats = await feastRes.json();

                    const injectFeastStats = (items) => {
                        items.forEach(item => {
                            if (this.state.feastStats[item.name]) {
                                // Combine specific food stats with the hardcoded global ascended stats
                                item.bonuses = [
                                    ...this.state.feastStats[item.name],
                                    ...this.state.ascendedFeastGlobals
                                ];
                            }
                        });
                    };

                    injectFeastStats(this.state.availableConsumables.food);
                    injectFeastStats(this.state.availableConsumables.utility);
                }
            } catch (feastErr) {
                console.warn("Could not load feast-stats.json", feastErr);
            }

        } catch (e) {
            console.error("Failed to load upgrades/consumables:", e);
        }
    }

    /**
     * Parse conversion bonuses from utility items and apply to totals
     * E.g., "Gain Power Equal to 3% of Your Precision"
     * This is called after all base stats are calculated so conversions can reference them
     */
    parseConversionBonus(bonusText, totals) {
        if (!bonusText || !totals) return;

        // Map bonus stat names to our internal stat names
        const targetStatMap = {
            'Power': 'Power',
            'Toughness': 'Toughness',
            'Vitality': 'Vitality',
            'Precision': 'Precision',
            'Ferocity': 'CritDamage',
            'Healing': 'Healing',
            'Healing Power': 'Healing',
            'Condition Damage': 'ConditionDamage',
            'ConditionDamage': 'ConditionDamage'
        };

        // Map source stat names from conversion text to our internal names
        const sourceStatMap = {
            'Power': 'Power',
            'Toughness': 'Toughness',
            'Vitality': 'Vitality',
            'Precision': 'Precision',
            'Ferocity': 'CritDamage',
            'HealingPower': 'Healing',
            'Healing Power': 'Healing',
            'ConditionDamage': 'ConditionDamage',
            'Condition Damage': 'ConditionDamage'
        };

        // Parse conversion patterns like:
        // "Gain Power equal to 3% of your Precision"
        // "Gain Condition Damage equal to 6% of your Healing Power"
        const convRegex = /(?:Gain|Grants?|Provides?)\s+(\w+(?:\s+\w+)?)\s+(?:equal to\s+)?(\d+)%\s+of\s+(?:your\s+)?(\w+(?:\s+\w+)?)/gi;

        let match;
        while ((match = convRegex.exec(bonusText)) !== null) {
            const targetStatName = match[1].trim();
            const percent = parseInt(match[2]) / 100;
            const sourceStatName = match[3].replace(/\s+/g, '');

            const targetKey = targetStatMap[targetStatName];
            const sourceKey = sourceStatMap[sourceStatName];

            if (targetKey && sourceKey && totals[targetKey] !== undefined && totals[sourceKey] !== undefined) {
                const convertedValue = Math.floor(totals[sourceKey] * percent);
                totals[targetKey] += convertedValue;
                console.log(`Applied conversion: ${convertedValue} ${targetStatName} (${percent * 100}% of ${sourceStatName})`);
            }
        }
    }

    calculateUtilityBonus(item, baseStats) {
        if (!item || (!item.description && !item.bonuses && !(item.details && item.details.description))) return 0;

        const textLines = [
            ...(item.description ? item.description.split('\n') : []),
            ...(item.details?.description ? item.details.description.split('\n') : []),
            ...(item.bonuses || [])
        ];
        const textToParse = [...new Set(textLines.map(t => t.trim()).filter(Boolean))].join(' ');

        // Isolate stats
        const tempStats = { ...(baseStats || this.state.currentStats || {}) };
        let totalBonus = 0;

        // 1. Parse flat stats and inject them into our temp stats
        const flatRegex = /\+(\d+)\s+(Power|Toughness|Vitality|Precision|Ferocity|Healing\sPower|Condition\sDamage|Concentration|Expertise|to\s+All\s+(?:Stats|Attributes)|All\s+(?:Stats|Attributes))/ig;
        let match;
        const statMapFlat = {
            'power': 'Power', 'toughness': 'Toughness', 'vitality': 'Vitality',
            'precision': 'Precision', 'ferocity': 'CritDamage',
            'healingpower': 'Healing', 'conditiondamage': 'ConditionDamage',
            'concentration': 'BoonDuration', 'expertise': 'ConditionDuration'
        };

        const appliedFlats = new Set();
        while ((match = flatRegex.exec(textToParse)) !== null) {
            const val = parseInt(match[1]);
            const rawStatName = match[2].toLowerCase().replace(/\s+/g, '');
            const flatKey = `${val}_${rawStatName}`;

            if (!appliedFlats.has(flatKey)) {
                appliedFlats.add(flatKey);

                if (rawStatName.includes('allstats') || rawStatName.includes('allattributes')) {
                    totalBonus += (val * 9);
                    ['Power', 'Toughness', 'Vitality', 'Precision', 'CritDamage', 'Healing', 'ConditionDamage', 'BoonDuration', 'ConditionDuration'].forEach(s => {
                        if (tempStats[s] !== undefined) tempStats[s] += val;
                    });
                } else {
                    totalBonus += val;
                    if (statMapFlat[rawStatName] && tempStats[statMapFlat[rawStatName]] !== undefined) {
                        tempStats[statMapFlat[rawStatName]] += val;
                    }
                }
            }
        }

        // 2. Process percentage conversions using the updated temp stats
        const convRegex = /(?:Gain|Grants?)\s+(Power|Toughness|Vitality|Precision|Ferocity|Healing\s+Power|Condition\s+Damage|Concentration|Expertise)\s+(?:equal\s+to\s+)?(\d+)%\s+of\s+(?:your\s+)?(Power|Toughness|Vitality|Precision|Ferocity|Healing\s+Power|Condition\s+Damage|Concentration|Expertise)/ig;
        const appliedConvs = new Set();
        while ((match = convRegex.exec(textToParse)) !== null) {
            const targetStatStr = match[1].toLowerCase().replace(/\s+/g, '');
            const percent = parseInt(match[2]) / 100;
            const sourceStatStr = match[3].toLowerCase().replace(/\s+/g, '');

            const convKey = `${targetStatStr}_${percent}_${sourceStatStr}`;
            if (!appliedConvs.has(convKey)) {
                appliedConvs.add(convKey);
                const targetStatType = statMapFlat[sourceStatStr];
                const defaultStatValue = ['Power', 'Toughness', 'Vitality', 'Precision'].includes(targetStatType) ? 1000 : 0;
                const sourceValue = tempStats[targetStatType] !== undefined ? tempStats[targetStatType] : defaultStatValue;
                totalBonus += Math.floor(sourceValue * percent);
            }
        }

        return totalBonus;
    }

    getUtilityStatConversions(item, baseStats) {
        if (!item || (!item.description && !item.bonuses && !(item.details && item.details.description))) return [];

        const textLines = [
            ...(item.description ? item.description.split('\n') : []),
            ...(item.details?.description ? item.details.description.split('\n') : []),
            ...(item.bonuses || [])
        ];
        const textToParse = [...new Set(textLines.map(t => t.trim()).filter(Boolean))].join(' ');

        const tempStats = { ...(baseStats || this.state.currentStats || {}) };

        // 1. Inject flat stats first
        const flatRegex = /\+(\d+)\s+(Power|Toughness|Vitality|Precision|Ferocity|Healing\sPower|Condition\sDamage|Concentration|Expertise|to\s+All\s+(?:Stats|Attributes)|All\s+(?:Stats|Attributes))/ig;
        let match;
        const statMapFlat = {
            'power': 'Power', 'toughness': 'Toughness', 'vitality': 'Vitality',
            'precision': 'Precision', 'ferocity': 'CritDamage',
            'healingpower': 'Healing', 'conditiondamage': 'ConditionDamage',
            'concentration': 'BoonDuration', 'expertise': 'ConditionDuration',
            'boonduration': 'BoonDuration', 'conditionduration': 'ConditionDuration'
        };

        const appliedFlats = new Set();
        while ((match = flatRegex.exec(textToParse)) !== null) {
            const val = parseInt(match[1]);
            const rawStatName = match[2].toLowerCase().replace(/\s+/g, '');
            const flatKey = `${val}_${rawStatName}`;

            if (!appliedFlats.has(flatKey)) {
                appliedFlats.add(flatKey);

                if (rawStatName.includes('allstats') || rawStatName.includes('allattributes')) {
                    ['Power', 'Toughness', 'Vitality', 'Precision', 'CritDamage', 'Healing', 'ConditionDamage', 'BoonDuration', 'ConditionDuration'].forEach(s => {
                        if (tempStats[s] !== undefined) tempStats[s] += val;
                    });
                } else {
                    if (statMapFlat[rawStatName] && tempStats[statMapFlat[rawStatName]] !== undefined) {
                        tempStats[statMapFlat[rawStatName]] += val;
                    }
                }
            }
        }

        // 2. Find conversions
        const convRegex = /(?:Gain|Grants?)\s+(Power|Toughness|Vitality|Precision|Ferocity|Healing\s+Power|Condition\s+Damage|Concentration|Expertise|Boon\s+Duration|Condition\s+Duration)\s+(?:equal\s+to\s+)?(\d+)%\s+of\s+(?:your\s+)?(Power|Toughness|Vitality|Precision|Ferocity|Healing\s+Power|Condition\s+Damage|Concentration|Expertise|Boon\s+Duration|Condition\s+Duration)/ig;
        const conversions = [];

        while ((match = convRegex.exec(textToParse)) !== null) {
            const displayTarget = match[1].replace(/\s+/g, ' ');
            const percent = parseInt(match[2]) / 100;
            const sourceStatStr = match[3].toLowerCase().replace(/\s+/g, '');

            const convKey = `${displayTarget.toLowerCase().replace(/\s+/g, '')}_${percent}_${sourceStatStr}`;
            const targetStatType = statMapFlat[sourceStatStr];
            const defaultStatValue = ['Power', 'Toughness', 'Vitality', 'Precision'].includes(targetStatType) ? 1000 : 0;
            const sourceValue = tempStats[targetStatType] !== undefined ? tempStats[targetStatType] : defaultStatValue;

            // Deduplicate exact conversion
            if (!conversions.some(c => c.startsWith(`+`) && c.endsWith(displayTarget) && c.includes(Math.floor(sourceValue * percent).toString()))) {
                const bonusVal = Math.floor(sourceValue * percent);

                if (bonusVal >= 0) {
                    conversions.push(`+${bonusVal} ${displayTarget}`);
                }
            }
        }
        return conversions;
    }

    /**
     * Toggle sort utility button for consumables modal
     */
    toggleSortUtility() {
        this.state.sortUtilityActive = !this.state.sortUtilityActive;
        const sortBtn = document.getElementById('sort-utility-btn');
        if (sortBtn) {
            if (this.state.sortUtilityActive) {
                sortBtn.classList.add('active');
                sortBtn.title = 'Sorted by total stat bonus (click to sort by name)';
            } else {
                sortBtn.classList.remove('active');
                sortBtn.title = 'Sorted by name (click to sort by total stat bonus)';
            }
        }
        // Re-render the current list if we're in Consumables modal
        if (['Food', 'UtilityItem'].includes(this.state.currentSlotType)) {
            this.renderSelectionList(document.getElementById('stat-search').value);
        }
    }

    formatPrice(coins) {
        if (!coins) return '0c';
        const g = Math.floor(coins / 10000);
        const s = Math.floor((coins % 10000) / 100);
        const c = coins % 100;

        let html = '';
        if (g > 0) html += `${g}<span style="color:#e5c43d; font-weight:bold; margin-right:4px;">g</span>`;
        if (s > 0 || g > 0) html += `${s}<span style="color:#c0c0c0; font-weight:bold; margin-right:4px;">s</span>`;
        html += `${c}<span style="color:#c77d4c; font-weight:bold;">c</span>`;

        return html;
    }

    async fetchPricesForConsumables() {
        const idsToFetch = [];
        const allConsumables = [...this.state.availableConsumables.food, ...this.state.availableConsumables.utility];

        allConsumables.forEach(c => {
            if (c.id && this.state.tpPrices[c.id] === undefined) {
                idsToFetch.push(c.id);
                this.state.tpPrices[c.id] = null; // Mark as fetching to prevent duplicate calls
            }
        });

        if (idsToFetch.length > 0) {
            const prices = await api.getPrices(idsToFetch);
            prices.forEach(p => {
                this.state.tpPrices[p.id] = p;
            });
            // Re-render list to show newly loaded prices if modal is still open for food/utility
            if (['Food', 'UtilityItem'].includes(this.state.currentSlotType)) {
                this.renderSelectionList(document.getElementById('stat-search').value);
            }
        }
    }

    async loadProfessions() {
        try {
            const professionIds = await api.getProfessions();
            this.state.professionsCache = [];

            // Fetch full profession data including icons
            for (const profId of professionIds) {
                try {
                    const profData = await api.getProfession(profId);
                    this.state.professionsCache.push(profData);
                } catch (e) {
                    console.error(`Failed to load profession ${profId}`, e);
                }
            }
        } catch (e) {
            console.error("Failed to load professions on init", e);
        }
    }

    setupEventListeners() {
        // Profession display click handler
        const professionDisplay = document.getElementById('profession-display');
        professionDisplay.addEventListener('click', () => this.openProfessionPicker());

        const saveBtn = document.getElementById('save-build-btn');
        saveBtn.addEventListener('click', () => this.saveBuild());

        const newBtn = document.getElementById('new-build-btn');
        newBtn.addEventListener('click', () => this.newBuild());

        const exportBtn = document.getElementById('export-code-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportBuild());
        }

        const importBtn = document.getElementById('import-code-btn');
        if (importBtn) {
            importBtn.addEventListener('click', () => this.importBuild());
        }

        document.getElementById('close-modal-btn').addEventListener('click', () => this.closeStatModal());
        const statSearch = document.getElementById('stat-search');
        statSearch.addEventListener('input', (e) => this.renderSelectionList(e.target.value));

        // NEW FILTER LISTENER FOR UTILITIES
        const utilityFilter = document.getElementById('utility-stat-filter');
        if (utilityFilter) {
            utilityFilter.addEventListener('change', (e) => {
                this.state.utilityStatFilter = e.target.value;
                this.renderSelectionList(document.getElementById('stat-search').value);
            });
        }

        // Profession modal event listeners

        document.getElementById('close-profession-modal-btn').addEventListener('click', () => this.closeProfessionModal());
        document.getElementById('profession-modal').addEventListener('click', (e) => {
            if (e.target.id === 'profession-modal') {
                this.closeProfessionModal();
            }
        });

        // Spec modal event listeners
        document.getElementById('close-spec-modal-btn').addEventListener('click', () => this.closeSpecModal());
        document.getElementById('spec-modal').addEventListener('click', (e) => {
            if (e.target.id === 'spec-modal') {
                this.closeSpecModal();
            }
        });

        // Failsafe: Ensure clicks anywhere globally hide persistent tooltips unless intercepted
        document.addEventListener('click', () => {
            const t = document.getElementById('global-tooltip');
            if (t && !t.classList.contains('hidden')) t.classList.add('hidden');
        }, true); // Use capture phase to guarantee execution

        // Legend swap button event listener
        const legendSwapBtn = document.getElementById('legend-swap-btn');
        if (legendSwapBtn) {
            legendSwapBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.swapLegends();
            });
        }

        // Sort utility button event listener (for consumables modal)
        const sortUtilityBtn = document.getElementById('sort-utility-btn');
        if (sortUtilityBtn) {
            sortUtilityBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSortUtility();
            });
        }

        // Import from Game event listeners
        const importGameBtn = document.getElementById('import-game-btn');
        if (importGameBtn) {
            importGameBtn.addEventListener('click', () => this.openImportGameModal());
        }

        const closeImportGameBtn = document.getElementById('close-import-game-btn');
        if (closeImportGameBtn) {
            closeImportGameBtn.addEventListener('click', () => {
                document.getElementById('import-game-modal').classList.add('hidden');
            });
        }

        const saveApiKeyBtn = document.getElementById('save-api-key-btn');
        if (saveApiKeyBtn) {
            saveApiKeyBtn.addEventListener('click', () => this.saveApiKey());
        }

        const apiKeySelector = document.getElementById('api-key-selector');
        if (apiKeySelector) {
            apiKeySelector.addEventListener('change', (e) => this.loadCharactersForAccount(e.target.value));
        }

        const characterSelector = document.getElementById('character-selector');
        if (characterSelector) {
            characterSelector.addEventListener('change', (e) => this.loadCharacterTabs(e.target.value));
        }

        const executeImportBtn = document.getElementById('execute-import-btn');
        if (executeImportBtn) {
            executeImportBtn.addEventListener('click', () => this.executeGameImport());
        }

        // Close import modal when clicking outside
        const importGameModal = document.getElementById('import-game-modal');
        if (importGameModal) {
            importGameModal.addEventListener('click', (e) => {
                if (e.target.id === 'import-game-modal') {
                    importGameModal.classList.add('hidden');
                }
            });
        }
    }

    setupEquipmentSlots() {
        const slots = document.querySelectorAll('.slot:not(.weapon-type-selector select), .upgrade-slot, .relic-slot');
        slots.forEach(slot => {
            slot.addEventListener('click', (e) => {
                // Prevent click from bubbling up if an upgrade slot is clicked inside a normal slot container
                e.stopPropagation();

                const slotName = slot.getAttribute('data-slot');
                const slotType = slot.getAttribute('data-type') || 'Stat';
                this.openSelectionModal(slotName, slotType);
            });
            this.addTooltipEvents(slot);
        });

        // Setup weapon type dropdowns
        const weaponTypes = ['Axe', 'Dagger', 'Mace', 'Pistol', 'Sword', 'Scepter', 'Focus', 'Shield', 'Torch', 'Warhorn', 'Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff'];
        document.querySelectorAll('.weapon-type-selector select').forEach(select => {
            weaponTypes.forEach(type => select.appendChild(new Option(type, type)));
            select.addEventListener('change', (e) => this.handleWeaponTypeChange(e.target.getAttribute('data-target'), e.target.value));
        });

        // Setup weapon set toggle button
        const weaponSetToggleBtn = document.getElementById('weapon-set-toggle-btn');
        if (weaponSetToggleBtn) {
            weaponSetToggleBtn.addEventListener('click', () => this.toggleWeaponSet());
        }

        // Initialize weapon set visual state
        this.updateWeaponSetActiveState();
    }

    setupSkillSlots() {
        const skillSlots = document.querySelectorAll('.skill-slot');
        skillSlots.forEach(slot => {
            // Initialize empty state
            if (!slot.classList.contains('has-skill')) {
                slot.classList.add('empty');
            }

            slot.addEventListener('click', (e) => {
                e.stopPropagation();
                const slotName = slot.getAttribute('data-slot');
                const slotType = slot.getAttribute('data-type');
                this.openSkillSelectionModal(slotName, slotType);
            });
            this.addSkillTooltipEvents(slot);
        });
    }

    async openSkillSelectionModal(slotName, slotType) {
        // Force hide tooltip when opening a modal
        document.getElementById('global-tooltip').classList.add('hidden');

        const profession = this.state.currentBuild.profession;
        if (!profession) {
            alert('Please select a profession first');
            return;
        }

        // Get elite specialization IDs from current selections
        const eliteSpecIds = this.getSelectedEliteSpecIds();

        // Load skills for this slot type if not already cached
        // Note: We need to clear cache when specializations change, but for now
        // we'll reload if the elite spec IDs don't match what was cached
        const cacheKey = `${slotType.toLowerCase()}_${eliteSpecIds.join('_')}`;
        if (!this.state.availableSkills[cacheKey] || this.state.availableSkills[cacheKey].length === 0) {
            try {
                const skills = await api.getSkillsBySlot(profession, slotType, eliteSpecIds);
                this.state.availableSkills[cacheKey] = skills;
            } catch (error) {
                console.error(`Failed to load ${slotType} skills:`, error);
                return;
            }
        }

        this.state.currentSlotSelection = slotName;
        this.state.currentSlotType = slotType;
        this.state.currentSkillCacheKey = cacheKey;

        // Create or show skill modal
        this.showSkillModal(slotName, slotType);
    }

    showSkillModal(slotName, slotType) {
        // Check if skill modal exists, create if not
        let modal = document.getElementById('skill-modal');
        if (!modal) {
            modal = this.createSkillModal();
        }

        // Update modal title
        const title = modal.querySelector('#skill-modal-title');
        if (title) {
            title.textContent = `Select ${slotType} Skill`;
        }

        // Render skills list
        this.renderSkillList(slotType.toLowerCase());

        modal.classList.remove('hidden');
    }

    createSkillModal() {
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'skill-modal';
        modalOverlay.className = 'modal-overlay hidden';

        modalOverlay.innerHTML = `
            <div class="modal-content glass-panel">
                <div class="modal-header">
                    <h3 id="skill-modal-title">Select Skill</h3>
                    <button id="close-skill-modal-btn" class="close-btn">&times;</button>
                </div>
                <input type="text" id="skill-search" placeholder="Search skills..." class="styled-select mb-1" />
                <div class="skills-grid-modal" id="modal-skill-list">
                    <!-- Skills will be injected here -->
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        // Add event listeners
        modalOverlay.querySelector('#close-skill-modal-btn').addEventListener('click', () => {
            modalOverlay.classList.add('hidden');
        });

        modalOverlay.querySelector('#skill-search').addEventListener('input', (e) => {
            this.renderSkillList(this.state.currentSlotType.toLowerCase(), e.target.value);
        });

        // Close modal when clicking outside
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.classList.add('hidden');
            }
        });

        return modalOverlay;
    }

    renderSkillList(slotType, filter = '') {
        const container = document.getElementById('modal-skill-list');
        if (!container) return;

        container.innerHTML = '';
        const lowerFilter = filter.toLowerCase();
        // Use the current cache key if available, otherwise fall back to slotType
        const cacheKey = this.state.currentSkillCacheKey || slotType;
        const skills = this.state.availableSkills[cacheKey];

        if (!skills || skills.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'skill-modal-item';
            emptyMsg.textContent = 'No skills available';
            container.appendChild(emptyMsg);
            return;
        }

        // --- NEW: ADD CLEAR OPTION ---
        const clearItem = document.createElement('div');
        clearItem.className = 'skill-modal-item';
        clearItem.innerHTML = `
            <div style="width: 48px; height: 48px; border-radius: 4px; background: rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; color:#ccc; font-weight:bold; font-size:1.5rem;">&times;</div>
            <div class="skill-modal-name">Clear Skill</div>
        `;
        clearItem.addEventListener('click', () => this.selectSkillForSlot(null));
        container.appendChild(clearItem);

        skills.forEach(skill => {
            if (filter && !skill.name.toLowerCase().includes(lowerFilter)) return;

            const skillItem = document.createElement('div');
            skillItem.className = 'skill-modal-item';

            skillItem.innerHTML = `
                <img class="skill-modal-icon" src="${skill.icon}" alt="${skill.name}" />
                <div class="skill-modal-name">${skill.name}</div>
            `;

            skillItem.addEventListener('click', () => this.selectSkillForSlot(skill));

            // Add tooltip events
            this.addSkillModalTooltipEvents(skillItem, skill);

            container.appendChild(skillItem);
        });
    }

    selectSkillForSlot(skill) {
        if (!this.state.currentSlotSelection) return;

        const slotName = this.state.currentSlotSelection;
        const slotType = this.state.currentSlotType.toLowerCase();

        // Update state
        if (slotType === 'heal') {
            this.state.currentBuild.skills.heal = skill;
        } else if (slotType === 'elite') {
            this.state.currentBuild.skills.elite = skill;
        } else if (slotType === 'utility') {
            // Determine which utility slot (1, 2, or 3)
            const index = parseInt(slotName.replace('utility', '')) - 1;
            if (index >= 0 && index < 3) {
                this.state.currentBuild.skills.utility[index] = skill;
            }
        }

        // Update UI
        this.updateSkillSlotUI(slotName, skill);

        // Close modal
        document.getElementById('skill-modal').classList.add('hidden');

        // Update toolbelt skills if Scrapper
        this.onSkillsChanged();
    }

    updateSkillSlotUI(slotName, skill) {
        const slotEl = document.querySelector(`[data-slot="${slotName}"]`);
        if (!slotEl) return;

        const iconEl = slotEl.querySelector('.skill-icon');
        if (!skill) {
            if (iconEl) {
                iconEl.src = '';
                iconEl.alt = '';
            }
            slotEl.classList.remove('has-skill');
            slotEl.classList.add('empty');
            return;
        }

        if (iconEl) {
            iconEl.src = skill.icon;
            iconEl.alt = skill.name;
            slotEl.classList.add('has-skill');
            slotEl.classList.remove('empty');
        }
    }

    formatSkillTooltipDescHtml(skill) {
        let descHtml = skill.description ? skill.description.replace(/\n|<br>/g, '<br>') : 'No description available';

        if (skill.facts && skill.facts.length > 0) {
            const factsHtml = skill.facts.map(f => {
                let valStr = '';
                if (f.type === 'AttributeAdjust') valStr = `+${f.value}`;
                else if (f.type === 'Percent') valStr = `${f.percent || f.value}%`;
                else if (f.type === 'Time') valStr = `${f.duration}s`;
                else if (f.type === 'Damage') valStr = `${f.hit_count}x`;
                else if (f.type === 'Number') valStr = `${f.value}`;
                else if (f.type === 'Distance' || f.type === 'Radius') valStr = `${f.distance}`;
                else if (f.type === 'ComboField') valStr = `${f.field_type}`;
                else if (f.type === 'Recharge') valStr = `${f.percent || f.value}%`;
                else if (f.type === 'Unblockable') valStr = 'Unblockable';
                else if (f.type === 'Buff') {
                    if (UNCONDITIONAL_SKILL_BONUSES[skill.id] && f.status && f.status.includes('Signet') && f.duration === 0) {
                        return `Signet Passive: ${UNCONDITIONAL_SKILL_BONUSES[skill.id].display}`;
                    } else {
                        valStr = `${f.status}${f.duration ? ` (${f.duration}s)` : ''}`;
                        if (f.apply_count) valStr = `${f.apply_count}x ` + valStr;
                    }
                }

                let finalStr = '';
                let textLabel = f.text || (f.type === 'AttributeAdjust' ? f.target : '');

                if (f.type === 'Buff' && textLabel === 'Apply Buff/Condition') textLabel = '';
                if (f.type === 'Damage' && textLabel === 'Damage') {
                    textLabel = 'Damage';
                    valStr = `${f.hit_count}x (varies)`;
                }

                if (textLabel && valStr) finalStr = `${textLabel}: ${valStr}`;
                else if (textLabel) finalStr = textLabel;
                else if (valStr) finalStr = valStr;

                return finalStr;
            }).filter(Boolean).join('<br>');

            if (factsHtml) {
                descHtml += `<br><br><span style="color:var(--accent);">${factsHtml}</span>`;
            }
        }
        return descHtml;
    }

    addSkillTooltipEvents(el) {
        const tooltip = document.getElementById('global-tooltip');

        el.addEventListener('mouseenter', (e) => {
            const statModal = document.getElementById('stat-modal');
            const skillModal = document.getElementById('skill-modal');

            if ((statModal && !statModal.classList.contains('hidden')) ||
                (skillModal && !skillModal.classList.contains('hidden'))) return;

            const slotName = el.getAttribute('data-slot');
            const slotType = el.getAttribute('data-type').toLowerCase();
            let skill = null;

            if (slotType === 'heal') {
                skill = this.state.currentBuild.skills.heal;
            } else if (slotType === 'elite') {
                skill = this.state.currentBuild.skills.elite;
            } else if (slotType === 'utility') {
                const index = parseInt(slotName.replace('utility', '')) - 1;
                if (index >= 0 && index < 3) {
                    skill = this.state.currentBuild.skills.utility[index];
                }
            }

            if (!skill) return;

            document.getElementById('tooltip-title').textContent = skill.name;
            document.getElementById('tooltip-desc').innerHTML = this.formatSkillTooltipDescHtml(skill);

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    addSkillModalTooltipEvents(el, skill) {
        const tooltip = document.getElementById('global-tooltip');

        el.addEventListener('mouseenter', (e) => {
            document.getElementById('tooltip-title').textContent = skill.name;
            document.getElementById('tooltip-desc').innerHTML = this.formatSkillTooltipDescHtml(skill);

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    addTooltipEvents(el) {
        const tooltip = document.getElementById('global-tooltip');

        // Correct attribute_adjustment values for Ascended items (Level 80)
        // Source: GW2 Wiki API:2/itemstats
        const attributeAdjustment = {
            Helm: 179.256, Shoulders: 134.442, Coat: 403.326, Gloves: 134.442, Leggings: 268.884, Boots: 134.442,
            WeaponA1: 358.512, WeaponA2: 358.512, WeaponB1: 358.512, WeaponB2: 358.512,
            Backpack: 89.628, Accessory1: 224.07, Accessory2: 224.07, Amulet: 358.512, Ring1: 268.884, Ring2: 268.884
        };

        // 2H weapons have higher attribute_adjustment
        const twoHandedWeapons = ['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff'];

        const attrMap = {
            CritDamage: 'Ferocity',
            BoonDuration: 'Concentration',
            ConditionDuration: 'Expertise',
            Healing: 'Healing Power'
        };

        el.addEventListener('mouseenter', (e) => {
            // Prevent tooltips from showing if the selection modal is open
            if (!document.getElementById('stat-modal').classList.contains('hidden')) return;

            const slotName = el.getAttribute('data-slot');
            const itemObj = this.state.currentBuild.equipment[slotName];
            if (!itemObj) return;

            document.getElementById('tooltip-title').textContent = itemObj.name || itemObj.type;

            let descHtml = '';

            let descParts = [];
            // 1. Add Rune/Sigil bonuses if they exist (Food/Utility don't need (1): prefix)
            const isFoodOrUtility = slotName === 'Food' || slotName === 'UtilityItem';
            if (itemObj.bonuses && itemObj.bonuses.length > 0) {
                if (isFoodOrUtility) {
                    descParts.push(itemObj.bonuses.join('<br>'));
                } else {
                    descParts.push(itemObj.bonuses.map((b, i) => `(${i + 1}): ${b}`).join('<br>'));
                }
            }
            // 2. Add the nested details.description (where Feasts hide their stats)
            if (itemObj.details && itemObj.details.description) {
                descParts.push(itemObj.details.description.replace(/\n/g, '<br>'));
            }
            // 3. Add base description (Avoid duplicating text if it matches details.description)
            if (itemObj.description) {
                if (!itemObj.details || itemObj.details.description !== itemObj.description) {
                    descParts.push(itemObj.description.replace(/\n/g, '<br>'));
                }
            }
            // 4. Add infix_upgrade.buff.description (for Feasts and other consumables)
            if (itemObj.details && itemObj.details.infix_upgrade && itemObj.details.infix_upgrade.buff) {
                if (itemObj.details.infix_upgrade.buff.description) {
                    descParts.push(itemObj.details.infix_upgrade.buff.description.replace(/\n/g, '<br>'));
                }
            }

            if (descParts.length > 0) {
                descHtml = [...new Set(descParts)].join('<br><br>');
            } else if (itemObj.attributes) {
                // Compute actual stat value if this is an equipment slot
                let adj = attributeAdjustment[slotName] || 0;
                // Use correct attribute_adjustment for 2H weapons
                if (slotName.startsWith('Weapon')) {
                    const weaponType = this.state.weaponTypes[slotName];
                    if (twoHandedWeapons.includes(weaponType)) {
                        adj = 717.024; // 2H weapon attribute_adjustment (ascended)
                    }
                }

                // Determine if this is a trinket slot
                const isTrinket = ['Backpack', 'Accessory1', 'Accessory2', 'Amulet', 'Ring1', 'Ring2'].includes(slotName);

                // Get the correct stat variant (armor or trinket) from our lookup map
                let actualAttributes = itemObj.attributes;
                if (this.state.statsLookup && itemObj.name) {
                    const statType = isTrinket ? 'trinket' : 'armor';
                    const lookupKey = `${itemObj.name}_${statType}`;
                    const variantStat = this.state.statsLookup.get(lookupKey);
                    if (variantStat && variantStat.attributes) {
                        actualAttributes = variantStat.attributes;
                    }
                }

                descHtml = actualAttributes.map(a => {
                    const displayName = attrMap[a.attribute] || a.attribute;
                    // Correct formula from wiki: round(attribute_adjustment * multiplier) + value
                    const val = Math.round(adj * a.multiplier) + (a.value || 0);
                    return `+${val} ${displayName}`;
                }).join('<br>');
            }

            document.getElementById('tooltip-desc').innerHTML = descHtml;

            // --- COMPUTE STATS EXCLUDING CURRENT SLOT FOR LIVE CALCULATION ---
            if (['Food', 'UtilityItem'].includes(slotName)) {
                const liveStats = this.computeStats(slotName);
                const conversions = this.getUtilityStatConversions(itemObj, liveStats);
                if (conversions.length > 0) {
                    document.getElementById('tooltip-desc').innerHTML += `<br><br><span style="color:var(--accent); font-weight:bold;">Calculated Conversions:<br>${conversions.join('<br>')}</span>`;
                }
            }
            // --- END REPLACE ---

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });
        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });
        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    handleWeaponTypeChange(slotTarget, weaponType) {
        this.state.weaponTypes[slotTarget] = weaponType;
        const is2H = ['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff'].includes(weaponType);

        let relatedOffhandSet, relatedSigil2;
        if (slotTarget === 'WeaponA1') { relatedOffhandSet = document.getElementById('wA2-container'); relatedSigil2 = document.querySelector('[data-slot="WeaponA1Sigil2"]'); }
        if (slotTarget === 'WeaponB1') { relatedOffhandSet = document.getElementById('wB2-container'); relatedSigil2 = document.querySelector('[data-slot="WeaponB1Sigil2"]'); }

        if (relatedOffhandSet) {
            if (is2H) {
                relatedOffhandSet.style.opacity = '0.3';
                relatedOffhandSet.style.pointerEvents = 'none';
                if (relatedSigil2) relatedSigil2.style.display = 'flex';
            } else {
                relatedOffhandSet.style.opacity = '1';
                relatedOffhandSet.style.pointerEvents = 'auto';
                if (relatedSigil2) relatedSigil2.style.display = 'none';
            }
        }
    }

    openSelectionModal(slotName, type) {
        // Force hide tooltip when opening a modal to prevent it from getting stuck
        document.getElementById('global-tooltip').classList.add('hidden');

        this.state.currentSlotSelection = slotName;
        this.state.currentSlotType = type;
        document.getElementById('modal-title').innerHTML = `Select ${type} for <span id="modal-slot-name">${slotName}</span>`;
        document.getElementById('stat-search').value = '';

        // Show/hide apply-to section based on slot type
        const applyToSection = document.getElementById('apply-to-section');
        if (type === 'Stat' || type === 'Rune' || type === 'Sigil') {
            applyToSection.classList.remove('hidden');
            this.setupApplyToCheckboxes(type);
        } else {
            applyToSection.classList.add('hidden');
        }

        // Show/hide sort utility button for Consumables
        const sortBtn = document.getElementById('sort-utility-btn');
        if (sortBtn) {
            if (['Food', 'UtilityItem'].includes(type)) {
                sortBtn.classList.remove('hidden');
                // Update button state based on current sort setting
                if (this.state.sortUtilityActive) {
                    sortBtn.classList.add('active');
                    sortBtn.title = 'Sorted by total stat bonus (click to sort by name)';
                } else {
                    sortBtn.classList.remove('active');
                    sortBtn.title = 'Sorted by name (click to sort by total stat bonus)';
                }
            } else {
                sortBtn.classList.add('hidden');
            }
        }

        // NEW: Show/hide utility filter for Consumables
        const utilityFilterContainer = document.getElementById('utility-filter-container');
        if (utilityFilterContainer) {
            if (['Food', 'UtilityItem'].includes(type)) {
                utilityFilterContainer.classList.remove('hidden');
            } else {
                utilityFilterContainer.classList.add('hidden');
            }
        }

        // Fetch Trading Post prices for consumables
        if (type === 'Food' || type === 'UtilityItem') {
            this.fetchPricesForConsumables();
        }

        this.renderSelectionList();

        document.getElementById('stat-modal').classList.remove('hidden');
    }

    /**
     * Setup apply-to checkbox event listeners
     * @param {string} slotType - The type of slot ('Stat', 'Rune', 'Sigil')
     */
    setupApplyToCheckboxes(slotType = 'Stat') {
        const applyArmor = document.getElementById('apply-armor');
        const applyWeapons = document.getElementById('apply-weapons');
        const applyTrinkets = document.getElementById('apply-trinkets');
        const applyAll = document.getElementById('apply-all');

        // Update checkbox labels based on slot type
        const armorLabel = applyArmor.parentElement;
        const weaponsLabel = applyWeapons.parentElement;
        const trinketsLabel = applyTrinkets.parentElement;

        if (slotType === 'Rune') {
            armorLabel.innerHTML = '<input type="checkbox" id="apply-armor"> All Armor Runes';
            weaponsLabel.style.display = 'none';
            trinketsLabel.style.display = 'none';
        } else if (slotType === 'Sigil') {
            armorLabel.style.display = 'none';
            weaponsLabel.innerHTML = '<input type="checkbox" id="apply-weapons"> All Weapon Sigils (Slot 1)';
            trinketsLabel.style.display = 'none';
        } else {
            // Stat type - show all
            armorLabel.innerHTML = '<input type="checkbox" id="apply-armor"> All Armor';
            armorLabel.style.display = '';
            weaponsLabel.innerHTML = '<input type="checkbox" id="apply-weapons"> All Weapons';
            weaponsLabel.style.display = '';
            trinketsLabel.innerHTML = '<input type="checkbox" id="apply-trinkets"> All Trinkets';
            trinketsLabel.style.display = '';
        }

        // Re-get elements after updating innerHTML
        const newApplyArmor = document.getElementById('apply-armor');
        const newApplyWeapons = document.getElementById('apply-weapons');
        const newApplyTrinkets = document.getElementById('apply-trinkets');
        const newApplyAll = document.getElementById('apply-all');

        // Reset all checkboxes
        if (newApplyArmor) newApplyArmor.checked = false;
        if (newApplyWeapons) newApplyWeapons.checked = false;
        if (newApplyTrinkets) newApplyTrinkets.checked = false;
        if (newApplyAll) newApplyAll.checked = false;

        // Remove existing listeners by cloning elements
        if (newApplyArmor) {
            const clonedArmor = newApplyArmor.cloneNode(true);
            newApplyArmor.parentNode.replaceChild(clonedArmor, newApplyArmor);
        }
        if (newApplyWeapons) {
            const clonedWeapons = newApplyWeapons.cloneNode(true);
            newApplyWeapons.parentNode.replaceChild(clonedWeapons, newApplyWeapons);
        }
        if (newApplyTrinkets) {
            const clonedTrinkets = newApplyTrinkets.cloneNode(true);
            newApplyTrinkets.parentNode.replaceChild(clonedTrinkets, newApplyTrinkets);
        }
        if (newApplyAll) {
            const clonedAll = newApplyAll.cloneNode(true);
            newApplyAll.parentNode.replaceChild(clonedAll, newApplyAll);
        }

        // Re-get elements after cloning
        const finalApplyArmor = document.getElementById('apply-armor');
        const finalApplyWeapons = document.getElementById('apply-weapons');
        const finalApplyTrinkets = document.getElementById('apply-trinkets');
        const finalApplyAll = document.getElementById('apply-all');

        // Add event listeners for "All Categories" checkbox
        if (finalApplyAll) {
            finalApplyAll.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                if (finalApplyArmor) finalApplyArmor.checked = isChecked;
                if (finalApplyWeapons) finalApplyWeapons.checked = isChecked;
                if (finalApplyTrinkets) finalApplyTrinkets.checked = isChecked;
            });
        }

        // Add event listeners for individual category checkboxes
        const updateAllCheckbox = () => {
            if (finalApplyAll) {
                const armorChecked = finalApplyArmor ? finalApplyArmor.checked : true;
                const weaponsChecked = finalApplyWeapons ? finalApplyWeapons.checked : true;
                const trinketsChecked = finalApplyTrinkets ? finalApplyTrinkets.checked : true;
                finalApplyAll.checked = armorChecked && weaponsChecked && trinketsChecked;
            }
        };

        if (finalApplyArmor) finalApplyArmor.addEventListener('change', updateAllCheckbox);
        if (finalApplyWeapons) finalApplyWeapons.addEventListener('change', updateAllCheckbox);
        if (finalApplyTrinkets) finalApplyTrinkets.addEventListener('change', updateAllCheckbox);
    }

    /**
     * Get slots to apply stat to based on checkbox selections
     * @returns {string[]} Array of slot names to apply the stat to
     */
    getSlotsToApply() {
        const applyArmor = document.getElementById('apply-armor');
        const applyWeapons = document.getElementById('apply-weapons');
        const applyTrinkets = document.getElementById('apply-trinkets');

        const slotsToApply = [];
        const slotType = this.state.currentSlotType;

        if (slotType === 'Rune') {
            // For runes, apply to armor rune slots
            if (applyArmor && applyArmor.checked) {
                slotsToApply.push(...this.slotCategories.armorRunes);
            }
        } else if (slotType === 'Sigil') {
            // For sigils, apply to weapon sigil slot 1
            if (applyWeapons && applyWeapons.checked) {
                slotsToApply.push(...this.slotCategories.weaponSigils1);
            }
        } else {
            // For stats, apply to equipment slots
            if (applyArmor && applyArmor.checked) {
                slotsToApply.push(...this.slotCategories.armor);
            }
            if (applyWeapons && applyWeapons.checked) {
                slotsToApply.push(...this.slotCategories.weapons);
            }
            if (applyTrinkets && applyTrinkets.checked) {
                slotsToApply.push(...this.slotCategories.trinkets);
            }
        }

        return slotsToApply;
    }

    closeStatModal() {
        this.state.currentSlotSelection = null;
        document.getElementById('stat-modal').classList.add('hidden');
        document.getElementById('global-tooltip').classList.add('hidden'); // Failsafe
    }

    renderSelectionList(filter = '') {
        const container = document.getElementById('modal-stat-list');
        container.innerHTML = '';
        const lowerFilter = filter.toLowerCase();

        let listData = [];
        if (this.state.currentSlotType === 'Stat') listData = this.state.availableStats;
        else if (this.state.currentSlotType === 'Relic') listData = this.state.availableUpgrades.relics;
        else if (this.state.currentSlotType === 'Food') listData = this.state.availableConsumables.food;
        else if (this.state.currentSlotType === 'UtilityItem') listData = this.state.availableConsumables.utility;
        else listData = this.state.availableUpgrades.upgrades.filter(u => u.type === this.state.currentSlotType);

        // Sort Consumables if active - use computeStats for live calculation
        if (['Food', 'UtilityItem'].includes(this.state.currentSlotType) && this.state.sortUtilityActive) {
            // Calculate bonuses with current stats excluding the current slot (if already equipped)
            const currentSlot = this.state.currentSlotSelection;
            const liveStats = this.computeStats(currentSlot);
            listData = [...listData].sort((a, b) => this.calculateUtilityBonus(b, liveStats) - this.calculateUtilityBonus(a, liveStats));
        }

        // Filter by stat if Consumable with stat filter active
        if (['Food', 'UtilityItem'].includes(this.state.currentSlotType) && this.state.utilityStatFilter) {
            const filterStat = this.state.utilityStatFilter;
            listData = listData.filter(item => {
                if (!item.bonuses && !item.description) return false;
                const textToCheck = (item.bonuses ? item.bonuses.join(' ') : '') + ' ' + (item.description || '');

                // Always allow items that grant ALL stats (e.g., Celestial-like items / +45 All Attributes)
                const allStatsRegex = /\+\d+%?\s+(to\s+)?All\s+(Stats|Attributes)\b/i;
                if (allStatsRegex.test(textToCheck)) return true;

                // Map filter values to what might appear in the item text
                const statMap = {
                    'Power': ['Power'],
                    'Condition Damage': ['Condition Damage'],
                    'Concentration': ['Concentration', 'Boon Duration'],
                    'Healing Power': ['Healing Power'],
                    'Precision': ['Precision'],
                    'Ferocity': ['Ferocity', 'Critical Damage'],
                    'Expertise': ['Expertise', 'Condition Duration'],
                    'Toughness': ['Toughness'],
                    'Vitality': ['Vitality']
                };
                const searchTerms = statMap[filterStat] || [filterStat];

                return searchTerms.some(term => {
                    // Escape regex special characters just in case
                    const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                    // Match pattern:
                    // 1. +<number>[%] <Term> (e.g. "+100 Power", "+10% Boon Duration")
                    // 2. Gain <Term> (e.g. "Gain Condition Damage equal to...")
                    // 3. Grants <Term> 
                    // This STRICTLY ensures the stat is being GIVEN, ignoring "of your Power" or "Healing Power" (when searching 'Power').
                    const regex = new RegExp(`(?:(?:\\+?\\d+%?\\s+|(?:Gain|Grants?)\\s+)${safeTerm}\\b)`, 'i');
                    return regex.test(textToCheck);
                });
            });
        }

        // --- NEW: ADD CLEAR OPTION (Just before listData.forEach) ---
        if (['Food', 'UtilityItem', 'Rune', 'Sigil', 'Relic'].includes(this.state.currentSlotType)) {
            const clearEl = document.createElement('div');
            clearEl.className = 'stat-list-item';
            clearEl.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="width: 32px; height: 32px; border-radius: 4px; background: rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; color:#ccc; font-weight:bold; font-size:1.2rem;">&times;</div>
                    <div>
                        <strong>Clear Slot</strong>
                        <div style="color:var(--text-secondary); font-size:0.75rem; margin-top: 0.25rem;">Remove currently equipped item</div>
                    </div>
                </div>
            `;
            clearEl.addEventListener('click', () => {
                const slotsToApply = this.getSlotsToApply();
                const targetSlots = slotsToApply.length > 0 ? slotsToApply : [this.state.currentSlotSelection];

                for (const targetSlot of targetSlots) {
                    delete this.state.currentBuild.equipment[targetSlot];
                    this.updateSlotUI(targetSlot, null, this.state.currentSlotType);
                }
                this.closeStatModal();
                this.recalculateStats();
            });
            container.appendChild(clearEl);
        }
        // --- END CLEAR OPTION ---

        listData.forEach(item => {
            if (lowerFilter && !item.name.toLowerCase().includes(lowerFilter)) return;


            const el = document.createElement('div');
            el.className = 'stat-list-item';

            // For upgrades (Runes, Sigils, Relics, Consumables), display icons if available
            let innerHTML = '';
            if (item.icon && ['Rune', 'Sigil', 'Relic', 'Food', 'UtilityItem'].includes(this.state.currentSlotType)) {
                // NEW: Show TP price for Food/Utility items
                let priceHtml = '';
                if ((this.state.currentSlotType === 'Food' || this.state.currentSlotType === 'UtilityItem') && item.id) {
                    const priceData = this.state.tpPrices[item.id];
                    if (priceData && priceData.buys && priceData.buys.unit_price) {
                        priceHtml = `<div style="font-size: 0.75rem; margin-top: 2px;">${this.formatPrice(priceData.buys.unit_price)}</div>`;
                    }
                }
                innerHTML = `
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <img src="${item.icon}" alt="${item.name}" style="width: 32px; height: 32px; border-radius: 4px;" />
                        <div>
                            <strong>${item.name}</strong>
                            ${item.bonuses && item.bonuses.length > 0 ?
                        `<div style="color:var(--text-secondary); font-size:0.7rem; margin-top: 0.25rem;">${item.bonuses.length} Bonuses</div>` :
                        ''}
                            ${priceHtml}
                        </div>
                    </div>
                `;

            } else {
                let secondaryStr = '';
                const attrMap = { CritDamage: 'Ferocity', BoonDuration: 'Concentration', ConditionDuration: 'Expertise', Healing: 'Healing Power' };
                if (item.attributes) {
                    secondaryStr = item.attributes.map(a => `<span style="color:var(--accent); font-size:0.8rem;">+${attrMap[a.attribute] || a.attribute}</span>`).join(' ');
                } else if (item.bonuses && item.bonuses.length > 0) {
                    secondaryStr = `<span style="color:var(--text-secondary); font-size:0.7rem;">${item.bonuses.length} Bonuses</span>`;
                }
                // Add stat icon for stat combos
                const iconClass = this.getStatIconClass(item.name);
                if (iconClass) {
                    innerHTML = `
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <div class="stat-icon ${iconClass}"></div>
                            <div>
                                <strong>${item.name}</strong><br/>${secondaryStr}
                            </div>
                        </div>
                    `;
                } else {
                    innerHTML = `<strong>${item.name}</strong><br/>${secondaryStr}`;
                }
            }

            el.innerHTML = innerHTML;
            el.addEventListener('click', () => this.selectItemForSlot(item));

            // Phase 8: Add Modal Tooltip Logic
            el.addEventListener('mouseenter', (e) => {
                const tooltip = document.getElementById('global-tooltip');
                document.getElementById('tooltip-title').textContent = item.name || item.type || 'Stat';

                let descHtml = '';

                // Use the same logic as addTooltipEvents for consistency
                let descParts = [];
                // 1. Add Rune/Sigil bonuses if they exist (Food/Utility don't need (1): prefix)
                const isFoodOrUtilityModal = this.state.currentSlotType === 'Food' || this.state.currentSlotType === 'UtilityItem';
                if (item.bonuses && item.bonuses.length > 0) {
                    if (isFoodOrUtilityModal) {
                        descParts.push(item.bonuses.join('<br>'));
                    } else {
                        descParts.push(item.bonuses.map((b, i) => `(${i + 1}): ${b}`).join('<br>'));
                    }
                }
                // 2. Add the nested details.description (where Feasts hide their stats)
                if (item.details && item.details.description) {
                    descParts.push(item.details.description.replace(/\n/g, '<br>'));
                }
                // 3. Add base description (Avoid duplicating text if it matches details.description)
                if (item.description) {
                    if (!item.details || item.details.description !== item.description) {
                        descParts.push(item.description.replace(/\n/g, '<br>'));
                    }
                }
                // 4. Add infix_upgrade.buff.description (for Feasts and other consumables)
                if (item.details && item.details.infix_upgrade && item.details.infix_upgrade.buff) {
                    if (item.details.infix_upgrade.buff.description) {
                        descParts.push(item.details.infix_upgrade.buff.description.replace(/\n/g, '<br>'));
                    }
                }

                if (descParts.length > 0) {
                    descHtml = descParts.join('<br><br>');
                } else if (item.attributes) {
                    // Show stat names with correct attribute_adjustment values for each slot type
                    const attrMap = { CritDamage: 'Ferocity', BoonDuration: 'Concentration', ConditionDuration: 'Expertise', Healing: 'Healing Power' };
                    descHtml = item.attributes.map(a => {
                        const displayName = attrMap[a.attribute] || a.attribute;
                        return `+${displayName}`;
                    }).join('<br>');
                }

                document.getElementById('tooltip-desc').innerHTML = descHtml;

                // Add calculated bonus using live stats (excluding current slot)
                if (['Food', 'UtilityItem'].includes(this.state.currentSlotType)) {
                    const currentSlot = this.state.currentSlotSelection;
                    const liveStats = this.computeStats(currentSlot);

                    // 1. Show the specific converted stat breakdown
                    const conversions = this.getUtilityStatConversions(item, liveStats);
                    if (conversions.length > 0) {
                        document.getElementById('tooltip-desc').innerHTML += `<br><br><span style="color:var(--accent); font-weight:bold;">Calculated Conversions:<br>${conversions.join('<br>')}</span>`;
                    }

                    // 2. Show the summary of total stats added (UtilityItems only)
                    if (this.state.currentSlotType === 'UtilityItem') {
                        const bonusVal = this.calculateUtilityBonus(item, liveStats);
                        if (bonusVal > 0) {
                            document.getElementById('tooltip-desc').innerHTML += `<br><br><span style="color:var(--accent); font-weight:bold;">Calculated Bonus: +${bonusVal} Total Stats</span>`;
                        }
                    }
                }

                tooltip.style.left = e.pageX + 15 + 'px';
                tooltip.style.top = e.pageY + 15 + 'px';
                tooltip.classList.remove('hidden');
            });
            el.addEventListener('mousemove', (e) => {
                const tooltip = document.getElementById('global-tooltip');
                tooltip.style.left = e.pageX + 15 + 'px';
                tooltip.style.top = e.pageY + 15 + 'px';
            });
            el.addEventListener('mouseleave', () => {
                document.getElementById('global-tooltip').classList.add('hidden');
            });

            container.appendChild(el);
        });
    }

    async selectItemForSlot(itemData) {
        if (!this.state.currentSlotSelection) return;

        const slotName = this.state.currentSlotSelection;
        const slotType = this.state.currentSlotType;

        // For upgrades (Rune, Sigil, Relic), fetch full item details from API to get proper icon
        if (slotType !== 'Stat' && itemData.id) {
            try {
                // Check cache first
                if (!this.state.itemCache[itemData.id]) {
                    const fullItem = await api.getItems([itemData.id]);
                    if (fullItem && fullItem.length > 0) {
                        this.state.itemCache[itemData.id] = fullItem[0];
                    }
                }
                // Merge fetched data with our local data (preserving bonuses/description from upgrades.json)
                const cachedItem = this.state.itemCache[itemData.id];
                if (cachedItem) {
                    itemData = { ...itemData, icon: cachedItem.icon, details: cachedItem.details };
                }
            } catch (error) {
                console.error(`Failed to fetch item details for ID ${itemData.id}:`, error);
            }
        }

        // Get slots to apply to (for apply-to feature)
        const slotsToApply = this.getSlotsToApply();

        // If no checkboxes are selected, just apply to the current slot
        const targetSlots = slotsToApply.length > 0 ? slotsToApply : [slotName];

        // Apply stat to all target slots
        for (const targetSlot of targetSlots) {
            this.state.currentBuild.equipment[targetSlot] = itemData;
            await this.updateSlotUI(targetSlot, itemData, slotType);
        }

        this.closeStatModal();
        this.recalculateStats();
    }

    /**
     * Update a single slot's UI with the item data
     * @param {string} slotName - The slot name to update
     * @param {Object} itemData - The item data to display (null to clear)
     * @param {string} slotType - The type of slot (Stat, Rune, Sigil, Relic)
     */
    async updateSlotUI(slotName, itemData, slotType) {
        const slotEl = document.querySelector(`[data-slot="${slotName}"]`);
        if (!slotEl) return;

        // If itemData is null, clear the slot
        if (!itemData) {
            slotEl.innerHTML = '';
            slotEl.classList.remove('has-stat');
            return;
        }

        // Check if this is an upgrade slot (Rune, Sigil, Relic, Food, UtilityItem)
        const isUpgradeSlot = ['Rune', 'Sigil', 'Relic', 'Food', 'UtilityItem'].includes(slotType);

        if (isUpgradeSlot) {
            // For upgrade slots, just show the icon
            if (itemData.icon) {
                slotEl.innerHTML = `<img class="upgrade-icon" src="${itemData.icon}" alt="${itemData.name}" />`;
                slotEl.classList.add('has-stat');
            }
        } else {
            // For stat slots, get slot icon if available
            const isWeaponSlot = slotName.startsWith('Weapon');
            let slotIconHtml = '';
            let slotIconId = null;

            if (isWeaponSlot) {
                // Get weapon type for this slot
                const weaponType = this.state.weaponTypes[slotName];
                if (weaponType) {
                    const weaponIcon = getWeaponIcon(weaponType);
                    if (weaponIcon) {
                        if (weaponIcon.type === 'specific' && weaponIcon.id) {
                            slotIconId = weaponIcon.id;
                        } else if (weaponIcon.type === 'generic' && weaponIcon.url) {
                            // Use generic icon URL directly
                            slotIconHtml = `<img class="slot-icon" src="${weaponIcon.url}" alt="${weaponType}" />`;
                        }
                    }
                }
            } else {
                // For non-weapon slots, use the slot icon mapping
                slotIconId = getSlotIconId(slotName);
            }

            // If we have a specific item ID to fetch (for weapons or other slots)
            if (slotIconId && !slotIconHtml) {
                // Check if we have this item in cache
                if (!this.state.itemCache[slotIconId]) {
                    try {
                        const fullItem = await api.getItems([slotIconId]);
                        if (fullItem && fullItem.length > 0) {
                            this.state.itemCache[slotIconId] = fullItem[0];
                        }
                    } catch (error) {
                        console.error(`Failed to fetch slot icon for ID ${slotIconId}:`, error);
                    }
                }

                const slotIconData = this.state.itemCache[slotIconId];
                if (slotIconData && slotIconData.icon) {
                    slotIconHtml = `<img class="slot-icon" src="${slotIconData.icon}" alt="${slotName}" />`;
                }
            }

            // For stat combos, add stat icon
            const iconClass = this.getStatIconClass(itemData.name);
            if (iconClass) {
                if (slotIconHtml) {
                    slotEl.innerHTML = `
                        <div class="slot-icon-container">
                            ${slotIconHtml}
                            <div class="stat-icon ${iconClass}"></div>
                        </div>
                    `;
                } else {
                    slotEl.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div class="stat-icon ${iconClass}"></div>
                        </div>
                    `;
                }
            } else {
                if (slotIconHtml) {
                    slotEl.innerHTML = `
                        <div class="slot-icon-container">
                            ${slotIconHtml}
                            <span style="color:white; font-weight:600;">${itemData.name}</span>
                        </div>
                    `;
                } else {
                    slotEl.innerHTML = `<span style="color:white; font-weight:600;">${itemData.name}</span>`;
                }
            }
            slotEl.classList.add('has-stat');
        }

        // Add a visual flash effect
        slotEl.style.borderColor = 'var(--accent)';
        setTimeout(() => slotEl.style.borderColor = '', 500);
    }

    /**
     * Get the list of weapon and sigil slots for the active weapon set
     * Handles both 1H+OH and 2H weapon configurations
     * @returns {Object} Object with weaponSlots and sigilSlots arrays
     */
    getActiveWeaponSlots() {
        const set = this.state.activeWeaponSet;
        const mainSlot = `Weapon${set}1`;
        const offSlot = `Weapon${set}2`;
        const weaponType = this.state.weaponTypes[mainSlot];

        const twoHandedWeapons = ['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff'];
        const is2H = twoHandedWeapons.includes(weaponType);

        const weaponSlots = [mainSlot];
        const sigilSlots = [`${mainSlot}Sigil1`];

        if (is2H) {
            // 2H weapon has two sigils
            sigilSlots.push(`${mainSlot}Sigil2`);
        } else {
            // 1H weapon - include offhand and its sigil
            weaponSlots.push(offSlot);
            sigilSlots.push(`${offSlot}Sigil1`);
        }

        return { weaponSlots, sigilSlots };
    }

    /**
     * Toggle between weapon set A and B
     */
    toggleWeaponSet() {
        this.state.activeWeaponSet = this.state.activeWeaponSet === 'A' ? 'B' : 'A';
        this.updateWeaponSetActiveState();
        this.recalculateStats();
    }

    /**
     * Update the visual state of weapon sets based on active set
     */
    updateWeaponSetActiveState() {
        const toggleBtn = document.getElementById('weapon-set-toggle-btn');
        const setAContainers = document.querySelectorAll('.weapon-set-a');
        const setBContainers = document.querySelectorAll('.weapon-set-b');

        if (this.state.activeWeaponSet === 'A') {
            // Set A is active
            if (toggleBtn) {
                toggleBtn.classList.remove('active-set-b');
                toggleBtn.classList.add('active-set-a');
            }
            setAContainers.forEach(container => {
                container.classList.remove('inactive-set');
                container.classList.add('active-set');
            });
            setBContainers.forEach(container => {
                container.classList.remove('active-set');
                container.classList.add('inactive-set');
            });
        } else {
            // Set B is active
            if (toggleBtn) {
                toggleBtn.classList.remove('active-set-a');
                toggleBtn.classList.add('active-set-b');
            }
            setAContainers.forEach(container => {
                container.classList.remove('active-set');
                container.classList.add('inactive-set');
            });
            setBContainers.forEach(container => {
                container.classList.remove('inactive-set');
                container.classList.add('active-set');
            });
        }
    }

    computeStats(excludeSlot = null) {
        // Base Level 80 Stats
        const totals = {
            Power: 1000, Toughness: 1000, Vitality: 1000, Precision: 1000,
            CritDamage: 0, Healing: 0, ConditionDamage: 0,
            BoonDuration: 0, ConditionDuration: 0
        };

        const professionBaseHealth = {
            'Warrior': 19212, 'Guardian': 19212, 'Revenant': 15922,
            'Ranger': 15922, 'Engineer': 15922, 'Necromancer': 17068,
            'Mesmer': 14628, 'Thief': 14628, 'Elementalist': 11645
        };

        const attributeAdjustment = {
            Helm: 179.256, Shoulders: 134.442, Coat: 403.326, Gloves: 134.442, Leggings: 268.884, Boots: 134.442,
            WeaponA1: 358.512, WeaponA2: 358.512, WeaponB1: 358.512, WeaponB2: 358.512,
            Backpack: 89.628, Accessory1: 224.07, Accessory2: 224.07, Amulet: 358.512, Ring1: 268.884, Ring2: 268.884
        };

        const twoHandedWeapons = ['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff'];
        const { weaponSlots, sigilSlots } = this.getActiveWeaponSlots();

        // Process flat equipment stats
        Object.entries(this.state.currentBuild.equipment).forEach(([slot, statData]) => {
            if (excludeSlot && slot === excludeSlot) return; // EXCLUDE SLOT
            if (!statData || !attributeAdjustment[slot]) return;
            if (slot.startsWith('Weapon') && !weaponSlots.includes(slot)) return;

            let adj = attributeAdjustment[slot];
            if (slot.startsWith('Weapon') && twoHandedWeapons.includes(this.state.weaponTypes[slot])) {
                adj = 717.024;
            }

            const isTrinket = ['Backpack', 'Accessory1', 'Accessory2', 'Amulet', 'Ring1', 'Ring2'].includes(slot);
            let actualStatData = statData;
            if (this.state.statsLookup && statData.name) {
                const lookupKey = `${statData.name}_${isTrinket ? 'trinket' : 'armor'}`;
                const variantStat = this.state.statsLookup.get(lookupKey);
                if (variantStat) actualStatData = variantStat;
            }

            if (actualStatData.attributes) {
                actualStatData.attributes.forEach(attr => {
                    const val = Math.round(adj * attr.multiplier) + (attr.value || 0);
                    totals[attr.attribute] = (totals[attr.attribute] || 0) + val;
                });
            }
        });

        // Process rune bonuses
        const runeCounts = {};
        Object.entries(this.state.currentBuild.equipment).forEach(([slot, itemData]) => {
            if (excludeSlot && slot === excludeSlot) return; // EXCLUDE SLOT
            if (!itemData || !slot.includes('Rune')) return;
            const runeKey = itemData.id || itemData.name;
            if (!runeCounts[runeKey]) runeCounts[runeKey] = { count: 0, itemData };
            runeCounts[runeKey].count++;
        });

        Object.values(runeCounts).forEach(({ count, itemData }) => {
            if (itemData.bonuses) {
                for (let i = 0; i < Math.min(count, itemData.bonuses.length); i++) {
                    this.parseBonusString(itemData.bonuses[i], totals);
                }
            }
        });

        // Process sigil bonuses
        Object.entries(this.state.currentBuild.equipment).forEach(([slot, itemData]) => {
            if (excludeSlot && slot === excludeSlot) return; // EXCLUDE SLOT
            if (!itemData || !slot.includes('Sigil') || !sigilSlots.includes(slot)) return;

            if (itemData.bonuses && itemData.bonuses.length > 0) {
                itemData.bonuses.forEach(b => this.parseBonusString(b, totals));
            } else {
                if (itemData.details?.infix_upgrade?.buff?.description) {
                    this.parseDescriptionForStats(itemData.details.infix_upgrade.buff.description, totals);
                } else if (itemData.description) {
                    this.parseDescriptionForStats(itemData.description, totals);
                }
            }
        });

        // Process Consumables (Food/Utility)
        ['Food', 'UtilityItem'].forEach(slot => {
            if (excludeSlot && slot === excludeSlot) return; // EXCLUDE SLOT
            const item = this.state.currentBuild.equipment[slot];
            if (!item) return;

            if (item.bonuses) item.bonuses.forEach(b => this.parseBonusString(b, totals));
            if (item.details?.infix_upgrade?.buff?.description) {
                this.parseDescriptionForStats(item.details.infix_upgrade.buff.description, totals);
            }
        });

        // Process percentage-based stat conversions
        ['Food', 'UtilityItem'].forEach(slot => {
            if (excludeSlot && slot === excludeSlot) return; // EXCLUDE SLOT
            const item = this.state.currentBuild.equipment[slot];
            if (!item) return;

            const textLines = [
                ...(item.description ? item.description.split('\n') : []),
                ...(item.details?.description ? item.details.description.split('\n') : []),
                ...(item.bonuses || [])
            ];
            const textToParse = [...new Set(textLines.map(t => t.trim()).filter(Boolean))].join(' ');

            const convRegex = /(?:Gain|Grants?)\s+(Power|Toughness|Vitality|Precision|Ferocity|Healing\s+Power|Condition\s+Damage|Concentration|Expertise)\s+(?:equal\s+to\s+)?(\d+)%\s+of\s+(?:your\s+)?(Power|Toughness|Vitality|Precision|Ferocity|Healing\s+Power|Condition\s+Damage|Concentration|Expertise)/ig;

            const statMap = {
                'power': 'Power', 'toughness': 'Toughness', 'vitality': 'Vitality',
                'precision': 'Precision', 'ferocity': 'CritDamage',
                'healingpower': 'Healing', 'conditiondamage': 'ConditionDamage',
                'concentration': 'BoonDuration', 'expertise': 'ConditionDuration'
            };

            let match;
            const appliedConversions = new Set();
            while ((match = convRegex.exec(textToParse)) !== null) {
                const targetStat = statMap[match[1].toLowerCase().replace(/\s+/g, '')];
                const percent = parseInt(match[2]) / 100;
                const sourceStat = statMap[match[3].toLowerCase().replace(/\s+/g, '')];

                if (targetStat && sourceStat && totals[sourceStat] !== undefined) {
                    const convKey = `${targetStat}_${percent}_${sourceStat}`;
                    if (!appliedConversions.has(convKey)) {
                        appliedConversions.add(convKey);
                        totals[targetStat] += Math.floor(totals[sourceStat] * percent);
                    }
                }
            }
        });

        // Process flat statutory facts from Skills and Traits
        const activeSkills = [
            this.state.currentBuild.skills.heal,
            ...this.state.currentBuild.skills.utility,
            this.state.currentBuild.skills.elite
        ].filter(Boolean);

        const internalStatMap = {
            'power': 'Power', 'toughness': 'Toughness', 'vitality': 'Vitality',
            'precision': 'Precision', 'ferocity': 'CritDamage',
            'healingpower': 'Healing', 'conditiondamage': 'ConditionDamage',
            'concentration': 'BoonDuration', 'expertise': 'ConditionDuration'
        };

        activeSkills.forEach(skill => {
            if (skill.id && UNCONDITIONAL_SKILL_BONUSES[skill.id]) {
                const bonus = UNCONDITIONAL_SKILL_BONUSES[skill.id];
                totals[bonus.stat] = (totals[bonus.stat] || 0) + bonus.value;
            }

            if (skill.facts) {
                skill.facts.forEach(fact => {
                    if (fact.type === 'AttributeAdjust' && fact.target && (!fact.text || fact.text === fact.target)) {
                        const targetKey = internalStatMap[fact.target.toLowerCase().replace(/\s+/g, '')];
                        if (targetKey) {
                            totals[targetKey] = (totals[targetKey] || 0) + fact.value;
                        }
                    }
                });
            }
        });

        if (this.state.traitCache) {
            const activeTraitIds = [];

            this.state.currentBuild.specializations.forEach(specId => {
                if (specId) {
                    const specData = this.state.availableSpecializations.find(s => s.id === specId);
                    if (specData && specData.minor_traits) {
                        activeTraitIds.push(...specData.minor_traits);
                    }
                }
            });

            Object.values(this.state.currentBuild.traits).forEach(traitTierArray => {
                if (Array.isArray(traitTierArray)) {
                    traitTierArray.forEach(traitId => {
                        if (traitId) activeTraitIds.push(traitId);
                    });
                }
            });

            activeTraitIds.forEach(traitId => {
                const trait = this.state.traitCache[traitId];
                if (trait && trait.facts) {
                    trait.facts.forEach(fact => {
                        if (fact.type === 'AttributeAdjust' && fact.target && (!fact.text || fact.text === fact.target)) {
                            const targetKey = internalStatMap[fact.target.toLowerCase().replace(/\s+/g, '')];
                            if (targetKey) {
                                totals[targetKey] = (totals[targetKey] || 0) + fact.value;
                            }
                        }
                    });
                }
            });
        }

        // Calculate derived stats
        const baseHealth = professionBaseHealth[this.state.currentBuild.profession] || 15922;
        totals.Health = baseHealth + ((totals.Vitality - 1000) * 10);
        totals.CriticalChance = Math.max(0, Math.min(100, (totals.Precision - 895) / 21));
        totals.CriticalDamage = 150 + (totals.CritDamage / 15);
        totals.BoonDurationPercent = (totals.BoonDuration / 15) + (totals.BonusBoonDurationPercent || 0);
        totals.ConditionDurationPercent = (totals.ConditionDuration / 15) + (totals.BonusConditionDurationPercent || 0);

        return totals;
    }

    recalculateStats() {
        const totals = this.computeStats();
        this.renderStats(totals);
        this.state.currentStats = totals;
    }

    /**
     * Parse a bonus string like "+25 Power" or "+10% Boon Duration" and add to totals
     */
    parseBonusString(bonus, totals) {
        // Match patterns like "+25 Power" or "+10% Boon Duration"
        bonus = bonus.replace(/<c=@abilitytype>|<\/c>/gi, '');
        const flatMatch = bonus.match(/^\+(\d+)\s+(.+)$/);
        const percentMatch = bonus.match(/^\+(\d+)%\s+(.+)$/);
        const sigilCondiDurationMatch = bonus.match(/^Increase\s+inflicted\s+(.+?)\s+duration:\s+(\d+)%/i);

        if (flatMatch) {
            const value = parseInt(flatMatch[1]);
            const statName = flatMatch[2].trim();

            // Map stat names to our internal names
            const statMap = {
                'Power': 'Power',
                'Toughness': 'Toughness',
                'Vitality': 'Vitality',
                'Precision': 'Precision',
                'Ferocity': 'CritDamage',
                'Healing': 'Healing',
                'Healing Power': 'Healing',
                'Condition Damage': 'ConditionDamage',
                'Concentration': 'BoonDuration',
                'Expertise': 'ConditionDuration',
                'to All Stats': 'ALL', // Special case for "to All Stats"
                'All Stats': 'ALL',
                'to All Attributes': 'ALL',
                'All Attributes': 'ALL'
            };

            if (statMap[statName] === 'ALL') {
                // Apply to all 9 combat attributes
                totals.Power += value;
                totals.Toughness += value;
                totals.Vitality += value;
                totals.Precision += value;
                totals.CritDamage += value;       // Ferocity
                totals.Healing += value;          // Healing Power
                totals.ConditionDamage += value;  // Condition Damage
                totals.BoonDuration += value;     // Concentration
                totals.ConditionDuration += value;// Expertise
            } else if (statMap[statName]) {
                const mappedStat = statMap[statName];
                if (mappedStat && totals[mappedStat] !== undefined) {
                    totals[mappedStat] += value;
                }
            }
        } else if (percentMatch) {
            const value = parseInt(percentMatch[1]);
            const statName = percentMatch[2].trim();

            if (statName === 'Boon Duration') {
                totals.BonusBoonDurationPercent = (totals.BonusBoonDurationPercent || 0) + value;
            } else if (statName === 'Condition Duration') {
                totals.BonusConditionDurationPercent = (totals.BonusConditionDurationPercent || 0) + value;
            } else if (statName.toLowerCase().includes('duration')) {
                if (!totals.specializedDurations) totals.specializedDurations = {};
                totals.specializedDurations[statName] = (totals.specializedDurations[statName] || 0) + value;
            }
        } else if (sigilCondiDurationMatch) {
            const statName = sigilCondiDurationMatch[1].trim() + ' Duration';
            const value = parseInt(sigilCondiDurationMatch[2]);
            if (!totals.specializedDurations) totals.specializedDurations = {};
            totals.specializedDurations[statName] = (totals.specializedDurations[statName] || 0) + value;
        }
    }

    /**
     * Parse a description string (like from feasts) and add stats to totals
     * Used to parse details.infix_upgrade.buff.description
     */
    parseDescriptionForStats(desc, totals) {
        if (!desc) return;
        const cleanDesc = desc.replace(/<c=@abilitytype>|<\/c>/gi, '');
        const lines = cleanDesc.split('\n');
        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('+') || trimmedLine.toLowerCase().startsWith('increase')) {
                this.parseBonusString(trimmedLine, totals);
            }
        });
    }

    renderStats(totals) {
        const container = document.getElementById('stats-container');
        container.innerHTML = '';

        // Define all stats to display in order
        const statsToDisplay = [
            { key: 'Power', name: 'Power', format: 'flat' },
            { key: 'Toughness', name: 'Toughness', format: 'flat' },
            { key: 'Vitality', name: 'Vitality', format: 'flat' },
            { key: 'Health', name: 'Health', format: 'flat' },
            { key: 'Precision', name: 'Precision', format: 'flat' },
            { key: 'CriticalChance', name: 'Critical Chance', format: 'percent' },
            { key: 'CritDamage', name: 'Ferocity', format: 'flat' },
            { key: 'CriticalDamage', name: 'Critical Damage', format: 'percent' },
            { key: 'ConditionDamage', name: 'Condition Damage', format: 'flat' },
            { key: 'BoonDuration', name: 'Concentration', format: 'flat' },
            { key: 'BoonDurationPercent', name: 'Boon Duration', format: 'percent' },
            { key: 'ConditionDuration', name: 'Expertise', format: 'flat' },
            { key: 'ConditionDurationPercent', name: 'Condition Duration', format: 'percent' },
            { key: 'Healing', name: 'Healing Power', format: 'flat' }
        ];

        statsToDisplay.forEach(stat => {
            const value = totals[stat.key];
            if (value === undefined) return;

            // Phase 9: Pre-calculate specialized durations to determine visibility overrides
            let relevantSpecs = [];
            if ((stat.key === 'ConditionDurationPercent' || stat.key === 'BoonDurationPercent') && totals.specializedDurations) {
                const isCondi = stat.key === 'ConditionDurationPercent';
                const condiKeywords = ['Bleed', 'Burn', 'Confus', 'Poison', 'Torment', 'Vuln', 'Weak', 'Chill', 'Crip', 'Immob', 'Fear', 'Taunt', 'Blind', 'Movement', 'Non-Damaging'];
                const boonKeywords = ['Aegis', 'Alacrity', 'Fury', 'Might', 'Protect', 'Quick', 'Regen', 'Resist', 'Resolut', 'Retal', 'Stab', 'Swift', 'Vigor'];
                const keywords = isCondi ? condiKeywords : boonKeywords;
                for (const [specName, specVal] of Object.entries(totals.specializedDurations)) {
                    if (keywords.some(k => specName.toLowerCase().includes(k.toLowerCase()))) {
                        relevantSpecs.push(`+${specVal}% ${specName}`);
                    }
                }
            }

            // Show stat if it has a value (for derived stats), if it's a base stat, or if it has specialized specs
            let shouldShow = stat.format === 'percent' ? value > 0 : (value > 0 || ['Power', 'Toughness', 'Vitality', 'Precision'].includes(stat.key));
            if (relevantSpecs.length > 0) shouldShow = true;

            if (!shouldShow) return;

            const row = document.createElement('div');
            row.className = 'stat-row';

            let displayVal;
            if (stat.format === 'percent') {
                displayVal = `${value.toFixed(1)}%`;
            } else {
                displayVal = Math.round(value).toLocaleString();
            }

            row.innerHTML = `<span class="stat-name">${stat.name}</span><span class="stat-value">${displayVal}</span>`;

            // Phase 9: Specialized Duration Tooltip Hover
            if (relevantSpecs.length > 0) {
                row.style.cursor = 'help';
                row.style.borderBottom = '1px dotted rgba(255,255,255,0.4)';
                row.style.marginBottom = '2px';

                row.addEventListener('mouseenter', (e) => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (!tooltip) return;
                    document.getElementById('tooltip-title').textContent = `Specialized ${stat.name}`;
                    document.getElementById('tooltip-desc').innerHTML = relevantSpecs.join('<br>');
                    tooltip.style.left = e.pageX + 15 + 'px';
                    tooltip.style.top = e.pageY + 15 + 'px';
                    tooltip.classList.remove('hidden');
                });

                row.addEventListener('mousemove', (e) => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (!tooltip) return;
                    tooltip.style.left = e.pageX + 15 + 'px';
                    tooltip.style.top = e.pageY + 15 + 'px';
                });

                row.addEventListener('mouseleave', () => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (tooltip) tooltip.classList.add('hidden');
                });
            }

            container.appendChild(row);
        });
    }

    openProfessionPicker() {
        // Force hide tooltip when opening a modal
        document.getElementById('global-tooltip').classList.add('hidden');

        this.renderProfessionGrid();
        document.getElementById('profession-modal').classList.remove('hidden');
    }

    closeProfessionModal() {
        document.getElementById('profession-modal').classList.add('hidden');
        document.getElementById('global-tooltip').classList.add('hidden');
    }

    renderProfessionGrid() {
        const container = document.getElementById('profession-grid');
        container.innerHTML = '';

        this.state.professionsCache.forEach(prof => {
            const item = document.createElement('div');
            item.className = 'profession-item';
            if (this.state.currentBuild.profession === prof.id) {
                item.classList.add('selected');
            }

            item.innerHTML = `
                <img class="profession-item-icon" src="${prof.icon}" alt="${prof.name}" />
                <span class="profession-item-name">${prof.name}</span>
            `;

            item.addEventListener('click', () => this.selectProfession(prof));

            // Add tooltip events
            item.addEventListener('mouseenter', (e) => {
                const tooltip = document.getElementById('global-tooltip');
                document.getElementById('tooltip-title').textContent = prof.name;
                document.getElementById('tooltip-desc').innerHTML = prof.description || 'No description available';
                tooltip.style.left = e.pageX + 15 + 'px';
                tooltip.style.top = e.pageY + 15 + 'px';
                tooltip.classList.remove('hidden');
            });

            item.addEventListener('mousemove', (e) => {
                const tooltip = document.getElementById('global-tooltip');
                tooltip.style.left = e.pageX + 15 + 'px';
                tooltip.style.top = e.pageY + 15 + 'px';
            });

            item.addEventListener('mouseleave', () => {
                document.getElementById('global-tooltip').classList.add('hidden');
            });

            container.appendChild(item);
        });
    }

    selectProfession(prof) {
        this.state.currentBuild.profession = prof.id;

        // Update profession display
        const professionDisplay = document.getElementById('profession-display');
        const professionIcon = document.getElementById('profession-icon');
        const professionName = document.getElementById('profession-name');

        professionIcon.src = prof.icon;
        professionIcon.alt = prof.name;
        if (professionName) {
            professionName.textContent = prof.name;
        }
        professionDisplay.classList.add('has-profession');

        // Close modal and handle profession change
        this.closeProfessionModal();
        this.handleProfessionChange(prof.id);
    }

    async handleProfessionChange(professionId, isLoad = false) {
        if (!isLoad) {
            console.log(`Profession changed to: ${professionId}`);
            this.state.currentBuild.profession = professionId;
            // Reset selected specializations
            this.state.currentBuild.specializations = [null, null, null];
            this.state.currentBuild.traits = { 0: [], 1: [], 2: [] }; // traits for each slot
            // Reset profession extras
            this.state.currentBuild.professionExtras = {};
        }

        // Hide swap legend button when changing to non-Revenant profession
        const swapBtn = document.getElementById('legend-swap-btn');
        if (swapBtn) {
            swapBtn.classList.add('hidden');
        }

        try {
            const profData = await api.getProfession(professionId);
            const specIds = profData.specializations;
            const specializations = await api.getSpecializations(specIds);

            this.state.availableSpecializations = specializations;
            this.renderSpecializationSlots();

            // Render profession extras (pets, legends, toolbelt)
            await this.renderProfessionExtras();
        } catch (e) {
            console.error("Failed to load specializations", e);
        }
    }

    renderSpecializationSlots() {
        const container = document.getElementById('specializations-container');
        container.innerHTML = '';

        const coreSpecs = this.state.availableSpecializations.filter(s => !s.elite);
        const eliteSpecs = this.state.availableSpecializations.filter(s => s.elite);

        for (let i = 0; i < 3; i++) {
            const specWrapper = document.createElement('div');
            specWrapper.className = 'spec-slot';

            // Create spec icon display
            const specDisplay = document.createElement('div');
            specDisplay.className = 'spec-icon-display';
            specDisplay.setAttribute('data-slot-index', i);

            const specIconContainer = document.createElement('div');
            specIconContainer.className = 'spec-icon-container';

            const specIcon = document.createElement('img');
            specIcon.className = 'spec-icon';
            specIcon.src = '';
            specIcon.alt = 'Select Specialization';

            const specPlaceholder = document.createElement('div');
            specPlaceholder.className = 'spec-placeholder';
            specPlaceholder.textContent = '?';

            const specInfo = document.createElement('div');
            specInfo.className = 'spec-info';

            const specName = document.createElement('span');
            specName.className = 'spec-name';
            specName.textContent = 'Select Spec';

            const specEliteBadge = document.createElement('span');
            specEliteBadge.className = 'spec-elite-badge';
            specEliteBadge.textContent = '';

            specIconContainer.appendChild(specIcon);
            specIconContainer.appendChild(specPlaceholder);
            specInfo.appendChild(specName);
            specInfo.appendChild(specEliteBadge);
            specDisplay.appendChild(specIconContainer);
            specDisplay.appendChild(specInfo);

            // Add click handler to open spec picker
            specDisplay.addEventListener('click', () => this.openSpecPicker(i));

            // Auto-select if we are loading a build
            if (this.state.currentBuild.specializations[i]) {
                const specId = this.state.currentBuild.specializations[i];
                const specData = this.state.availableSpecializations.find(s => s.id === specId);
                if (specData) {
                    this.updateSpecDisplay(i, specData);
                    this.handleSpecializationChange(i, specId, specWrapper, true);
                }
            }

            const traitsContainer = document.createElement('div');
            traitsContainer.className = 'traits-container';
            traitsContainer.id = `traits-container-${i}`;

            specWrapper.appendChild(specDisplay);
            specWrapper.appendChild(traitsContainer);
            container.appendChild(specWrapper);
        }
    }

    openSpecPicker(slotIndex) {
        // Force hide tooltip when opening a modal
        document.getElementById('global-tooltip').classList.add('hidden');

        this.state.currentSpecSlotIndex = slotIndex;
        this.renderSpecGrid(slotIndex);
        document.getElementById('spec-modal').classList.remove('hidden');
    }

    closeSpecModal() {
        document.getElementById('spec-modal').classList.add('hidden');
        document.getElementById('global-tooltip').classList.add('hidden');
    }

    renderSpecGrid(slotIndex) {
        const container = document.getElementById('spec-grid');
        container.innerHTML = '';

        const coreSpecs = this.state.availableSpecializations.filter(s => !s.elite);
        const eliteSpecs = this.state.availableSpecializations.filter(s => s.elite);

        // Slots 0 and 1 are core only, slot 2 can be core or elite
        const availableForSlot = slotIndex === 2 ? [...coreSpecs, ...eliteSpecs] : coreSpecs;

        availableForSlot.forEach(spec => {
            const item = document.createElement('div');
            item.className = 'spec-item';
            if (spec.elite) {
                item.classList.add('elite');
            }
            if (this.state.currentBuild.specializations[slotIndex] === spec.id) {
                item.classList.add('selected');
            }

            item.innerHTML = `
                <img class="spec-item-icon" src="${spec.icon}" alt="${spec.name}" />
                <span class="spec-item-name">${spec.name}</span>
                ${spec.elite ? '<span class="spec-item-elite">Elite</span>' : ''}
            `;

            item.addEventListener('click', () => this.selectSpec(slotIndex, spec));

            // Add tooltip events
            item.addEventListener('mouseenter', (e) => {
                const tooltip = document.getElementById('global-tooltip');
                document.getElementById('tooltip-title').textContent = spec.name;
                document.getElementById('tooltip-desc').innerHTML = spec.description || 'No description available';
                tooltip.style.left = e.pageX + 15 + 'px';
                tooltip.style.top = e.pageY + 15 + 'px';
                tooltip.classList.remove('hidden');
            });

            item.addEventListener('mousemove', (e) => {
                const tooltip = document.getElementById('global-tooltip');
                tooltip.style.left = e.pageX + 15 + 'px';
                tooltip.style.top = e.pageY + 15 + 'px';
            });

            item.addEventListener('mouseleave', () => {
                document.getElementById('global-tooltip').classList.add('hidden');
            });

            container.appendChild(item);
        });
    }

    selectSpec(slotIndex, spec) {
        this.state.currentBuild.specializations[slotIndex] = spec.id;

        // Update spec display
        this.updateSpecDisplay(slotIndex, spec);

        // Close modal and handle spec change
        this.closeSpecModal();

        // Find the spec wrapper element
        const specWrappers = document.querySelectorAll('.spec-slot');
        const specWrapper = specWrappers[slotIndex];
        if (specWrapper) {
            this.handleSpecializationChange(slotIndex, spec.id, specWrapper);
        }
    }

    updateSpecDisplay(slotIndex, spec) {
        const specDisplays = document.querySelectorAll('.spec-icon-display');
        const specDisplay = specDisplays[slotIndex];
        if (!specDisplay) return;

        const specIcon = specDisplay.querySelector('.spec-icon');
        const specPlaceholder = specDisplay.querySelector('.spec-placeholder');
        const specName = specDisplay.querySelector('.spec-name');
        const specEliteBadge = specDisplay.querySelector('.spec-elite-badge');

        if (spec) {
            specIcon.src = spec.icon;
            specIcon.alt = spec.name;
            specName.textContent = spec.name;
            specEliteBadge.textContent = spec.elite ? 'Elite' : '';
            specDisplay.classList.add('has-spec');
        } else {
            specIcon.src = '';
            specIcon.alt = 'Select Specialization';
            specName.textContent = 'Select Spec';
            specEliteBadge.textContent = '';
            specDisplay.classList.remove('has-spec');
        }
    }

    async handleSpecializationChange(slotIndex, specId, specWrapper, isLoad = false) {
        if (!isLoad) {
            this.state.currentBuild.specializations[slotIndex] = specId;
            this.state.currentBuild.traits[slotIndex] = [null, null, null]; // reset traits for this spec

            // Clear skill cache when specializations change
            this.clearSkillCache();
        }

        const specData = this.state.availableSpecializations.find(s => s.id === specId);
        if (!specData) return;

        // Apply background image to the traits container
        const traitsContainer = document.getElementById(`traits-container-${slotIndex}`);
        if (traitsContainer) {
            if (specData.background) {
                // Try to load the background image
                const img = new Image();
                img.onload = () => {
                    traitsContainer.style.backgroundImage = `url(${specData.background})`;
                };
                img.onerror = () => {
                    // Fallback to CSS gradient if image fails to load
                    this.applyFallbackBackground(traitsContainer, specData);
                };
                img.src = specData.background;
            } else {
                // No background URL, use fallback gradient
                this.applyFallbackBackground(traitsContainer, specData);
            }
        }

        // Fetch all traits for this specialization
        const allTraitIds = [...specData.minor_traits, ...specData.major_traits];
        try {
            const traits = await api.getTraits(allTraitIds);

            if (!this.state.traitCache) this.state.traitCache = {};
            traits.forEach(t => this.state.traitCache[t.id] = t);

            this.renderTraits(slotIndex, traits, specData.minor_traits, specData.major_traits);
        } catch (e) {
            console.error("Failed to load traits", e);
        }

        // Update profession extras when specialization changes (for Scrapper toolbelt)
        // Only render if not loading a build (to avoid duplicate renders)
        if (!isLoad) {
            await this.renderProfessionExtras();
        }
    }

    /**
     * Apply a fallback CSS gradient background based on specialization properties
     * @param {HTMLElement} container - The traits container element
     * @param {Object} specData - The specialization data
     */
    applyFallbackBackground(container, specData) {
        // Create a gradient based on whether it's elite or core spec
        // Elite specs get a more vibrant gradient
        if (specData.elite) {
            // Elite specialization gradient - vibrant red/gold tones
            container.style.backgroundImage = `linear-gradient(135deg, 
                rgba(217, 36, 55, 0.6) 0%, 
                rgba(139, 69, 19, 0.4) 50%, 
                rgba(217, 36, 55, 0.6) 100%)`;
        } else {
            // Core specialization gradient - blue/gray tones
            container.style.backgroundImage = `linear-gradient(135deg, 
                rgba(30, 58, 95, 0.6) 0%, 
                rgba(45, 55, 72, 0.4) 50%, 
                rgba(30, 58, 95, 0.6) 100%)`;
        }
    }

    /**
     * Get IDs of selected elite specializations
     * @returns {number[]} Array of elite specialization IDs
     */
    getSelectedEliteSpecIds() {
        const eliteSpecIds = [];
        this.state.currentBuild.specializations.forEach(specId => {
            if (specId !== null) {
                const spec = this.state.availableSpecializations.find(s => s.id === specId);
                if (spec && spec.elite) {
                    eliteSpecIds.push(specId);
                }
            }
        });
        return eliteSpecIds;
    }

    /**
     * Clear skill cache when specializations change
     */
    clearSkillCache() {
        // Keep only the basic slot keys (heal, utility, elite) for backward compatibility
        const basicKeys = ['heal', 'utility', 'elite'];
        Object.keys(this.state.availableSkills).forEach(key => {
            if (!basicKeys.includes(key)) {
                delete this.state.availableSkills[key];
            }
        });
    }

    renderTraits(slotIndex, traits, minorIds, majorIds) {
        const container = document.getElementById(`traits-container-${slotIndex}`);
        container.innerHTML = ''; // Clear previous traits

        // Group majors by tier
        const majorsByTier = { 1: [], 2: [], 3: [] };
        majorIds.forEach(id => {
            const trait = traits.find(t => t.id === id);
            if (trait && trait.tier) majorsByTier[trait.tier].push(trait);
        });

        const traitsGrid = document.createElement('div');
        traitsGrid.className = 'traits-grid';

        // Render each tier (1, 2, 3)
        [1, 2, 3].forEach(tier => {
            const tierCol = document.createElement('div');
            tierCol.className = `trait-tier tier-${tier}`;

            // Major traits as selectable radio buttons or styled divs
            majorsByTier[tier].sort((a, b) => a.order - b.order).forEach(trait => {
                const traitBlock = document.createElement('div');
                traitBlock.className = 'trait-option';

                traitBlock.innerHTML = `
                    <div class="trait-img-wrapper">
                        <img src="${trait.icon}" alt="${trait.name}" />
                    </div>
                `;

                // If loading, mark as selected
                if (this.state.currentBuild.traits[slotIndex] && this.state.currentBuild.traits[slotIndex][tier - 1] === trait.id) {
                    traitBlock.classList.add('selected');
                }

                traitBlock.addEventListener('click', () => {
                    // Deselect others in this tier
                    tierCol.querySelectorAll('.trait-option').forEach(el => el.classList.remove('selected'));
                    traitBlock.classList.add('selected');
                    this.state.currentBuild.traits[slotIndex][tier - 1] = trait.id;

                    // Stat recalculation and local save trigger
                    this.recalculateStats();
                    this.saveBuild();
                });

                // Add global tooltip listeners
                traitBlock.addEventListener('mouseenter', (e) => {
                    // Prevent tooltip if any modal is open
                    if (!document.getElementById('stat-modal').classList.contains('hidden') ||
                        !document.getElementById('spec-modal').classList.contains('hidden')) return;

                    const tooltip = document.getElementById('global-tooltip');
                    if (!tooltip) return;

                    document.getElementById('tooltip-title').textContent = trait.name || 'Trait';

                    let descHtml = trait.description ? trait.description.replace(/\n|<br>/g, '<br>') : '';

                    if (trait.facts && trait.facts.length > 0) {
                        const factsHtml = trait.facts.map(f => {
                            let valStr = '';
                            if (f.type === 'AttributeAdjust') valStr = `+${f.value}`;
                            else if (f.type === 'Percent') valStr = `${f.percent || f.value}%`;
                            else if (f.type === 'Time') valStr = `${f.duration}s`;
                            else if (f.type === 'Damage') valStr = `${f.hit_count}x`;
                            else if (f.type === 'Number') valStr = `${f.value}`;
                            else if (f.type === 'Distance' || f.type === 'Radius') valStr = `${f.distance}`;
                            else if (f.type === 'ComboField') valStr = `${f.field_type}`;
                            else if (f.type === 'Recharge') valStr = `${f.percent || f.value}%`;
                            else if (f.type === 'Unblockable') valStr = 'Unblockable';
                            else if (f.type === 'Buff') {
                                valStr = `${f.status}${f.duration ? ` (${f.duration}s)` : ''}`;
                                if (f.apply_count) valStr = `${f.apply_count}x ` + valStr;
                            }

                            let finalStr = '';
                            const textLabel = f.text || (f.type === 'AttributeAdjust' ? f.target : '');

                            if (textLabel && valStr) finalStr = `${textLabel}: ${valStr}`;
                            else if (textLabel) finalStr = textLabel;
                            else if (valStr) finalStr = valStr;

                            // Colorize based on whether it appears to be a negative phrasing or positive
                            return finalStr;
                        }).filter(Boolean).join('<br>');

                        if (factsHtml) {
                            descHtml += `<br><br><span style="color:var(--accent);">${factsHtml}</span>`;
                        }
                    }

                    document.getElementById('tooltip-desc').innerHTML = descHtml;
                    tooltip.style.left = e.pageX + 15 + 'px';
                    tooltip.style.top = e.pageY + 15 + 'px';
                    tooltip.classList.remove('hidden');
                });

                traitBlock.addEventListener('mousemove', (e) => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (!tooltip) return;
                    tooltip.style.left = e.pageX + 15 + 'px';
                    tooltip.style.top = e.pageY + 15 + 'px';
                });

                traitBlock.addEventListener('mouseleave', () => {
                    const tooltip = document.getElementById('global-tooltip');
                    if (tooltip) tooltip.classList.add('hidden');
                });

                tierCol.appendChild(traitBlock);
            });
            traitsGrid.appendChild(tierCol);
        });

        container.appendChild(traitsGrid);
    }

    saveBuild() {
        // Trim whitespace to prevent duplicates from trailing spaces
        const titleInput = document.getElementById('build-name').value.trim();
        const notesInput = document.getElementById('build-notes').value;

        this.state.currentBuild.name = titleInput;
        this.state.currentBuild.notes = notesInput;

        this.state.currentBuild.weaponTypes = this.state.weaponTypes;
        this.state.currentBuild.activeWeaponSet = this.state.activeWeaponSet;

        // Ensure skills are included in saved build
        if (!this.state.currentBuild.skills) {
            this.state.currentBuild.skills = {
                heal: null,
                utility: [null, null, null],
                elite: null
            };
        }

        if (!this.state.currentBuild.id) {
            this.state.currentBuild.id = Date.now().toString();
        }

        const builds = JSON.parse(localStorage.getItem('gw2Builds') || '[]');
        
        let existingIdx = builds.findIndex(b => b.id === this.state.currentBuild.id);
        
        // If not found by ID, try to find by exact name to avoid duplicates and overwrite properly
        if (existingIdx === -1) {
            existingIdx = builds.findIndex(b => b.name.toLowerCase() === titleInput.toLowerCase());
            if (existingIdx > -1) {
                // We're overwriting a build with the exact same name. Take its ID.
                this.state.currentBuild.id = builds[existingIdx].id;
            }
        }

        if (existingIdx > -1) {
            builds[existingIdx] = this.state.currentBuild;
        } else {
            builds.push(this.state.currentBuild);
        }
        localStorage.setItem('gw2Builds', JSON.stringify(builds));

        console.log("Saving Build...", this.state.currentBuild);
        this.renderSavedBuilds();
    }

    renderSavedBuilds() {
        const container = document.getElementById('build-list');
        container.innerHTML = '';
        const builds = JSON.parse(localStorage.getItem('gw2Builds') || '[]');

        builds.forEach(build => {
            const el = document.createElement('div');
            el.className = 'saved-build-item';
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'build-info';
            infoDiv.innerHTML = `<strong>${build.name}</strong><div style="font-size:0.8rem;color:var(--text-secondary)">${build.profession || 'No Profession'}</div>`;
            infoDiv.addEventListener('click', () => this.loadBuild(build));
            el.appendChild(infoDiv);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-build-btn';
            deleteBtn.innerHTML = '&times;';
            deleteBtn.title = 'Delete Build';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete "${build.name}"?`)) {
                    this.deleteBuild(build.id);
                }
            });
            el.appendChild(deleteBtn);

            container.appendChild(el);
        });
    }

    deleteBuild(id) {
        let builds = JSON.parse(localStorage.getItem('gw2Builds') || '[]');
        builds = builds.filter(b => b.id !== id);
        localStorage.setItem('gw2Builds', JSON.stringify(builds));
        
        // Check if the current build was deleted. If so, maybe clear the ID so next save is a new build?
        if (this.state.currentBuild.id === id) {
             delete this.state.currentBuild.id;
        }

        this.renderSavedBuilds();
    }

    async loadBuild(build) {
        console.log("Loading build...", build);
        this.state.currentBuild = JSON.parse(JSON.stringify(build));

        document.getElementById('build-name').value = build.name || 'New Build';
        document.getElementById('build-notes').value = build.notes || '';

        // Reset slots UI
        document.querySelectorAll('.slot').forEach(slot => {
            slot.innerHTML = '';
            slot.classList.remove('has-stat');
        });

        // Hide swap legend button by default (will be shown if Revenant with both legends)
        const swapBtn = document.getElementById('legend-swap-btn');
        if (swapBtn) {
            swapBtn.classList.add('hidden');
        }

        // Restore profession display
        if (build.profession) {
            const profData = this.state.professionsCache.find(p => p.id === build.profession);
            if (profData) {
                const professionDisplay = document.getElementById('profession-display');
                const professionIcon = document.getElementById('profession-icon');
                const professionName = document.getElementById('profession-name');

                professionIcon.src = profData.icon;
                professionIcon.alt = profData.name;
                if (professionName) {
                    professionName.textContent = profData.name;
                }
                professionDisplay.classList.add('has-profession');
            }
            await this.handleProfessionChange(build.profession, true);

            // Restore spec displays after specializations are loaded
            if (build.specializations) {
                const specWrappers = document.querySelectorAll('.spec-slot');
                for (let i = 0; i < 3; i++) {
                    if (build.specializations[i]) {
                        const specData = this.state.availableSpecializations.find(s => s.id === build.specializations[i]);
                        if (specData) {
                            this.updateSpecDisplay(i, specData);
                            // Apply background and load traits
                            if (specWrappers[i]) {
                                await this.handleSpecializationChange(i, build.specializations[i], specWrappers[i], true);
                            }
                        }
                    }
                }
            }
        } else {
            // Reset profession display
            const professionDisplay = document.getElementById('profession-display');
            const professionIcon = document.getElementById('profession-icon');
            const professionName = document.getElementById('profession-name');

            professionIcon.src = '';
            professionIcon.alt = 'Select Profession';
            if (professionName) {
                professionName.textContent = 'Select Profession';
            }
            professionDisplay.classList.remove('has-profession');

            document.getElementById('specializations-container').innerHTML = '';
        }

        // Restore equipment slots UI - fetch correct icons from API for upgrades
        for (const [slot, itemData] of Object.entries(build.equipment)) {
            // NEW: Patch missing feast stats on load for older saved builds
            if (['Food', 'UtilityItem'].includes(slot) && this.state.feastStats[itemData.name]) {
                itemData.bonuses = [
                    ...this.state.feastStats[itemData.name],
                    ...this.state.ascendedFeastGlobals
                ];
            }

            const slotEl = document.querySelector(`[data-slot="${slot}"]`);
            if (slotEl && itemData) {
                // Check if this is an upgrade slot (Rune, Sigil, Relic, Food, UtilityItem)
                const isUpgradeSlot = slot.includes('Rune') || slot.includes('Sigil') || ['Relic', 'Food', 'UtilityItem'].includes(slot);

                if (isUpgradeSlot) {
                    // For upgrade slots, fetch icon and display it
                    let displayIcon = itemData.icon;
                    if (itemData.id && itemData.bonuses) {
                        try {
                            if (!this.state.itemCache[itemData.id]) {
                                const fullItem = await api.getItems([itemData.id]);
                                if (fullItem && fullItem.length > 0) {
                                    this.state.itemCache[itemData.id] = fullItem[0];
                                }
                            }
                            const cachedItem = this.state.itemCache[itemData.id];
                            if (cachedItem && cachedItem.icon) {
                                displayIcon = cachedItem.icon;
                                itemData.icon = cachedItem.icon;
                                itemData.details = cachedItem.details;
                            }
                        } catch (error) {
                            console.error(`Failed to fetch item details for ID ${itemData.id}:`, error);
                        }
                    }

                    if (displayIcon) {
                        slotEl.innerHTML = `<img class="upgrade-icon" src="${displayIcon}" alt="${itemData.name}" />`;
                        slotEl.classList.add('has-stat');
                    }
                } else {
                    // For stat slots, get slot icon if available
                    const isWeaponSlot = slot.startsWith('Weapon');
                    let slotIconHtml = '';
                    let slotIconId = null;

                    if (isWeaponSlot) {
                        // Get weapon type for this slot from saved weapon types
                        const weaponType = this.state.weaponTypes[slot];
                        if (weaponType) {
                            const weaponIcon = getWeaponIcon(weaponType);
                            if (weaponIcon) {
                                if (weaponIcon.type === 'specific' && weaponIcon.id) {
                                    slotIconId = weaponIcon.id;
                                } else if (weaponIcon.type === 'generic' && weaponIcon.url) {
                                    // Use generic icon URL directly
                                    slotIconHtml = `<img class="slot-icon" src="${weaponIcon.url}" alt="${weaponType}" />`;
                                }
                            }
                        }
                    } else {
                        // For non-weapon slots, use the slot icon mapping
                        slotIconId = getSlotIconId(slot);
                    }

                    // If we have a specific item ID to fetch (for weapons or other slots)
                    if (slotIconId && !slotIconHtml) {
                        // Check if we have this item in cache
                        if (!this.state.itemCache[slotIconId]) {
                            try {
                                const fullItem = await api.getItems([slotIconId]);
                                if (fullItem && fullItem.length > 0) {
                                    this.state.itemCache[slotIconId] = fullItem[0];
                                }
                            } catch (error) {
                                console.error(`Failed to fetch slot icon for ID ${slotIconId}:`, error);
                            }
                        }

                        const slotIconData = this.state.itemCache[slotIconId];
                        if (slotIconData && slotIconData.icon) {
                            slotIconHtml = `<img class="slot-icon" src="${slotIconData.icon}" alt="${slot}" />`;
                        }
                    }

                    // For stat combos, add stat icon
                    const iconClass = this.getStatIconClass(itemData.name);
                    if (iconClass) {
                        if (slotIconHtml) {
                            slotEl.innerHTML = `
                                <div class="slot-icon-container">
                                    ${slotIconHtml}
                                    <div class="stat-icon ${iconClass}"></div>
                                </div>
                            `;
                        } else {
                            slotEl.innerHTML = `
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <div class="stat-icon ${iconClass}"></div>
                                </div>
                            `;
                        }
                    } else {
                        if (slotIconHtml) {
                            slotEl.innerHTML = `
                                <div class="slot-icon-container">
                                    ${slotIconHtml}
                                    <span style="color:white; font-weight:600;">${itemData.name}</span>
                                </div>
                            `;
                        } else {
                            slotEl.innerHTML = `<span style="color:white; font-weight:600;">${itemData.name}</span>`;
                        }
                    }
                    slotEl.classList.add('has-stat');
                }
            }
        }

        // Restore weapon types
        this.state.weaponTypes = build.weaponTypes || { WeaponA1: '', WeaponA2: '', WeaponB1: '', WeaponB2: '' };
        ['WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2'].forEach(slot => {
            const selectEl = document.getElementById(`w${slot.substring(6)}-type`);
            if (selectEl) {
                selectEl.value = this.state.weaponTypes[slot] || '';
                this.handleWeaponTypeChange(slot, selectEl.value);
            }
        });

        // Restore active weapon set
        this.state.activeWeaponSet = build.activeWeaponSet || 'A';
        this.updateWeaponSetActiveState();

        // Restore skills if they exist in the saved build
        if (build.skills) {
            this.state.currentBuild.skills = build.skills;
            this.restoreSkillSlotsUI();
        } else {
            // Initialize empty skills object
            this.state.currentBuild.skills = {
                heal: null,
                utility: [null, null, null],
                elite: null
            };
            this.clearSkillSlotsUI();
        }

        // Restore active legend state for Revenant
        if (build.profession === 'Revenant' && build.professionExtras?.activeLegendSlot) {
            this.state.activeLegendSlot = build.professionExtras.activeLegendSlot;
            this.updateSwapButtonState();
            this.updateSwapButtonVisibility();
            this.updateLegendSlotActiveState();

            // Restore skills from the active legend
            const activeSlot = build.professionExtras.activeLegendSlot;
            const legendData = build.professionExtras[`legend${activeSlot}Data`];
            if (legendData) {
                await this.populateSkillsFromLegendData(legendData, activeSlot);
            }
        }

        this.recalculateStats();
    }

    restoreSkillSlotsUI() {
        // Update heal slot
        if (this.state.currentBuild.skills.heal) {
            this.updateSkillSlotUI('heal', this.state.currentBuild.skills.heal);
        } else {
            const healSlot = document.querySelector('[data-slot="heal"]');
            if (healSlot) {
                healSlot.classList.remove('has-skill');
                healSlot.classList.add('empty');
                const icon = healSlot.querySelector('.skill-icon');
                if (icon) icon.src = '';
            }
        }

        // Update utility slots
        this.state.currentBuild.skills.utility.forEach((skill, index) => {
            const slotName = `utility${index + 1}`;
            if (skill) {
                this.updateSkillSlotUI(slotName, skill);
            } else {
                const slot = document.querySelector(`[data-slot="${slotName}"]`);
                if (slot) {
                    slot.classList.remove('has-skill');
                    slot.classList.add('empty');
                    const icon = slot.querySelector('.skill-icon');
                    if (icon) icon.src = '';
                }
            }
        });

        // Update elite slot
        if (this.state.currentBuild.skills.elite) {
            this.updateSkillSlotUI('elite', this.state.currentBuild.skills.elite);
        } else {
            const eliteSlot = document.querySelector('[data-slot="elite"]');
            if (eliteSlot) {
                eliteSlot.classList.remove('has-skill');
                eliteSlot.classList.add('empty');
                const icon = eliteSlot.querySelector('.skill-icon');
                if (icon) icon.src = '';
            }
        }
    }

    clearSkillSlotsUI() {
        const skillSlots = document.querySelectorAll('.skill-slot');
        skillSlots.forEach(slot => {
            slot.classList.remove('has-skill');
            slot.classList.add('empty');
            const icon = slot.querySelector('.skill-icon');
            if (icon) icon.src = '';
        });
    }

    async exportBuild() {
        const build = this.state.currentBuild;
        if (!build.profession) {
            alert('Please select a profession first.');
            return;
        }
        try {
            const appState = {
                availableSpecializations: this.state.availableSpecializations,
                weaponTypes: this.state.weaponTypes
            };
            const chatCode = await encodeBuild(build, appState);
            await navigator.clipboard.writeText(chatCode);
            alert('Build code copied to clipboard!');
        } catch (error) {
            console.error('Failed to export build:', error);
            alert('Failed to export build. Check console for details.');
        }
    }

    async importBuild() {
        const code = prompt('Paste GW2 Build Chat Link (e.g., [&...]):');
        if (!code || !code.trim()) return;

        try {
            // Provide mild user feedback if processing takes a second
            document.body.style.cursor = 'wait';

            const importedBuild = await decodeBuild(code.trim());

            // Pass the constructed build object directly to your existing UI loading handler
            await this.loadBuild(importedBuild);

            // Optional visually update the active weapon select elements
            ['WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2'].forEach(slot => {
                const selectEl = document.getElementById(`w${slot.substring(6)}-type`);
                if (selectEl) {
                    selectEl.value = this.state.weaponTypes[slot] || '';
                    this.handleWeaponTypeChange(slot, selectEl.value);
                }
            });

            document.body.style.cursor = 'default';
        } catch (error) {
            document.body.style.cursor = 'default';
            console.error('Failed to import build:', error);
            alert('Failed to import build: ' + error.message);
        }
    }

    newBuild() {

        this.state.currentBuild = {
            name: 'New Build',
            profession: null,
            specializations: [null, null, null],
            traits: { 0: [], 1: [], 2: [] },
            equipment: {},
            weaponTypes: { WeaponA1: '', WeaponA2: '', WeaponB1: '', WeaponB2: '' },
            professionExtras: {},
            notes: ''
        };

        // Hide swap legend button when creating a new build
        const swapBtn = document.getElementById('legend-swap-btn');
        if (swapBtn) {
            swapBtn.classList.add('hidden');
        }

        this.loadBuild(this.state.currentBuild);
    }

    // ==================== IMPORT FROM GAME ====================

    /**
     * Open the import from game modal
     */
    openImportGameModal() {
        this.refreshApiKeyDropdown();
        document.getElementById('import-game-modal').classList.remove('hidden');
    }

    /**
     * Save a new API key to localStorage
     */
    saveApiKey() {
        const input = document.getElementById('new-api-key');
        const key = input.value.trim();
        if (!key) return;

        // Optional: You could fetch /v2/tokeninfo here to validate and get the account name

        if (!this.state.apiKeys.includes(key)) {
            this.state.apiKeys.push(key);
            localStorage.setItem('gw2ApiKeys', JSON.stringify(this.state.apiKeys));
        }
        input.value = '';
        this.refreshApiKeyDropdown();
    }

    /**
     * Refresh the API key dropdown with stored keys
     */
    refreshApiKeyDropdown() {
        const selector = document.getElementById('api-key-selector');
        selector.innerHTML = '<option value="">Select an Account...</option>';

        if (this.state.apiKeys.length > 0) {
            selector.classList.remove('hidden');
            this.state.apiKeys.forEach((key, index) => {
                const truncated = key.substring(0, 8) + '...' + key.substring(key.length - 8);
                selector.appendChild(new Option(`API Key ${index + 1} (${truncated})`, key));
            });
        } else {
            selector.classList.add('hidden');
        }
    }

    /**
     * Load characters for the selected API key
     * @param {string} apiKey - The GW2 API key
     */
    async loadCharactersForAccount(apiKey) {
        if (!apiKey) return;
        try {
            document.body.style.cursor = 'wait';
            const characters = await api.getCharacters(apiKey);
            const selector = document.getElementById('character-selector');
            selector.innerHTML = '<option value="">Select a Character...</option>';

            characters.forEach(char => {
                const displayName = char.profession ? `${char.name} (${char.profession})` : char.name;
                selector.appendChild(new Option(displayName, char.name));
            });

            selector.classList.remove('hidden');
            document.body.style.cursor = 'default';
        } catch (e) {
            document.body.style.cursor = 'default';
            alert('Failed to load characters. Check your API key permissions.');
        }
    }

    /**
     * Load character tabs (build and equipment) for the selected character
     * @param {string} charName - The character name
     */
    async loadCharacterTabs(charName) {
        if (!charName) return;
        const apiKey = document.getElementById('api-key-selector').value;

        try {
            document.body.style.cursor = 'wait';
            // This fetches the giant character payload including build_tabs and equipment_tabs
            const charData = await api.getCharacterDetails(charName, apiKey);
            this.state.selectedCharacterData = charData;

            const buildSelector = document.getElementById('build-tab-selector');
            const equipSelector = document.getElementById('equip-tab-selector');
            buildSelector.innerHTML = '';
            equipSelector.innerHTML = '';

            // Populate Build Tabs
            if (charData.build_tabs) {
                charData.build_tabs.forEach(tab => {
                    const name = tab.build && tab.build.name ? ` - ${tab.build.name}` : '';
                    const active = tab.is_active ? ' (Active)' : '';
                    buildSelector.appendChild(new Option(`Build Tab ${tab.tab}${name}${active}`, tab.tab));
                    if (tab.is_active) buildSelector.value = tab.tab;
                });
            }

            // Populate Equipment Tabs
            if (charData.equipment_tabs) {
                charData.equipment_tabs.forEach(tab => {
                    const name = tab.name ? ` - ${tab.name}` : '';
                    const active = tab.is_active ? ' (Active)' : '';
                    equipSelector.appendChild(new Option(`Equip Tab ${tab.tab}${name}${active}`, tab.tab));
                    if (tab.is_active) equipSelector.value = tab.tab;
                });
            }

            document.getElementById('tab-selectors').classList.remove('hidden');
            document.getElementById('execute-import-btn').classList.remove('hidden');
            document.body.style.cursor = 'default';
        } catch (e) {
            document.body.style.cursor = 'default';
            alert('Failed to load character details.');
        }
    }

    /**
     * Execute the game import - translate GW2 API data to app build format
     */
    async executeGameImport() {
        const charData = this.state.selectedCharacterData;
        if (!charData) return;

        const buildTabId = parseInt(document.getElementById('build-tab-selector').value);
        const equipTabId = parseInt(document.getElementById('equip-tab-selector').value);

        const buildTabObj = charData.build_tabs.find(t => t.tab === buildTabId);
        const equipTab = charData.equipment_tabs.find(t => t.tab === equipTabId);

        if (!buildTabObj || !equipTab) {
            alert('Invalid tab selection.');
            return;
        }

        const buildTab = buildTabObj.build;

        document.body.style.cursor = 'wait';
        try {
            // Construct the base build template
            const newBuild = {
                name: `${charData.name} Build`,
                profession: charData.profession,
                specializations: [null, null, null],
                traits: { 0: [], 1: [], 2: [] },
                equipment: {},
                skills: { heal: null, utility: [null, null, null], elite: null },
                weaponTypes: { WeaponA1: '', WeaponA2: '', WeaponB1: '', WeaponB2: '' },
                activeWeaponSet: 'A',
                professionExtras: {},
                notes: `Imported from character: ${charData.name}`
            };

            // 1. Process Specializations and Traits
            if (buildTab.specializations) {
                buildTab.specializations.forEach((spec, i) => {
                    if (spec && spec.id) {
                        newBuild.specializations[i] = spec.id;
                        newBuild.traits[i] = spec.traits ? spec.traits.map(t => t || null) : [null, null, null];
                    }
                });
            }

            // 2. Process Skills
            if (buildTab.skills) {
                const skillIdsToFetch = [
                    buildTab.skills.heal,
                    ...(buildTab.skills.utilities || []),
                    buildTab.skills.elite
                ].filter(id => id && id > 0);

                if (skillIdsToFetch.length > 0) {
                    const skills = await api.getSkills(skillIdsToFetch);
                    const sMap = Object.fromEntries(skills.map(s => [s.id, s]));

                    newBuild.skills.heal = sMap[buildTab.skills.heal] || null;
                    if (buildTab.skills.utilities) {
                        newBuild.skills.utility[0] = sMap[buildTab.skills.utilities[0]] || null;
                        newBuild.skills.utility[1] = sMap[buildTab.skills.utilities[1]] || null;
                        newBuild.skills.utility[2] = sMap[buildTab.skills.utilities[2]] || null;
                    }
                    newBuild.skills.elite = sMap[buildTab.skills.elite] || null;
                }
            }

            // 3. Process Equipment
            const itemIdsToFetch = [];
            equipTab.equipment.forEach(eq => {
                if (eq.slot && eq.slot.includes('Aquatic')) return; // Ignore underwater gear
                itemIdsToFetch.push(eq.id);
                if (eq.upgrades) itemIdsToFetch.push(...eq.upgrades);
            });

            // Dedup and fetch base items (weapons/armor/trinkets/relics/upgrades)
            const uniqueItemIds = [...new Set(itemIdsToFetch)];
            let itemsMap = {};
            if (uniqueItemIds.length > 0) {
                const items = await api.getItems(uniqueItemIds);
                itemsMap = Object.fromEntries(items.map(i => [i.id, i]));
            }

            // Figure out exactly which raw numeric Stat IDs are in use by the character
            const statIdsToFetch = new Set();
            equipTab.equipment.forEach(eq => {
                if (eq.slot && eq.slot.includes('Aquatic')) return;

                // Selectable stats store the ID in eq.stats.id
                if (eq.stats && eq.stats.id) {
                    statIdsToFetch.add(eq.stats.id);
                }
                // Fixed stats (like some Exotics) bake the stat ID into the item details
                else if (itemsMap[eq.id] && itemsMap[eq.id].details && itemsMap[eq.id].details.infix_upgrade) {
                    statIdsToFetch.add(itemsMap[eq.id].details.infix_upgrade.id);
                }
            });

            // Fetch the definitions for these Stat IDs from the GW2 API
            let statsMap = {};
            if (statIdsToFetch.size > 0) {
                const fetchedStats = await api.getItemStats(Array.from(statIdsToFetch));
                statsMap = Object.fromEntries(fetchedStats.map(s => [s.id, s]));
            }

            // Map API equipment to your state's equipment slots
            equipTab.equipment.forEach(eq => {
                let slot = eq.slot;
                if (!slot || slot.includes('Aquatic')) return; // Ignore underwater slots

                // --- Handle Relics ---
                if (slot === 'Relic') {
                    const relicItem = itemsMap[eq.id];
                    let relicObj = null;

                    if (relicItem) {
                        // 1. If Legendary, prioritize matching by Name for the Exotic variant to get proper graphics
                        if (relicItem.name && relicItem.name.startsWith('Legendary Relic')) {
                            let searchName = relicItem.name.replace(/^Legendary Relic/, 'Relic');
                            relicObj = this.state.availableUpgrades.relics.find(r => r.name === searchName);
                        }

                        // 2. Try exact ID match
                        if (!relicObj) {
                            relicObj = this.state.availableUpgrades.relics.find(r => r.id === eq.id);
                        }

                        // 3. Try fallback matching by exact Name
                        if (!relicObj) {
                            relicObj = this.state.availableUpgrades.relics.find(r => r.name === relicItem.name);
                        }
                    }

                    if (!relicObj) relicObj = relicItem;
                    if (relicObj) newBuild.equipment['Relic'] = relicObj;
                    return;
                }

                // --- Handle Stats via Numeric ID Lookup ---
                let statObj = null;
                let statId = null;

                // Grab the numeric ID on the gear
                if (eq.stats && eq.stats.id) {
                    statId = eq.stats.id;
                } else if (itemsMap[eq.id] && itemsMap[eq.id].details && itemsMap[eq.id].details.infix_upgrade) {
                    statId = itemsMap[eq.id].details.infix_upgrade.id;
                }

                // Look up what the API calls that Stat ID (e.g. ID 584 = "Berserker's")
                // Then link it to the deduplicated "Berserker" in your app's dropdown list
                if (statId && statsMap[statId]) {
                    const cleanStatName = statsMap[statId].name.replace(/'s\b/g, '').trim();
                    statObj = this.state.availableStats.find(s => s.name.replace(/'s\b/g, '').trim() === cleanStatName);
                }

                if (statObj) {
                    newBuild.equipment[slot] = statObj;
                }

                // --- Handle Weapons specifically to populate weaponTypes ---
                if (slot.startsWith('Weapon') && itemsMap[eq.id]) {
                    const type = itemsMap[eq.id].details?.type;
                    if (type && newBuild.weaponTypes.hasOwnProperty(slot)) {
                        newBuild.weaponTypes[slot] = type;
                    }
                }

                // --- Map Upgrades (Runes/Sigils) ---
                if (eq.upgrades && eq.upgrades.length > 0) {
                    if (slot.startsWith('Weapon')) {
                        eq.upgrades.forEach((upgradeId, idx) => {
                            const targetSlot = `${slot}Sigil${idx + 1}`;
                            const upgItem = itemsMap[upgradeId];
                            let localUpgrade = null;

                            if (upgItem) {
                                // 1. If Legendary, prioritize matching by Name for the Exotic variant to get proper graphics
                                if (upgItem.name && upgItem.name.startsWith('Legendary Sigil')) {
                                    let searchName = upgItem.name.replace(/^Legendary Sigil/, 'Superior Sigil');
                                    localUpgrade = this.state.availableUpgrades.upgrades.find(u => u.name === searchName);
                                }

                                // 2. Try exact ID match
                                if (!localUpgrade) {
                                    localUpgrade = this.state.availableUpgrades.upgrades.find(u => u.id === upgradeId);
                                }

                                // 3. Try matching by exact Name for fallback variants
                                if (!localUpgrade) {
                                    localUpgrade = this.state.availableUpgrades.upgrades.find(u => u.name === upgItem.name);
                                }
                            }

                            if (!localUpgrade) localUpgrade = upgItem;
                            if (localUpgrade) newBuild.equipment[targetSlot] = localUpgrade;
                        });
                    } else if (['Helm', 'Shoulders', 'Coat', 'Gloves', 'Leggings', 'Boots'].includes(slot)) {
                        const runeId = eq.upgrades[0];
                        const upgItem = itemsMap[runeId];
                        let localUpgrade = null;

                        if (upgItem) {
                            // 1. If Legendary, prioritize matching by Name for the Exotic variant to get proper graphics
                            if (upgItem.name && upgItem.name.startsWith('Legendary Rune')) {
                                let searchName = upgItem.name.replace(/^Legendary Rune/, 'Superior Rune');
                                localUpgrade = this.state.availableUpgrades.upgrades.find(u => u.name === searchName);
                            }

                            // 2. Try exact ID match
                            if (!localUpgrade) {
                                localUpgrade = this.state.availableUpgrades.upgrades.find(u => u.id === runeId);
                            }

                            // 3. Try matching by exact Name for fallback variants
                            if (!localUpgrade) {
                                localUpgrade = this.state.availableUpgrades.upgrades.find(u => u.name === upgItem.name);
                            }
                        }

                        if (!localUpgrade) localUpgrade = upgItem;
                        if (localUpgrade) newBuild.equipment[`${slot}Rune`] = localUpgrade;
                    }
                }
            });

            // Close the modal and load the built data structure into the UI
            document.getElementById('import-game-modal').classList.add('hidden');
            await this.loadBuild(newBuild);

            document.body.style.cursor = 'default';
            alert('Character imported successfully!');

        } catch (error) {
            console.error("Failed executing import: ", error);
            document.body.style.cursor = 'default';
            alert("An error occurred mapping the character data. Check console for details.");
        }
    }

    // ==================== PROFESSION EXTRAS ====================

    /**
     * Load pets for Ranger profession
     */
    async loadPets() {
        try {
            const petIds = await api.getPets();
            // getPets() returns array of pet IDs, need to fetch details
            if (petIds && petIds.length > 0) {
                const pets = await api.getPetDetails(petIds);
                this.state.availablePets = pets;
                console.log("Pets loaded:", pets.length);
            } else {
                this.state.availablePets = [];
            }
        } catch (e) {
            console.error("Failed to load pets:", e);
            this.state.availablePets = [];
        }
    }

    /**
     * Load legends for Revenant profession
     */
    async loadLegends() {
        try {
            console.log("Loading legends...");
            // Fetch all legend IDs from the /legends endpoint
            const legendIds = await api.fetchAPI('/legends');
            console.log("Legend IDs from API:", legendIds);

            if (!legendIds || legendIds.length === 0) {
                console.warn("No legends found from API");
                this.state.availableLegends = [];
                return;
            }

            // Fetch details for each legend
            const legends = [];
            for (const legendId of legendIds) {
                try {
                    console.log(`Fetching legend details for: ${legendId}`);
                    const legendData = await api.fetchAPI(`/legends/${legendId}`);
                    console.log(`Legend data for ${legendId}:`, legendData);

                    // The 'swap' skill ID is the legend icon/name skill
                    if (legendData && legendData.swap) {
                        const skillDetails = await api.getSkills([legendData.swap]);
                        console.log(`Skill details for legend ${legendId}:`, skillDetails);

                        if (skillDetails && skillDetails.length > 0) {
                            // Store the full legend data with the skill for later use
                            const legendWithFullData = {
                                ...skillDetails[0],
                                legendData: legendData  // Store the full legend data
                            };
                            legends.push(legendWithFullData);
                        }
                    } else {
                        console.warn(`Legend ${legendId} missing swap skill:`, legendData);
                    }
                } catch (e) {
                    console.error(`Failed to load legend ${legendId}:`, e);
                }
            }

            this.state.availableLegends = legends;
            console.log("Legends loaded successfully:", legends.length, legends);
        } catch (e) {
            console.error("Failed to load legends:", e);
            this.state.availableLegends = [];
        }
    }

    /**
     * Check if current profession/elite spec is Ranger
     */
    isRanger() {
        return this.state.currentBuild.profession === 'Ranger';
    }

    /**
     * Check if current profession/elite spec is Revenant
     */
    isRevenant() {
        return this.state.currentBuild.profession === 'Revenant';
    }

    /**
     * Check if current elite spec is Scrapper (Engineer elite)
     */
    isScrapper() {
        const eliteSpecIds = this.getSelectedEliteSpecIds();
        // Scrapper is an elite spec for Engineer
        // We need to check if the selected elite spec is Scrapper
        if (eliteSpecIds.length === 0) return false;

        const eliteSpec = this.state.availableSpecializations.find(s =>
            eliteSpecIds.includes(s.id) && s.elite && s.name === 'Scrapper'
        );
        return !!eliteSpec;
    }

    /**
     * Render profession extras based on current profession
     */
    async renderProfessionExtras() {
        const container = document.getElementById('profession-extras');
        if (!container) return;

        // Clear container
        container.innerHTML = '';

        // Determine what to show based on profession
        if (this.isRanger()) {
            await this.renderPetPicker(container);
            container.classList.remove('hidden');
        } else if (this.isRevenant()) {
            await this.renderLegendPicker(container);
            container.classList.remove('hidden');
        } else if (this.isScrapper()) {
            await this.renderToolbeltDisplay(container);
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
    }

    /**
     * Clear profession extras container
     */
    clearProfessionExtras() {
        const container = document.getElementById('profession-extras');
        if (container) {
            container.innerHTML = '';
            container.classList.add('hidden');
        }
    }

    /**
     * Render pet picker for Ranger
     */
    async renderPetPicker(container) {
        // Load pets if not already loaded
        if (this.state.availablePets.length === 0) {
            await this.loadPets();
        }

        const petPicker = document.createElement('div');
        petPicker.className = 'pet-picker';
        petPicker.innerHTML = `
            <h4>Active Pets</h4>
            <div class="pet-slots">
                <div class="pet-slot" data-pet-slot="1">
                    <img class="pet-icon" src="" alt="Pet 1" />
                    <span class="pet-name">Select Pet</span>
                </div>
                <div class="pet-slot" data-pet-slot="2">
                    <img class="pet-icon" src="" alt="Pet 2" />
                    <span class="pet-name">Select Pet</span>
                </div>
            </div>
        `;

        container.appendChild(petPicker);

        // Add click handlers for pet slots
        const petSlots = petPicker.querySelectorAll('.pet-slot');
        petSlots.forEach(slot => {
            slot.addEventListener('click', (e) => {
                e.stopPropagation();
                const petSlotNum = slot.getAttribute('data-pet-slot');
                this.openPetPicker(petSlotNum);
            });

            // Add tooltip events
            this.addPetTooltipEvents(slot);
        });

        // Restore saved pets
        this.restorePetSlotsUI();
    }

    /**
     * Open pet picker modal
     */
    openPetPicker(petSlotNum) {
        this.state.currentPetSlot = petSlotNum;
        this.showPetModal();
    }

    /**
     * Show pet selection modal
     */
    showPetModal() {
        let modal = document.getElementById('pet-modal');
        if (!modal) {
            modal = this.createPetModal();
        }

        this.renderPetList();
        modal.classList.remove('hidden');
    }

    /**
     * Create pet selection modal
     */
    createPetModal() {
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'pet-modal';
        modalOverlay.className = 'modal-overlay hidden';

        modalOverlay.innerHTML = `
            <div class="modal-content glass-panel">
                <div class="modal-header">
                    <h3 id="pet-modal-title">Select Pet</h3>
                    <button id="close-pet-modal-btn" class="close-btn">&times;</button>
                </div>
                <input type="text" id="pet-search" placeholder="Search pets..." class="styled-select mb-1" />
                <div class="pet-list-container" id="modal-pet-list">
                    <!-- Pets will be injected here -->
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        // Add event listeners
        modalOverlay.querySelector('#close-pet-modal-btn').addEventListener('click', () => {
            modalOverlay.classList.add('hidden');
        });

        modalOverlay.querySelector('#pet-search').addEventListener('input', (e) => {
            this.renderPetList(e.target.value);
        });

        // Close modal when clicking outside
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.classList.add('hidden');
            }
        });

        return modalOverlay;
    }

    /**
     * Render pet list in modal
     */
    renderPetList(filter = '') {
        const container = document.getElementById('modal-pet-list');
        if (!container) return;

        container.innerHTML = '';
        const lowerFilter = filter.toLowerCase();

        this.state.availablePets.forEach(pet => {
            if (filter && !pet.name.toLowerCase().includes(lowerFilter)) return;

            const petItem = document.createElement('div');
            petItem.className = 'pet-list-item';

            petItem.innerHTML = `
                <img class="pet-list-icon" src="${pet.icon}" alt="${pet.name}" />
                <div class="pet-list-info">
                    <div class="pet-list-name">${pet.name}</div>
                    <div class="pet-list-family">${pet.family || ''}</div>
                </div>
            `;

            petItem.addEventListener('click', () => this.selectPet(pet));

            // Add tooltip events
            this.addPetModalTooltipEvents(petItem, pet);

            container.appendChild(petItem);
        });
    }

    /**
     * Select a pet for the current slot
     */
    selectPet(pet) {
        if (!this.state.currentPetSlot) return;

        const slotNum = this.state.currentPetSlot;

        // Initialize professionExtras if needed
        if (!this.state.currentBuild.professionExtras) {
            this.state.currentBuild.professionExtras = {};
        }

        // Store pet selection
        this.state.currentBuild.professionExtras[`pet${slotNum}`] = pet;

        // Update UI
        this.updatePetSlotUI(slotNum, pet);

        // Close modal
        document.getElementById('pet-modal').classList.add('hidden');
    }

    /**
     * Update pet slot UI
     */
    updatePetSlotUI(slotNum, pet) {
        const slotEl = document.querySelector(`[data-pet-slot="${slotNum}"]`);
        if (!slotEl) return;

        const iconEl = slotEl.querySelector('.pet-icon');
        const nameEl = slotEl.querySelector('.pet-name');

        if (pet) {
            iconEl.src = pet.icon;
            iconEl.alt = pet.name;
            nameEl.textContent = pet.name;
            slotEl.classList.add('has-selection');
        } else {
            iconEl.src = '';
            iconEl.alt = `Pet ${slotNum}`;
            nameEl.textContent = 'Select Pet';
            slotEl.classList.remove('has-selection');
        }
    }

    /**
     * Restore pet slots UI from saved build
     */
    restorePetSlotsUI() {
        if (!this.state.currentBuild.professionExtras) return;

        const pet1 = this.state.currentBuild.professionExtras.pet1;
        const pet2 = this.state.currentBuild.professionExtras.pet2;

        if (pet1) this.updatePetSlotUI('1', pet1);
        if (pet2) this.updatePetSlotUI('2', pet2);
    }

    /**
     * Add tooltip events for pet slots
     */
    addPetTooltipEvents(el) {
        const tooltip = document.getElementById('global-tooltip');

        el.addEventListener('mouseenter', (e) => {
            const slotNum = el.getAttribute('data-pet-slot');
            const pet = this.state.currentBuild.professionExtras?.[`pet${slotNum}`];
            if (!pet) return;

            document.getElementById('tooltip-title').textContent = pet.name;
            document.getElementById('tooltip-desc').innerHTML = pet.description || 'No description available';

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    /**
     * Add tooltip events for pet modal items
     */
    addPetModalTooltipEvents(el, pet) {
        const tooltip = document.getElementById('global-tooltip');

        el.addEventListener('mouseenter', (e) => {
            document.getElementById('tooltip-title').textContent = pet.name;
            document.getElementById('tooltip-desc').innerHTML = pet.description || 'No description available';

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    /**
     * Render legend picker for Revenant
     */
    async renderLegendPicker(container) {
        // Load legends if not already loaded
        if (this.state.availableLegends.length === 0) {
            await this.loadLegends();
        }

        const legendPicker = document.createElement('div');
        legendPicker.className = 'legend-picker';
        legendPicker.innerHTML = `
            <h4>Legends</h4>
            <div class="legend-slots">
                <div class="legend-slot" data-legend-slot="1">
                    <img class="legend-icon" src="" alt="Legend 1" />
                    <span class="legend-name">Select Legend</span>
                </div>
                <div class="legend-slot" data-legend-slot="2">
                    <img class="legend-icon" src="" alt="Legend 2" />
                    <span class="legend-name">Select Legend</span>
                </div>
            </div>
        `;

        container.appendChild(legendPicker);

        // Add click handlers for legend slots
        const legendSlots = legendPicker.querySelectorAll('.legend-slot');
        legendSlots.forEach(slot => {
            slot.addEventListener('click', (e) => {
                e.stopPropagation();
                const legendSlotNum = slot.getAttribute('data-legend-slot');
                this.openLegendPicker(legendSlotNum);
            });

            // Add tooltip events
            this.addLegendTooltipEvents(slot);
        });

        // Restore saved legends
        this.restoreLegendSlotsUI();

        // Update swap button visibility after rendering
        this.updateSwapButtonVisibility();
    }

    /**
     * Open legend picker modal
     */
    openLegendPicker(legendSlotNum) {
        this.state.currentLegendSlot = legendSlotNum;
        this.showLegendModal();
    }

    /**
     * Show legend selection modal
     */
    showLegendModal() {
        let modal = document.getElementById('legend-modal');
        if (!modal) {
            modal = this.createLegendModal();
        }

        this.renderLegendList();
        modal.classList.remove('hidden');
    }

    /**
     * Create legend selection modal
     */
    createLegendModal() {
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'legend-modal';
        modalOverlay.className = 'modal-overlay hidden';

        modalOverlay.innerHTML = `
            <div class="modal-content glass-panel">
                <div class="modal-header">
                    <h3 id="legend-modal-title">Select Legend</h3>
                    <button id="close-legend-modal-btn" class="close-btn">&times;</button>
                </div>
                <input type="text" id="legend-search" placeholder="Search legends..." class="styled-select mb-1" />
                <div class="legend-list-container" id="modal-legend-list">
                    <!-- Legends will be injected here -->
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);

        // Add event listeners
        modalOverlay.querySelector('#close-legend-modal-btn').addEventListener('click', () => {
            modalOverlay.classList.add('hidden');
        });

        modalOverlay.querySelector('#legend-search').addEventListener('input', (e) => {
            this.renderLegendList(e.target.value);
        });

        // Close modal when clicking outside
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.classList.add('hidden');
            }
        });

        return modalOverlay;
    }

    /**
     * Render legend list in modal
     */
    renderLegendList(filter = '') {
        const container = document.getElementById('modal-legend-list');
        if (!container) return;

        container.innerHTML = '';
        const lowerFilter = filter.toLowerCase();

        this.state.availableLegends.forEach(legend => {
            if (filter && !legend.name.toLowerCase().includes(lowerFilter)) return;

            const legendItem = document.createElement('div');
            legendItem.className = 'legend-list-item';

            legendItem.innerHTML = `
                <img class="legend-list-icon" src="${legend.icon}" alt="${legend.name}" />
                <div class="legend-list-name">${legend.name}</div>
            `;

            legendItem.addEventListener('click', () => this.selectLegend(legend));

            // Add tooltip events
            this.addLegendModalTooltipEvents(legendItem, legend);

            container.appendChild(legendItem);
        });
    }

    /**
     * Select a legend for the current slot
     */
    async selectLegend(legend) {
        if (!this.state.currentLegendSlot) return;

        const slotNum = this.state.currentLegendSlot;

        // Initialize professionExtras if needed
        if (!this.state.currentBuild.professionExtras) {
            this.state.currentBuild.professionExtras = {};
        }

        // Store legend selection
        this.state.currentBuild.professionExtras[`legend${slotNum}`] = legend;

        // Update UI
        this.updateLegendSlotUI(slotNum, legend);

        // Close modal
        document.getElementById('legend-modal').classList.add('hidden');

        // For Revenant, use stored legend data or fetch if needed
        if (this.isRevenant()) {
            // Check if legend has stored legendData from loadLegends()
            if (legend.legendData) {
                // Use the stored legend data directly
                await this.populateSkillsFromLegendData(legend.legendData, slotNum);
            } else {
                // Fallback: fetch full legend details and populate skills
                await this.populateSkillsFromLegend(slotNum, legend);
            }
        }
    }

    /**
     * Populate heal, utility, and elite skills from a legend
     * @param {number} slotNum - The legend slot number (1 or 2)
     * @param {Object} legend - The legend skill object (contains the swap skill)
     */
    async populateSkillsFromLegend(slotNum, legend) {
        try {
            // Fetch full legend details from API
            const legendId = legend.id;
            const legendData = await api.getLegendDetails(legendId);

            if (!legendData) {
                console.warn(`No legend data found for ${legendId}`);
                return;
            }

            // Store the full legend data for later use
            this.state.currentBuild.professionExtras[`legend${slotNum}Data`] = legendData;

            // Set this legend as active
            this.state.activeLegendSlot = slotNum;
            this.state.currentBuild.professionExtras.activeLegendSlot = slotNum;

            // Collect all skill IDs to fetch
            const skillIds = [];
            if (legendData.heal) skillIds.push(legendData.heal);
            if (legendData.utilities && legendData.utilities.length > 0) {
                skillIds.push(...legendData.utilities);
            }
            if (legendData.elite) skillIds.push(legendData.elite);

            if (skillIds.length === 0) {
                console.warn(`No skills found for legend ${legendId}`);
                return;
            }

            // Fetch all skill details
            const skills = await api.getSkills(skillIds);

            // Map skills by ID for easy lookup
            const skillMap = {};
            skills.forEach(skill => {
                skillMap[skill.id] = skill;
            });

            // Populate heal skill
            if (legendData.heal && skillMap[legendData.heal]) {
                this.state.currentBuild.skills.heal = skillMap[legendData.heal];
                this.updateSkillSlotUI('heal', skillMap[legendData.heal]);
            }

            // Populate utility skills
            if (legendData.utilities && legendData.utilities.length > 0) {
                for (let i = 0; i < 3; i++) {
                    const utilityId = legendData.utilities[i];
                    if (utilityId && skillMap[utilityId]) {
                        this.state.currentBuild.skills.utility[i] = skillMap[utilityId];
                        this.updateSkillSlotUI(`utility${i + 1}`, skillMap[utilityId]);
                    } else {
                        this.state.currentBuild.skills.utility[i] = null;
                        this.clearSkillSlotUI(`utility${i + 1}`);
                    }
                }
            }

            // Populate elite skill
            if (legendData.elite && skillMap[legendData.elite]) {
                this.state.currentBuild.skills.elite = skillMap[legendData.elite];
                this.updateSkillSlotUI('elite', skillMap[legendData.elite]);
            }

            // Update swap button visibility
            this.updateSwapButtonVisibility();

            // Update toolbelt skills if Scrapper
            this.onSkillsChanged();

        } catch (error) {
            console.error(`Failed to populate skills from legend:`, error);
        }
    }

    /**
     * Clear a single skill slot UI
     * @param {string} slotName - The slot name (e.g., 'heal', 'utility1', 'elite')
     */
    clearSkillSlotUI(slotName) {
        const slotEl = document.querySelector(`[data-slot="${slotName}"]`);
        if (slotEl) {
            slotEl.classList.remove('has-skill');
            slotEl.classList.add('empty');
            const icon = slotEl.querySelector('.skill-icon');
            if (icon) icon.src = '';
        }
    }

    /**
     * Swap between the two selected legends
     */
    async swapLegends() {
        if (!this.isRevenant()) return;

        const legend1 = this.state.currentBuild.professionExtras?.legend1;
        const legend2 = this.state.currentBuild.professionExtras?.legend2;

        // Only swap if both legends are selected
        if (!legend1 || !legend2) return;

        // Toggle active legend slot
        const newActiveSlot = this.state.activeLegendSlot === 1 ? 2 : 1;
        this.state.activeLegendSlot = newActiveSlot;
        this.state.currentBuild.professionExtras.activeLegendSlot = newActiveSlot;

        // Get the legend data for the new active slot
        const legendData = this.state.currentBuild.professionExtras[`legend${newActiveSlot}Data`];
        const legend = newActiveSlot === 1 ? legend1 : legend2;

        if (legendData) {
            // Populate skills from the stored legend data
            await this.populateSkillsFromLegendData(legendData, newActiveSlot);
        } else {
            // Fetch and populate if data not stored
            await this.populateSkillsFromLegend(newActiveSlot, legend);
        }

        // Update swap button state
        this.updateSwapButtonState();

        // Update legend slot UI to show which legend is active
        this.updateLegendSlotActiveState();
    }

    /**
     * Update legend slot UI to show which legend is currently active
     */
    updateLegendSlotActiveState() {
        const legendSlots = document.querySelectorAll('.legend-slot');
        legendSlots.forEach(slot => {
            const slotNum = slot.getAttribute('data-legend-slot');
            if (parseInt(slotNum) === this.state.activeLegendSlot) {
                slot.classList.add('active');
            } else {
                slot.classList.remove('active');
            }
        });
    }

    /**
     * Populate skills from stored legend data
     * @param {Object} legendData - The full legend data object
     * @param {number} slotNum - The legend slot number (1 or 2), optional
     */
    async populateSkillsFromLegendData(legendData, slotNum = null) {
        try {
            // Set active legend slot if provided
            if (slotNum !== null) {
                this.state.activeLegendSlot = slotNum;
                this.state.currentBuild.professionExtras.activeLegendSlot = slotNum;
            }

            // Store the legend data for later use
            if (slotNum !== null) {
                this.state.currentBuild.professionExtras[`legend${slotNum}Data`] = legendData;
            }

            // Collect all skill IDs to fetch
            const skillIds = [];
            if (legendData.heal) skillIds.push(legendData.heal);
            if (legendData.utilities && legendData.utilities.length > 0) {
                skillIds.push(...legendData.utilities);
            }
            if (legendData.elite) skillIds.push(legendData.elite);

            if (skillIds.length === 0) return;

            // Fetch all skill details
            const skills = await api.getSkills(skillIds);

            // Map skills by ID for easy lookup
            const skillMap = {};
            skills.forEach(skill => {
                skillMap[skill.id] = skill;
            });

            // Populate heal skill
            if (legendData.heal && skillMap[legendData.heal]) {
                this.state.currentBuild.skills.heal = skillMap[legendData.heal];
                this.updateSkillSlotUI('heal', skillMap[legendData.heal]);
            }

            // Populate utility skills
            if (legendData.utilities && legendData.utilities.length > 0) {
                for (let i = 0; i < 3; i++) {
                    const utilityId = legendData.utilities[i];
                    if (utilityId && skillMap[utilityId]) {
                        this.state.currentBuild.skills.utility[i] = skillMap[utilityId];
                        this.updateSkillSlotUI(`utility${i + 1}`, skillMap[utilityId]);
                    } else {
                        this.state.currentBuild.skills.utility[i] = null;
                        this.clearSkillSlotUI(`utility${i + 1}`);
                    }
                }
            }

            // Populate elite skill
            if (legendData.elite && skillMap[legendData.elite]) {
                this.state.currentBuild.skills.elite = skillMap[legendData.elite];
                this.updateSkillSlotUI('elite', skillMap[legendData.elite]);
            }

            // Update swap button visibility
            this.updateSwapButtonVisibility();

            // Update legend slot active state
            this.updateLegendSlotActiveState();

            // Update toolbelt skills if Scrapper
            this.onSkillsChanged();

        } catch (error) {
            console.error(`Failed to populate skills from legend data:`, error);
        }
    }

    /**
     * Update swap button visibility based on legend selection
     */
    updateSwapButtonVisibility() {
        const swapBtn = document.getElementById('legend-swap-btn');
        if (!swapBtn) return;

        const legend1 = this.state.currentBuild.professionExtras?.legend1;
        const legend2 = this.state.currentBuild.professionExtras?.legend2;

        // Show swap button only if both legends are selected
        if (legend1 && legend2) {
            swapBtn.classList.remove('hidden');
        } else {
            swapBtn.classList.add('hidden');
        }
    }

    /**
     * Update swap button state (active legend indicator)
     */
    updateSwapButtonState() {
        const swapBtn = document.getElementById('legend-swap-btn');
        if (!swapBtn) return;

        // Update button text to show which legend is active
        const activeSlot = this.state.activeLegendSlot;
        swapBtn.textContent = `⇄ ${activeSlot}`;
        swapBtn.title = `Active: Legend ${activeSlot}. Click to swap.`;
    }

    /**
     * Update legend slot UI
     */
    updateLegendSlotUI(slotNum, legend) {
        const slotEl = document.querySelector(`[data-legend-slot="${slotNum}"]`);
        if (!slotEl) return;

        const iconEl = slotEl.querySelector('.legend-icon');
        const nameEl = slotEl.querySelector('.legend-name');

        if (legend) {
            iconEl.src = legend.icon;
            iconEl.alt = legend.name;
            nameEl.textContent = legend.name;
            slotEl.classList.add('has-selection');
        } else {
            iconEl.src = '';
            iconEl.alt = `Legend ${slotNum}`;
            nameEl.textContent = 'Select Legend';
            slotEl.classList.remove('has-selection');
        }
    }

    /**
     * Restore legend slots UI from saved build
     */
    restoreLegendSlotsUI() {
        if (!this.state.currentBuild.professionExtras) return;

        const legend1 = this.state.currentBuild.professionExtras.legend1;
        const legend2 = this.state.currentBuild.professionExtras.legend2;

        if (legend1) this.updateLegendSlotUI('1', legend1);
        if (legend2) this.updateLegendSlotUI('2', legend2);
    }

    /**
     * Add tooltip events for legend slots
     */
    addLegendTooltipEvents(el) {
        const tooltip = document.getElementById('global-tooltip');

        el.addEventListener('mouseenter', (e) => {
            const slotNum = el.getAttribute('data-legend-slot');
            const legend = this.state.currentBuild.professionExtras?.[`legend${slotNum}`];
            if (!legend) return;

            document.getElementById('tooltip-title').textContent = legend.name;
            document.getElementById('tooltip-desc').innerHTML = legend.description || 'No description available';

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    /**
     * Add tooltip events for legend modal items
     */
    addLegendModalTooltipEvents(el, legend) {
        const tooltip = document.getElementById('global-tooltip');

        el.addEventListener('mouseenter', (e) => {
            document.getElementById('tooltip-title').textContent = legend.name;
            document.getElementById('tooltip-desc').innerHTML = legend.description || 'No description available';

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    /**
     * Render toolbelt display for Scrapper
     */
    async renderToolbeltDisplay(container) {
        const toolbeltDisplay = document.createElement('div');
        toolbeltDisplay.className = 'toolbelt-display';
        toolbeltDisplay.innerHTML = `
            <h4>Toolbelt Skills</h4>
            <div class="toolbelt-slots" id="toolbelt-slots">
                <!-- Toolbelt skills will be injected here -->
            </div>
        `;

        container.appendChild(toolbeltDisplay);

        // Calculate and display toolbelt skills
        await this.updateToolbeltSkills();
    }

    /**
     * Update toolbelt skills based on equipped skills
     */
    async updateToolbeltSkills() {
        const slotsContainer = document.getElementById('toolbelt-slots');
        if (!slotsContainer) return;

        slotsContainer.innerHTML = '';

        // Get equipped skills
        const { heal, utility, elite } = this.state.currentBuild.skills;
        const equippedSkills = [heal, ...utility.filter(u => u), elite].filter(s => s);

        if (equippedSkills.length === 0) {
            slotsContainer.innerHTML = '<div class="toolbelt-empty">Equip skills to see toolbelt</div>';
            return;
        }

        // For each equipped skill, fetch the associated toolbelt skill
        for (const skill of equippedSkills) {
            if (skill && skill.toolbelt_skill) {
                try {
                    const toolbeltSkills = await api.getSkills([skill.toolbelt_skill]);
                    if (toolbeltSkills && toolbeltSkills.length > 0) {
                        const toolbeltSkill = toolbeltSkills[0];
                        this.renderToolbeltSlot(slotsContainer, toolbeltSkill);
                    }
                } catch (e) {
                    console.error(`Failed to fetch toolbelt skill for ${skill.name}:`, e);
                }
            }
        }

        // If no toolbelt skills were found
        if (slotsContainer.children.length === 0) {
            slotsContainer.innerHTML = '<div class="toolbelt-empty">No toolbelt skills available</div>';
        }
    }

    /**
     * Render a single toolbelt skill slot
     */
    renderToolbeltSlot(container, skill) {
        const slot = document.createElement('div');
        slot.className = 'toolbelt-slot';

        slot.innerHTML = `
            <img class="toolbelt-icon" src="${skill.icon}" alt="${skill.name}" />
            <span class="toolbelt-name">${skill.name}</span>
        `;

        // Add tooltip events
        this.addToolbeltTooltipEvents(slot, skill);

        container.appendChild(slot);
    }

    /**
     * Add tooltip events for toolbelt slots
     */
    addToolbeltTooltipEvents(el, skill) {
        const tooltip = document.getElementById('global-tooltip');

        el.addEventListener('mouseenter', (e) => {
            document.getElementById('tooltip-title').textContent = skill.name;
            document.getElementById('tooltip-desc').innerHTML = skill.description || 'No description available';

            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
            tooltip.classList.remove('hidden');
        });

        el.addEventListener('mousemove', (e) => {
            tooltip.style.left = e.pageX + 15 + 'px';
            tooltip.style.top = e.pageY + 15 + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    }

    /**
     * Update profession extras when skills change (for Scrapper)
     */
    async onSkillsChanged() {
        if (this.isScrapper()) {
            await this.updateToolbeltSkills();
        }
        this.recalculateStats();
    }
}

// Bootstrap the app
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
