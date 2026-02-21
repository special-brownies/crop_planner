/**
 * Crop optimizer helpers.
 * These functions are pure and do not mutate planner state.
 */
export const LATE_GAME_CROPS = [
	"Ancient Fruit",
	"Sweet Gem Berry",
	"Cactus Fruit"
];

function toNumber(value){
	var parsed = Number(value);
	return isNaN(parsed) ? 0 : parsed;
}

/**
 * Profit-per-tile metric.
 * @param {{ netProfit?: number }} cropMetric
 * @returns {number}
 */
export function profitPerTile(cropMetric){
	if (!cropMetric) return 0;
	return toNumber(cropMetric.netProfit);
}

/**
 * Profit-per-day metric.
 * Uses existing computed profit/day value when provided.
 * @param {{ profitPerDayValue?: number, netProfit?: number, totalGrowthDays?: number, growthDays?: number }} cropMetric
 * @returns {number}
 */
export function profitPerDay(cropMetric){
	if (!cropMetric) return 0;
	var existing_value = toNumber(cropMetric.profitPerDayValue);
	if (existing_value) return existing_value;
	
	var growth_days = toNumber(cropMetric.totalGrowthDays || cropMetric.growthDays);
	if (growth_days <= 0) return 0;
	return toNumber(cropMetric.netProfit) / growth_days;
}

/**
 * Select best crop by profit per tile in O(n).
 * @param {Array<Object>} crops
 * @returns {Object|null}
 */
export function getBestCropByProfitPerTile(crops){
	if (!crops || !crops.length) return null;
	return crops.reduce(function(best, crop){
		if (!best) return crop;
		return profitPerTile(crop) > profitPerTile(best) ? crop : best;
	}, null);
}

/**
 * Select best crop by profit per day in O(n).
 * @param {Array<Object>} crops
 * @returns {Object|null}
 */
export function getBestCropByProfitPerDay(crops){
	if (!crops || !crops.length) return null;
	return crops.reduce(function(best, crop){
		if (!best) return crop;
		return profitPerDay(crop) > profitPerDay(best) ? crop : best;
	}, null);
}

/**
 * Build a greedy tile allocation plan using profit/day ranking.
 * @param {Array<Object>} crops
 * @param {number} tiles
 * @param {number} daysRemaining
 * @returns {{ allocations: Array<{ cropName: string, tilesAssigned: number, expectedProfit: number, profitPerDay: number }>, totalExpectedProfit: number, strategy: string }}
 */
export function generateOptimalPlan(crops, tiles, daysRemaining){
	// Step 1: sanitize scalar inputs.
	tiles = parseInt(tiles, 10);
	daysRemaining = parseInt(daysRemaining, 10);
	if (isNaN(tiles) || tiles < 1) tiles = 1;
	if (isNaN(daysRemaining) || daysRemaining < 1){
		return {
			allocations: [],
			totalExpectedProfit: 0,
			strategy: "greedy-profit-per-day"
		};
	}
	
	// Step 2: keep only feasible crops (can complete one harvest).
	var feasible_crops = (crops || []).filter(function(crop){
		return toNumber(crop && crop.growthDays) > 0
			&& toNumber(crop.growthDays) <= daysRemaining
			&& profitPerDay(crop) > 0;
	});
	if (!feasible_crops.length){
		return {
			allocations: [],
			totalExpectedProfit: 0,
			strategy: "greedy-profit-per-day"
		};
	}
	
	// Step 3: rank by profit/day in descending order.
	var ranked_crops = feasible_crops.slice().sort(function(a, b){
		return profitPerDay(b) - profitPerDay(a);
	});
	
	// Step 4: greedy allocation (fill remaining tiles with top ranked crop).
	var allocations = [];
	var remaining_tiles = tiles;
	var total_expected_profit = 0;
	for (var i = 0; i < ranked_crops.length && remaining_tiles > 0; i++){
		var crop = ranked_crops[i];
		var tiles_assigned = remaining_tiles;
		var expected_profit = profitPerTile(crop) * tiles_assigned;
		allocations.push({
			cropName: crop.name || "Unknown",
			tilesAssigned: tiles_assigned,
			expectedProfit: expected_profit,
			profitPerDay: profitPerDay(crop)
		});
		total_expected_profit += expected_profit;
		remaining_tiles -= tiles_assigned;
	}
	
	return {
		allocations: allocations,
		totalExpectedProfit: total_expected_profit,
		strategy: "greedy-profit-per-day"
	};
}
