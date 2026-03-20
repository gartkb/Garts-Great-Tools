/**
 * GW2 API Client Module
 * Handles fetching and caching data from the official Guild Wars 2 API.
 */

const BaseURL = 'https://api.guildwars2.com/v2';

// Simple in-memory cache to avoid redundant network requests during a session.
const cache = new Map();


/**
 * Generic API fetch function with caching.
 * @param {string} endpoint - The API endpoint (e.g., '/professions')
 * @returns {Promise<any>} The parsed JSON response.
 */
async function fetchAPI(endpoint) {
    if (cache.has(endpoint)) {
        return cache.get(endpoint);
    }
    try {
        const response = await fetch(`${BaseURL}${endpoint}`);
        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        cache.set(endpoint, data);
        return data;
    } catch (error) {
        console.error(`Failed to fetch ${endpoint}:`, error);
        throw error;
    }
}

/**
 * Fetches a list of all available professions.
 */
export async function getProfessions() {
    return await fetchAPI('/professions');
}

/**
 * Fetches details for a specific profession by ID.
 * @param {string} professionId (e.g., "Elementalist")
 */
export async function getProfession(professionId) {
    return await fetchAPI(`/professions/${professionId}`);
}

/**
 * Fetches details for multiple specializations by their IDs.
 * @param {number[]} ids - Array of specialization IDs
 */
export async function getSpecializations(ids) {
    if (!ids || ids.length === 0) return [];
    const joinedIds = ids.join(',');
    const specializations = await fetchAPI(`/specializations?ids=${joinedIds}`);

    // The API already includes background URLs from the render service
    return specializations;
}

/**
 * Fetches details for multiple traits by their IDs.
 * @param {number[]} ids - Array of trait IDs
 */
export async function getTraits(ids) {
    if (!ids || ids.length === 0) return [];
    // The GW2 API limits '?ids=' queries generally to 200 items. 
    // We assume we request traits per specialization (usually < 20).
    const joinedIds = ids.join(',');
    return await fetchAPI(`/traits?ids=${joinedIds}`);
}

/**
 * Fetches items from the API.
 * @param {number[]} ids 
 */
export async function getItems(ids) {
    if (!ids || ids.length === 0) return [];
    const joinedIds = ids.join(',');
    return await fetchAPI(`/items?ids=${joinedIds}`);
}

/**
 * Fetches item stats definitions from the API.
 * @param {number[]} ids 
 */
export async function getItemStats(ids) {
    if (!ids || ids.length === 0) return [];
    const joinedIds = ids.join(',');
    return await fetchAPI(`/itemstats?ids=${joinedIds}`);
}

/**
 * Fetches all item stats available in the game.
 */
export async function getAllItemStats() {
    return await fetchAPI(`/itemstats?ids=all`);
}

/**
 * Fetches details for multiple skills by their IDs.
 * @param {number[]} ids - Array of skill IDs
 */
export async function getSkills(ids) {
    if (!ids || ids.length === 0) return [];
    const joinedIds = ids.join(',');
    return await fetchAPI(`/skills?ids=${joinedIds}`);
}

/**
 * Fetches all skills for a specific profession.
 * Uses the profession endpoint which includes skill IDs.
 * @param {string} professionId - Profession name (e.g., "Warrior")
 */
export async function getProfessionSkills(professionId) {
    try {
        const professionData = await getProfession(professionId);
        if (!professionData || !professionData.skills) {
            console.warn(`No skills found for profession ${professionId}`);
            return [];
        }

        // Extract skill IDs from profession data
        // The skills field contains objects with id, slot, type
        const skillIds = professionData.skills
            .map(skill => skill.id || skill)
            .filter(id => id);

        if (skillIds.length === 0) {
            return [];
        }

        // Fetch skill details
        return await getSkills(skillIds);
    } catch (error) {
        console.error(`Failed to fetch skills for profession ${professionId}:`, error);
        return [];
    }
}

/**
 * Fetches skills filtered by slot (Heal, Utility, Elite) for a profession.
 * @param {string} professionId - Profession name
 * @param {string} slot - Slot type: 'Heal', 'Utility', 'Elite'
 * @param {number[]} allowedSpecializationIds - Array of specialization IDs whose skills should be included (empty array for core only)
 */
export async function getSkillsBySlot(professionId, slot, allowedSpecializationIds = []) {
    const allSkills = await getProfessionSkills(professionId);
    return allSkills.filter(skill => {
        // Filter by slot first
        if (skill.slot !== slot) return false;

        // If skill has no specialization field, it's a core skill - always include
        if (!skill.specialization) return true;

        // If skill has a specialization, only include if that specialization is in allowed list
        return allowedSpecializationIds.includes(skill.specialization);
    });
}

/**
 * Fetches all available pets for Ranger.
 */
export async function getPets() {
    return await fetchAPI('/pets');
}

/**
 * Fetches details for specific pets by their IDs.
 * @param {number[]} ids - Array of pet IDs
 */
export async function getPetDetails(ids) {
    if (!ids || ids.length === 0) return [];
    const joinedIds = ids.join(',');
    return await fetchAPI(`/pets?ids=${joinedIds}`);
}

/**
 * Fetches details for a specific legend by ID.
 * @param {string} legendId - Legend ID (e.g., "Legend1")
 * @returns {Promise<Object>} Legend data including heal, utilities, and elite skill IDs
 */
export async function getLegendDetails(legendId) {
    return await fetchAPI(`/legends/${legendId}`);
}

/**
 * Fetches profession details including skills_by_palette (v=latest).
 * @param {string} professionId - Profession ID
 * @returns {Promise<Object>} Profession data with skills_by_palette
 */
export async function getProfessionWithPalette(professionId) {
    return await fetchAPI(`/professions/${professionId}?v=latest`);
}

/**
 * Fetch with API Key Authorization (Using URL parameter to avoid CORS preflight issues)
 * @param {string} endpoint - The API endpoint
 * @param {string} apiKey - The GW2 API key
 * @returns {Promise<any>} The parsed JSON response
 */
async function fetchWithAuth(endpoint, apiKey) {
    try {
        // Automatically determine if we need a '?' or '&' to append the token
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${BaseURL}${endpoint}${separator}access_token=${apiKey}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch ${endpoint} with auth:`, error);
        throw error;
    }
}

/**
 * Gets a list of characters for the API key
 * @param {string} apiKey - The GW2 API key
 * @returns {Promise<Object[]>} Array of character objects with name and profession
 */
export async function getCharacters(apiKey) {
    return await fetchWithAuth('/characters?page=0', apiKey);
}

/**
 * Gets full details for a specific character
 * @param {string} characterName - The character name
 * @param {string} apiKey - The GW2 API key
 * @returns {Promise<Object>} Full character data including build_tabs and equipment_tabs
 */
export async function getCharacterDetails(characterName, apiKey) {
    // Adding ?v=latest forces the GW2 API to use the modern template format
    return await fetchWithAuth(`/characters/${encodeURIComponent(characterName)}?v=latest`, apiKey);
}

/**
 * Fetches trading post prices for multiple items.
 * @param {number[]} ids - Array of item IDs
 */
export async function getPrices(ids) {
    if (!ids || ids.length === 0) return [];

    // Chunk into 200 items (API limit)
    const chunks = [];
    for (let i = 0; i < ids.length; i += 200) {
        chunks.push(ids.slice(i, i + 200));
    }

    let allPrices = [];
    for (const chunk of chunks) {
        const joinedIds = chunk.join(',');
        try {
            const response = await fetch(`${BaseURL}/commerce/prices?ids=${joinedIds}`);
            if (response.ok) {
                const data = await response.json();
                allPrices = allPrices.concat(data);
            }
        } catch (error) {
            console.warn('Failed to fetch TP prices chunk:', error);
        }
    }
    return allPrices;
}

export default {
    fetchAPI,
    getProfessions,
    getProfession,
    getSpecializations,
    getTraits,
    getItems,
    getItemStats,
    getAllItemStats,
    getSkills,
    getProfessionSkills,
    getSkillsBySlot,
    getPets,
    getPetDetails,
    getLegendDetails,
    getProfessionWithPalette,
    getCharacters,
    getCharacterDetails,
    getPrices
};
