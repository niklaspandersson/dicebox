/**
 * Dice Utilities - Shared functions for rendering dice
 */

// Pip positions for a standard die (relative to 50x50 viewBox)
const PIP_POSITIONS = {
  topLeft: { cx: 14, cy: 14 },
  topRight: { cx: 36, cy: 14 },
  midLeft: { cx: 14, cy: 25 },
  center: { cx: 25, cy: 25 },
  midRight: { cx: 36, cy: 25 },
  bottomLeft: { cx: 14, cy: 36 },
  bottomRight: { cx: 36, cy: 36 },
};

// Which pips to show for each face value (1-6)
const PIP_CONFIGS = {
  1: ["center"],
  2: ["topRight", "bottomLeft"],
  3: ["topRight", "center", "bottomLeft"],
  4: ["topLeft", "topRight", "bottomLeft", "bottomRight"],
  5: ["topLeft", "topRight", "center", "bottomLeft", "bottomRight"],
  6: [
    "topLeft",
    "topRight",
    "midLeft",
    "midRight",
    "bottomLeft",
    "bottomRight",
  ],
};

/**
 * Generate SVG markup for a die face
 * @param {number} value - Die face value (1-6)
 * @param {string} pipColor - Color of the pips (default: '#0f172a')
 * @returns {string} SVG markup
 */
export function getDiceSvg(value, pipColor = "#0f172a") {
  const pips = PIP_CONFIGS[value]
    .map((pos) => {
      const p = PIP_POSITIONS[pos];
      return `<circle cx="${p.cx}" cy="${p.cy}" r="5" fill="${pipColor}"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">${pips}</svg>`;
}

/**
 * Get appropriate pip color based on dice background color
 * Light backgrounds get dark pips, dark backgrounds get light pips
 * @param {string} diceColor - Hex color of the die background
 * @returns {string} Hex color for the pips
 */
export function getPipColor(diceColor) {
  // White or very light colors get black pips, others get white
  if (diceColor === "#ffffff" || diceColor === "#eab308") {
    return "#0f172a";
  }
  return "#ffffff";
}

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color (e.g., '#ff0000')
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} RGBA color string
 */
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
