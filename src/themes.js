/**
 * themes.js — all content tables, carried over verbatim from the
 * "Emoji Merge v6" design canvas so the game matches the approved look.
 */

export const THEMES = {
  animals: {
    label: 'Animals',
    e: ['🐛', '🐌', '🐸', '🐣', '🐥', '🐰', '🐱', '🐶', '🐼', '🦄', '🌈'],
    n: ['Caterpillar', 'Snail', 'Frog', 'Chick', 'Chicken', 'Bunny', 'Kitty', 'Puppy', 'Panda', 'Unicorn', 'Rainbow'],
    d: [
      'Where every story starts.',
      'Slow, steady, a little sticky.',
      'Jumps when you least expect it.',
      'Just hatched and already curious.',
      'Grown up, still fluffy.',
      'Twice the hops, twice the ears.',
      'Sits in the box like she owns it.',
      'Good boy. Very good boy.',
      'Round enough to roll.',
      'Rare, sparkly, mildly judgmental.',
      'The whole box lights up. You did it!',
    ],
  },
  food: {
    label: 'Snacks',
    e: ['🫐', '🍒', '🍓', '🍋', '🍑', '🍎', '🥥', '🍍', '🍈', '🍉', '🎂'],
    n: ['Blueberry', 'Cherry', 'Strawberry', 'Lemon', 'Peach', 'Apple', 'Coconut', 'Pineapple', 'Melon', 'Watermelon', 'Cake'],
    d: [
      'Tiny and full of promise.',
      'Comes in pairs, merges in pairs.',
      'Sweet with a hint of seeds.',
      'Sour face guaranteed.',
      'Fuzzy and forgiving.',
      'One a day keeps the box happy.',
      'Hard outside, soft inside.',
      'Spiky hat, sunny heart.',
      'Cool, round and quietly proud.',
      'The classic. Big, juicy, iconic.',
      'Every merge was worth it. Eat up!',
    ],
  },
  space: {
    label: 'Space',
    e: ['✨', '⭐', '🌟', '☄️', '🌙', '🪐', '🌍', '☀️', '🌌', '🚀', '👽'],
    n: ['Sparkle', 'Star', 'Glow star', 'Comet', 'Moon', 'Planet', 'Earth', 'Sun', 'Galaxy', 'Rocket', 'Visitor'],
    d: [
      'A flicker in the dark.',
      'Wishes accepted.',
      'Brighter than average.',
      'Passing through, in a hurry.',
      'Keeps the tides in line.',
      'Rings included.',
      'Home sweet home.',
      'Do not stare directly.',
      'Billions of stars, one box.',
      'Leaving orbit. Hold on!',
      'It came all this way to see your box.',
    ],
  },
};

export const THEME_KEYS = Object.keys(THEMES);

/** Diameter of each tier as a percentage of the box interior width. */
export const SIZES = [7, 8.5, 10, 12, 14, 16.5, 19.5, 23, 27, 31.5, 37];

/** Points scored for creating a piece of each tier. */
export const PTS = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];

export const MAX_TIER = SIZES.length - 1;

/** Tiers that can appear as a droppable piece. */
export const DROPPABLE_TIERS = 4;

export const CONFETTI_COLORS = ['#ff7a59', '#ffe36e', '#8fd45f', '#6fc3f0', '#fff'];

/* Sky presets live in sky.js, which owns the blending between them. */

export const BOXES = {
  animals: {
    wallL: 'linear-gradient(90deg,#c98d4c,#e2ad6a)',
    wallR: 'linear-gradient(270deg,#c98d4c,#e2ad6a)',
    base: 'linear-gradient(#e2ad6a,#b87b3c)',
    rim: '#e8c890',
    edge: '#6b4a2b',
    inner: '#fff7e0',
  },
  food: {
    wallL: 'repeating-linear-gradient(0deg,#e8b56b 0 10px,#d29a4e 10px 20px)',
    wallR: 'repeating-linear-gradient(0deg,#e8b56b 0 10px,#d29a4e 10px 20px)',
    base: 'linear-gradient(#e8b56b,#b8823a)',
    rim: '#fff',
    edge: '#6b4a2b',
    inner: '#fff9ea',
    isFood: true,
  },
  space: {
    wallL: 'linear-gradient(90deg,#8a97ab,#c4cdd9)',
    wallR: 'linear-gradient(270deg,#8a97ab,#c4cdd9)',
    base: 'linear-gradient(#c4cdd9,#7d8a9d)',
    rim: '#dfe6ee',
    edge: '#3b4a5e',
    inner: '#eef4fb',
    isSpace: true,
  },
};

export const COLLECTION_BG = [
  '#ffd9d0', '#ffe9c2', '#fff5b8', '#dff5c2', '#c8f0e4',
  '#cfeefb', '#d6dcff', '#ead6ff', '#ffd6f0', '#ffdfe5', '#fff3c4',
];

export const FLYERS = { animals: '🐦', food: '🐝', space: '🛸' };

/** Placeholder weekly leaderboard used for the "#N this week" badge. */
export const LEADERBOARD = [5210, 4470, 3990, 2880, 1610];

export function themeOf(key) {
  return THEMES[key] ?? THEMES.animals;
}

export function boxOf(key) {
  return BOXES[key] ?? BOXES.animals;
}
