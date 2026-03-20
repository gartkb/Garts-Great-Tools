// Slot icon mapping for equipment display
// Item IDs from GW2 API for specific items

export const SLOT_ICON_MAP = {
    // Armor: Perfected Envoy Heavy Armor
    "Helm": 80384, // Perfected Envoy Helmet
    "Shoulders": 80145, // Perfected Envoy Shoulderpads
    "Coat": 80254, // Perfected Envoy Breastplate
    "Gloves": 80111, // Perfected Envoy Gloves
    "Leggings": 80252, // Perfected Envoy Leggings
    "Boots": 80281, // Perfected Envoy Boots

    // Trinkets
    "Backpack": 74155, // Ad Infinitum
    "Accessory1": 81908, // Aurora
    "Accessory2": 91048, // Vision
    "Amulet": 95380, // Prismatic Champion's Regalia
    "Ring1": 91234, // Coalescence
    "Ring2": 93105, // Conflux
};

// Weapon icon mapping - Zojja's weapons (ascended)
export const WEAPON_ICON_MAP = {
    "Axe": 46761, // Zojja's Artifact
    "Dagger": 46760, // Zojja's Razor
    "Mace": 46766, // Zojja's Flanged Mace
    "Pistol": 46767, // Zojja's Revolver
    "Sword": 46774, // Zojja's Blade
    "Scepter": 46769, // Zojja's Wand
    "Focus": 46761, // Zojja's Artifact (same as Axe icon - using for focus)
    "Shield": 46770, // Zojja's Bastion
    "Torch": 46775, // Zojja's Brazier
    "Warhorn": 46777, // Zojja's Herald
    "Greatsword": 46762, // Zojja's Claymore
    "Hammer": 46763, // Zojja's Warhammer
    "Longbow": 46765, // Zojja's Greatbow
    "Rifle": 46768, // Zojja's Musket
    "Shortbow": 46771, // Zojja's Short Bow
    "Staff": 46773, // Zojja's Spire
};

// Fallback weapon icons (generic weapon icons if specific not available)
export const GENERIC_WEAPON_ICONS = {
    "Axe": "https://render.guildwars2.com/file/4E1AFEF5B639C7CBC7C4B6F17F2A1C0F0C242B0D/61725.png",
    "Dagger": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61727.png",
    "Mace": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61728.png",
    "Pistol": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61729.png",
    "Sword": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61730.png",
    "Scepter": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61731.png",
    "Focus": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61732.png",
    "Shield": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61733.png",
    "Torch": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61734.png",
    "Warhorn": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61735.png",
    "Greatsword": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61736.png",
    "Hammer": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61737.png",
    "Longbow": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61738.png",
    "Rifle": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61739.png",
    "Shortbow": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61740.png",
    "Staff": "https://render.guildwars2.com/file/4BE60D3C0A3750A6B35A0C0C0F0C0A1C0F0C0A1C/61741.png",
};

// Helper function to get slot icon ID for a given slot
export function getSlotIconId(slotName) {
    return SLOT_ICON_MAP[slotName];
}

// Helper function to get weapon icon ID or fallback for a weapon type
export function getWeaponIcon(weaponType) {
    if (WEAPON_ICON_MAP[weaponType]) {
        return { type: 'specific', id: WEAPON_ICON_MAP[weaponType] };
    }
    if (GENERIC_WEAPON_ICONS[weaponType]) {
        return { type: 'generic', url: GENERIC_WEAPON_ICONS[weaponType] };
    }
    return null;
}