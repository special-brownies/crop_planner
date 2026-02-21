/**
 * Numeric helpers shared by planner core and UI modules.
 */

/**
 * Round a number to a fixed number of decimals.
 * @param {number} num
 * @param {number} [decimals=0]
 * @returns {number}
 */
export function round(num, decimals){
	decimals = Math.pow(10, decimals || 0);
	return Math.round(num * decimals) / decimals;
}

/**
 * Normalize -0 and tiny floating point noise to 0.
 * @param {number} value
 * @returns {number}
 */
export function clean_zero(value){
	if (value === 0 || Math.abs(value) < 1e-9) return 0;
	return value;
}

/**
 * Clamp farming level to valid Stardew range [0..10].
 * @param {number|string} level
 * @returns {number}
 */
export function clamp_farming_level(level){
	level = parseInt(level, 10);
	if (isNaN(level)) level = 0;
	return Math.max(0, Math.min(10, level));
}
