/**
 * GW2 Build Chat Link Encoder/Decoder
 * Implements the build template chat link format as per:
 * https://wiki.guildwars2.com/wiki/Chat_link_format#Build_template_link
 */

import api from './api.js';

// Profession name to code mapping (from /v2/professions code field)
const PROFESSION_CODE = {
    'Guardian': 1,
    'Warrior': 2,
    'Engineer': 3,
    'Ranger': 4,
    'Thief': 5,
    'Elementalist': 6,
    'Mesmer': 7,
    'Necromancer': 8,
    'Revenant': 9
};

// Weapon type to ID mapping (from wiki)
const WEAPON_TYPE_ID = {
    'Axe': 5,
    'Longbow': 35,
    'Dagger': 47,
    'Focus': 49,
    'Greatsword': 50,
    'Hammer': 51,
    'Mace': 53,
    'Pistol': 54,
    'Rifle': 85,
    'Scepter': 86,
    'Shield': 87,
    'Staff': 89,
    'Sword': 90,
    'Torch': 102,
    'Warhorn': 103,
    'Shortbow': 107,
    'Spear': 265  // Note: Spear is aquatic, but included for completeness
};

// Legend name to code mapping (from /v2/legends code field)
// This will be populated dynamically from API, but we provide fallback static mapping
const LEGEND_CODE = {
    'Legendary Dragon Stance': 1,
    'Legendary Assassin Stance': 2,
    'Legendary Dwarf Stance': 3,
    'Legendary Demon Stance': 4,
    'Legendary Renegade Stance': 5,
    'Legendary Centaur Stance': 6,
    'Legendary Alliance Stance': 7,
    'Legendary Entity Stance': 8
};

// Cache for profession skill palette maps
const paletteCache = new Map();

// Cache for legend code maps
const legendCodeCache = new Map();

// Add these reverse mappings near the top of chatlink.js with your other constants
const PROFESSION_BY_CODE = Object.fromEntries(
    Object.entries(PROFESSION_CODE).map(([k, v]) => [v, k])
);

const WEAPON_TYPE_BY_ID = Object.fromEntries(
    Object.entries(WEAPON_TYPE_ID).map(([k, v]) => [v, k])
);

// Cache for mapping Palette ID -> Skill ID
const paletteToSkillCache = new Map();

async function getPaletteToSkillMap(professionId) {
    if (paletteToSkillCache.has(professionId)) return paletteToSkillCache.get(professionId);

    try {
        const profData = await api.getProfessionWithPalette(professionId);
        const map = new Map();

        if (profData.skills_by_palette) {
            for (const pair of profData.skills_by_palette) {
                if (Array.isArray(pair) && pair.length >= 2) {
                    map.set(pair[0], pair[1]); // paletteId -> skillId
                }
            }
        }
        paletteToSkillCache.set(professionId, map);
        return map;
    } catch (error) {
        console.error(`Failed to get palette map for ${professionId}:`, error);
        return new Map();
    }
}

/**
 * Fetches and builds a map from skill ID to palette ID for a given profession.
 * @param {string} professionId - Profession ID (e.g., "Warrior")
 * @returns {Promise<Map<number, number>>} Map where key is skill ID, value is palette ID
 */
async function getSkillPaletteMap(professionId) {
    if (paletteCache.has(professionId)) {
        return paletteCache.get(professionId);
    }

    try {
        const profData = await api.getProfessionWithPalette(professionId);
        const paletteMap = new Map();

        if (profData.skills_by_palette) {
            // GW2 API returns an array of arrays: [[paletteId, skillId], ...]
            for (const pair of profData.skills_by_palette) {
                if (Array.isArray(pair) && pair.length >= 2) {
                    paletteMap.set(pair[1], pair[0]);
                }
            }
        }

        paletteCache.set(professionId, paletteMap);
        return paletteMap;
    } catch (error) {
        console.error(`Failed to get skill palette map for ${professionId}:`, error);
        return new Map();
    }
}

/**
 * Gets the legend code for a given legend skill object.
 * @param {Object} legend - Legend skill object (from state, contains id and legendData)
 * @returns {Promise<number>} Legend code (1-8) or 0 if not found
 */
async function getLegendCode(legend) {
    if (!legend) return 0;

    // Check cache first
    if (legend.id && legendCodeCache.has(legend.id)) {
        return legendCodeCache.get(legend.id);
    }

    let code = 0;

    // Read the embedded data directly instead of hitting the API with a skill ID
    if (legend.legendData && legend.legendData.code) {
        code = legend.legendData.code;
    } else {
        // Fallback to static mapping by name
        code = LEGEND_CODE[legend.name] || 0;
    }

    if (legend.id) {
        legendCodeCache.set(legend.id, code);
    }

    return code;
}

/**
 * Encodes a build state object into a chat link string.
 * @param {Object} build - The build state from app.state.currentBuild
 * @param {Object} appState - Additional app state (weaponTypes, availableSpecializations, etc.)
 * @returns {Promise<string>} The chat link code (e.g., "[&...]")
 */
export async function encodeBuild(build, appState) {
    const professionId = build.profession;
    if (!professionId) {
        throw new Error('No profession selected');
    }

    const professionCode = PROFESSION_CODE[professionId];
    if (!professionCode) {
        throw new Error(`Unknown profession: ${professionId}`);
    }

    // Prepare data array (will be converted to bytes)
    const data = [];

    // Header byte
    data.push(0x0D);

    // Profession code
    data.push(professionCode);

    // Specializations: 3 pairs of (spec ID, trait byte)
    for (let i = 0; i < 3; i++) {
        const specId = build.specializations[i] || 0;
        data.push(specId & 0xFF); // low byte of spec ID (spec IDs are 2-byte? Actually they are 16-bit, but we push low byte first? The format uses 2 bytes per spec: first byte is specialization ID, second byte is trait choices. So spec ID is stored as a single byte? The wiki says "The first byte gives a specialization ID", implying spec IDs are within 0-255. That's likely true for core specs. We'll assume spec ID fits in one byte. If not, we need to handle 2-byte? But all spec IDs are < 256? Actually some elite specs have IDs > 255? Checking: Berserker ID is 18, so yes within byte. So we can push as one byte.

        // Trait byte: bits 7-6 unused, bits 5-4 = tier3 choice, bits 3-2 = tier2, bits 1-0 = tier1
        let traitByte = 0;
        if (specId) {
            const specData = appState.availableSpecializations.find(s => s.id === specId);
            if (specData) {
                // We need to know the mapping of trait IDs to positions. We'll rely on the trait list stored in build.traits for that spec.
                // build.traits is an object with keys '0','1','2' each array of 3 trait IDs.
                const traitsForSpec = build.traits[i]; // array of 3 trait IDs (or null)
                if (traitsForSpec) {
                    // Fetch the major traits for this spec to determine positions
                    // We need to get the list of major traits per tier in order.
                    // We can get this from specData.major_traits, but we also need to know their order (by order field).
                    // We can build a map of traitId -> tier and position within tier.
                    // Since we might not have the full trait data here, we'll assume the build object includes the necessary mapping.
                    // Alternatively, we can fetch traits on the fly, but that would be async.
                    // For now, we'll use a placeholder: we need to compute positions.
                    // To keep this function async, we'll fetch the traits if not already known.
                    // But to simplify for first implementation, we'll assume we have a map from specId to tier position map stored somewhere.
                    // We'll add a helper to compute trait byte given specData and traits array.
                    traitByte = await computeTraitByte(specData, traitsForSpec);
                }
            }
        }
        data.push(traitByte);
    }

    // Skills: 10 slots, each 2 bytes little-endian
    // Slots order:
    // 0: Terrestrial Heal
    // 1: Aquatic Heal
    // 2: Terrestrial Utility 1
    // 3: Aquatic Utility 1
    // 4: Terrestrial Utility 2
    // 5: Aquatic Utility 2
    // 6: Terrestrial Utility 3
    // 7: Aquatic Utility 3
    // 8: Terrestrial Elite
    // 9: Aquatic Elite

    const skills = build.skills || { heal: null, utility: [null, null, null], elite: null };
    const skillSlots = [
        skills.heal, null,                 // 0,1
        skills.utility[0], null,            // 2,3
        skills.utility[1], null,            // 4,5
        skills.utility[2], null,            // 6,7
        skills.elite, null                  // 8,9
    ];

    // Get skill palette map for this profession
    const paletteMap = await getSkillPaletteMap(professionId);
    console.log(`encodeBuild - paletteMap size for ${professionId}:`, paletteMap.size);

    // Debug: log skill IDs and map presence
    console.log(`encodeBuild - skill IDs: ${skillSlots.map(s => s ? s.id : 0).join(', ')}`);
    for (let i = 0; i < 10; i++) {
        const skill = skillSlots[i];
        if (skill && skill.id) {
            console.log(`Skill slot ${i}: ${skill.name} (ID: ${skill.id}, type: ${typeof skill.id}) - in map: ${paletteMap.has(skill.id)}`);
        }
    }

    // Write skill bytes (no overrides collection)
    for (let i = 0; i < 10; i++) {
        const skill = skillSlots[i];
        let paletteId = 0;
        if (skill && skill.id) {
            paletteId = paletteMap.get(skill.id) || 0;
        }
        // Write as little-endian 16-bit
        data.push(paletteId & 0xFF);
        data.push((paletteId >> 8) & 0xFF);
    }

    // Profession-specific data (16 bytes)
    const profExtras = build.professionExtras || {};
    if (professionId === 'Ranger') {
        // 4 bytes for pets (1 byte per pet!), rest zero
        const pet1 = profExtras.pet1 || null;
        const pet2 = profExtras.pet2 || null;
        const pet1Id = pet1 && pet1.id ? pet1.id : 0;
        const pet2Id = pet2 && pet2.id ? pet2.id : 0;
        data.push(pet1Id & 0xFF); // Terrestrial 1
        data.push(pet2Id & 0xFF); // Terrestrial 2
        data.push(0); // Aquatic 1
        data.push(0); // Aquatic 2

        for (let i = 0; i < 12; i++) data.push(0);
    } else if (professionId === 'Revenant') {
        const activeSlot = profExtras.activeLegendSlot || 1;

        // Ensure Active is always written before Inactive
        const activeLegend = activeSlot === 1 ? profExtras.legend1 : profExtras.legend2;
        const inactiveLegend = activeSlot === 1 ? profExtras.legend2 : profExtras.legend1;

        const activeLegendCode = activeLegend ? await getLegendCode(activeLegend) : 0;
        const inactiveLegendCode = inactiveLegend ? await getLegendCode(inactiveLegend) : 0;

        data.push(activeLegendCode); // terrestrial active
        data.push(inactiveLegendCode); // terrestrial inactive
        data.push(0); // aquatic active
        data.push(0); // aquatic inactive

        // Next 12 bytes: inactive legend utility skills (2 bytes each, little-endian)
        let inactiveUtils = [0, 0, 0];
        if (inactiveLegend && inactiveLegend.legendData && inactiveLegend.legendData.utilities) {
            inactiveUtils = inactiveLegend.legendData.utilities;
        }

        const paletteMap = await getSkillPaletteMap(professionId);

        for (let i = 0; i < 3; i++) {
            const skillId = inactiveUtils[i] || 0;
            const paletteId = skillId ? (paletteMap.get(skillId) || 0) : 0;
            data.push(paletteId & 0xFF);
            data.push((paletteId >> 8) & 0xFF);
        }

        // Aquatic inactive legend utilities (6 bytes)
        for (let i = 0; i < 6; i++) data.push(0);
    } else {
        // All other professions: 16 zeros
        for (let i = 0; i < 16; i++) data.push(0);
    }

    // Weapons array (dynamic)
    const weaponTypes = appState.weaponTypes || {};
    const weaponSlots = ['WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2'];
    const weaponIds = [];
    for (const slot of weaponSlots) {
        const type = weaponTypes[slot];
        if (type && WEAPON_TYPE_ID[type]) {
            weaponIds.push(WEAPON_TYPE_ID[type]);
        }
    }
    // The game deduplicates weapons in chat links; it's safer for us to mimic this.
    const uniqueWeaponIds = [...new Set(weaponIds)];
    data.push(uniqueWeaponIds.length);
    for (const id of uniqueWeaponIds) {
        data.push(id & 0xFF);
        data.push((id >> 8) & 0xFF);
    }

    // Skill overrides array 
    // This is explicitly for Weaponmaster skill variants (4-bytes each). 
    // You do not currently support UI for weapon variants, so we just declare 0 overrides.
    data.push(0);

    // Convert data array to Uint8Array
    const byteArray = new Uint8Array(data);

    // Encode to base64
    const base64 = btoa(String.fromCharCode(...byteArray));

    // Return as chat link
    return `[&${base64}]`;
}

/**
 * Helper to compute trait byte given spec data and selected trait IDs.
 * @param {Object} specData - Specialization data from API
 * @param {Array} traitsForSpec - Array of 3 trait IDs (one per tier, may be null)
 * @returns {Promise<number>} Trait byte
 */
async function computeTraitByte(specData, traitsForSpec) {
    // We need to fetch major traits for this spec to know order
    const majorTraitIds = specData.major_traits;
    if (!majorTraitIds || majorTraitIds.length === 0) return 0;

    // Fetch trait details to get tier and order
    const traits = await api.getTraits(majorTraitIds);
    // Group by tier and sort by order
    const traitsByTier = { 1: [], 2: [], 3: [] };
    traits.forEach(t => {
        if (t.tier && t.order !== undefined) {
            traitsByTier[t.tier].push({ id: t.id, order: t.order });
        }
    });
    // Sort each tier by order
    for (let tier = 1; tier <= 3; tier++) {
        traitsByTier[tier].sort((a, b) => a.order - b.order);
    }

    // Build map from trait ID to position (1-3) within tier
    const positionMap = new Map();
    for (let tier = 1; tier <= 3; tier++) {
        traitsByTier[tier].forEach((t, index) => {
            positionMap.set(t.id, index + 1); // 1-indexed position
        });
    }

    let tier1 = 0, tier2 = 0, tier3 = 0;
    if (traitsForSpec && traitsForSpec.length >= 3) {
        tier1 = positionMap.get(traitsForSpec[0]) || 0;
        tier2 = positionMap.get(traitsForSpec[1]) || 0;
        tier3 = positionMap.get(traitsForSpec[2]) || 0;
    }

    // Ensure values are 0-3
    tier1 = Math.min(3, Math.max(0, tier1));
    tier2 = Math.min(3, Math.max(0, tier2));
    tier3 = Math.min(3, Math.max(0, tier3));

    // Combine: bits 7-6 unused, bits 5-4 = tier3, bits 3-2 = tier2, bits 1-0 = tier1
    return (tier3 << 4) | (tier2 << 2) | tier1;
}

/**
 * Decodes a chat link string into a build state object.
 */
export async function decodeBuild(chatCode) {
    const match = chatCode.match(/^\[&(.*)\]$/);
    if (!match) throw new Error("Invalid chat code format. Must start with [& and end with ]");

    const binary = atob(match[1]);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);

    if (data[0] !== 0x0D) throw new Error("Not a build template chat code");
    if (data.length < 44) throw new Error("Chat code is too short");

    const professionCode = data[1];
    const professionId = PROFESSION_BY_CODE[professionCode];
    if (!professionId) throw new Error(`Unknown profession code: ${professionCode}`);

    // Skeleton build object
    const build = {
        name: 'Imported Build',
        profession: professionId,
        specializations: [null, null, null],
        traits: { 0: [], 1: [], 2: [] },
        equipment: {}, // Chat links do not contain gear stats/runes
        skills: { heal: null, utility: [null, null, null], elite: null },
        professionExtras: {},
        weaponTypes: { WeaponA1: '', WeaponA2: '', WeaponB1: '', WeaponB2: '' },
        activeWeaponSet: 'A',
        notes: 'Imported from chat code: ' + chatCode
    };

    // --- 1. Decode Specializations and Traits ---
    const specIds = [data[2], data[4], data[6]];
    const traitBytes = [data[3], data[5], data[7]];

    const validSpecIds = specIds.filter(id => id > 0);
    const specs = validSpecIds.length > 0 ? await api.getSpecializations(validSpecIds) : [];

    for (let i = 0; i < 3; i++) {
        const specId = specIds[i];
        if (!specId) {
            build.traits[i] = [null, null, null];
            continue;
        }
        build.specializations[i] = specId;

        const tb = traitBytes[i];
        const positions = [tb & 0x03, (tb >> 2) & 0x03, (tb >> 4) & 0x03]; // Tier 1, 2, 3 selections (0 means none, 1-3 = left/mid/right)

        const specData = specs.find(s => s.id === specId);
        if (specData && specData.major_traits) {
            const traits = await api.getTraits(specData.major_traits);
            const traitsByTier = { 1: [], 2: [], 3: [] };

            traits.forEach(t => {
                if (t.tier && t.order !== undefined) traitsByTier[t.tier].push(t);
            });

            const selectedTraits = [null, null, null];
            for (let tier = 1; tier <= 3; tier++) {
                traitsByTier[tier].sort((a, b) => a.order - b.order);
                const pos = positions[tier - 1];
                if (pos >= 1 && pos <= 3 && traitsByTier[tier][pos - 1]) {
                    selectedTraits[tier - 1] = traitsByTier[tier][pos - 1].id;
                }
            }
            build.traits[i] = selectedTraits;
        } else {
            build.traits[i] = [null, null, null];
        }
    }

    // --- 2. Decode Skills ---
    const paletteToSkill = await getPaletteToSkillMap(professionId);

    // Terrestrial slots are at byte index 8, 12, 16, 20, 24 (Aquatic slots ignored for now)
    const terrSlotOffsets = [8, 12, 16, 20, 24];
    const skillIds = [];

    for (let i = 0; i < 5; i++) {
        const offset = terrSlotOffsets[i];
        const paletteId = data[offset] | (data[offset + 1] << 8);
        const skillId = paletteToSkill.get(paletteId);
        skillIds.push(skillId || null);
    }

    const validSkillIds = skillIds.filter(id => id !== null);
    const skillsObjMap = {};
    if (validSkillIds.length > 0) {
        const fetchedSkills = await api.getSkills(validSkillIds);
        fetchedSkills.forEach(s => skillsObjMap[s.id] = s);
    }

    build.skills.heal = skillIds[0] ? skillsObjMap[skillIds[0]] : null;
    build.skills.utility[0] = skillIds[1] ? skillsObjMap[skillIds[1]] : null;
    build.skills.utility[1] = skillIds[2] ? skillsObjMap[skillIds[2]] : null;
    build.skills.utility[2] = skillIds[3] ? skillsObjMap[skillIds[3]] : null;
    build.skills.elite = skillIds[4] ? skillsObjMap[skillIds[4]] : null;

    // --- 3. Decode Profession Extras ---
    if (professionId === 'Ranger') {
        const validPets = [data[28], data[29]].filter(id => id > 0);
        if (validPets.length > 0) {
            const fetchedPets = await api.getPetDetails(validPets);
            const petMap = {};
            fetchedPets.forEach(p => petMap[p.id] = p);
            build.professionExtras.pet1 = petMap[data[28]] || null;
            build.professionExtras.pet2 = petMap[data[29]] || null;
        }
    } else if (professionId === 'Revenant') {
        const codeToLegId = {
            1: 'Legendary Dragon Stance', 2: 'Legendary Assassin Stance', 3: 'Legendary Dwarf Stance',
            4: 'Legendary Demon Stance', 5: 'Legendary Renegade Stance', 6: 'Legendary Centaur Stance',
            7: 'Legendary Alliance Stance', 8: 'Legendary Entity Stance'
        };

        const fetchLegend = async (code) => {
            if (!code || code === 0) return null;
            const legendId = codeToLegId[code];
            if (!legendId) return null;
            try {
                const legendData = await api.fetchAPI(`/legends/${legendId}`);
                if (legendData && legendData.swap) {
                    const skills = await api.getSkills([legendData.swap]);
                    if (skills && skills.length > 0) return { ...skills[0], legendData };
                }
            } catch (e) { console.error(e); }
            return null;
        };

        const leg1 = await fetchLegend(data[28]); // active legend
        const leg2 = await fetchLegend(data[29]); // inactive legend

        build.professionExtras.legend1 = leg1;
        build.professionExtras.legend2 = leg2;

        // Explicitly inject legend1Data / legend2Data so app.js can populate the utilities visually
        if (leg1 && leg1.legendData) {
            build.professionExtras.legend1Data = leg1.legendData;
        }
        if (leg2 && leg2.legendData) {
            build.professionExtras.legend2Data = leg2.legendData;
        }

        build.professionExtras.activeLegendSlot = 1;
    }

    // --- 4. Decode Weapons (Optional) ---
    let cursor = 44;
    if (cursor < data.length) {
        const weaponCount = data[cursor++];
        const weaponIds = [];
        for (let i = 0; i < weaponCount; i++) {
            if (cursor + 1 < data.length) {
                weaponIds.push(data[cursor] | (data[cursor + 1] << 8));
                cursor += 2;
            }
        }

        const weaponTypesArr = weaponIds.map(id => WEAPON_TYPE_BY_ID[id]).filter(t => t);
        const is2H = (w) => ['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff'].includes(w);

        // Simple heuristic to drop the weapons into UI slots cleanly
        if (weaponTypesArr.length > 0) build.weaponTypes.WeaponA1 = weaponTypesArr[0];
        if (weaponTypesArr.length > 1) {
            if (is2H(weaponTypesArr[0])) {
                build.weaponTypes.WeaponB1 = weaponTypesArr[1];
                if (weaponTypesArr.length > 2) build.weaponTypes.WeaponB2 = weaponTypesArr[2];
            } else {
                build.weaponTypes.WeaponA2 = weaponTypesArr[1];
                if (weaponTypesArr.length > 2) build.weaponTypes.WeaponB1 = weaponTypesArr[2];
                if (weaponTypesArr.length > 3) build.weaponTypes.WeaponB2 = weaponTypesArr[3];
            }
        }
    }

    return build;
}
