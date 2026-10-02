export const colorThemes = [
  { id: 'classic', name: 'Classic', description: 'Navy & warm gold' },
  { id: 'arcane', name: 'Arcane', description: 'Violet & moonlight' },
  { id: 'forest', name: 'Forest', description: 'Deep woodland greens' },
  { id: 'ocean', name: 'Ocean', description: 'Cool blues & sea glass' },
  { id: 'ember', name: 'Ember', description: 'Copper & fireside warmth' },
  { id: 'monochrome', name: 'Monochrome', description: 'Quiet charcoal & silver' },
] as const;

export const accentColors = [
  // Keep the original saved IDs so existing accent selections remain valid.
  { id: 'theme', name: 'Gold' },
  { id: 'gold', name: 'Red' },
  { id: 'violet', name: 'Violet' },
  { id: 'green', name: 'Green' },
  { id: 'blue', name: 'Blue' },
  { id: 'rose', name: 'Rose' },
  { id: 'teal', name: 'Teal' },
  { id: 'copper', name: 'Copper' },
] as const;

export const tableFinishes = [
  { id: 'glow', name: 'Astral silk', description: 'Champagne light on midnight satin', material: 'Silk' },
  {
    id: 'tabletop',
    name: 'Dragonfire',
    description: 'Golden flames and embers on smoldering crimson',
    material: 'Fire',
  },
  {
    id: 'celestial',
    name: 'Celestial atlas',
    description: 'Constellations and a gilded star chart',
    material: 'Arcane',
  },
  {
    id: 'verdant',
    name: 'Verdant sanctuary',
    description: 'Emerald light through a living canopy',
    material: 'Botanical',
  },
  {
    id: 'obsidian',
    name: 'Stormglass',
    description: 'Forked lightning across a midnight storm',
    material: 'Lightning',
  },
  {
    id: 'aurora',
    name: 'Prismatic veil',
    description: 'Opal ribbons of violet and sea glass',
    material: 'Opal',
  },
  {
    id: 'gilded',
    name: 'Gilded marble',
    description: 'Sculpted stone with fine gold veins',
    material: 'Stone',
  },
  {
    id: 'plain',
    name: 'Onyx minimal',
    description: 'A clean, finely brushed playing surface',
    material: 'Minimal',
  },
] as const;

export const defaultAppearance = {
  theme: 'system',
  colorTheme: 'classic',
  accentColor: 'theme',
  tableFinish: 'glow',
} as const;
