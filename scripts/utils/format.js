import { round } from "./math.js";

/**
 * Formatting helpers used only for UI display text.
 */

/**
 * Format a numeric value with locale separators.
 * @param {number|string} value
 * @param {number} [decimals=0]
 * @returns {string}
 */
export function formatNumber(value, decimals){
	value = Number(value) || 0;
	decimals = decimals || 0;
	value = round(value, decimals);
	return value.toLocaleString(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits: decimals
	});
}

/**
 * Format a value with a unit suffix (default: gold "g").
 * @param {number|string} value
 * @param {number} [decimals=0]
 * @param {string} [suffix="g"]
 * @returns {string}
 */
export function formatCurrency(value, decimals, suffix){
	suffix = suffix || "g";
	return formatNumber(value, decimals || 0) + suffix;
}
