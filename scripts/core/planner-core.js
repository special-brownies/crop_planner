import { round, clean_zero, clamp_farming_level } from "../utils/math.js";

/**
 * @typedef {Object} Crop
 * @property {string} id
 * @property {string} name
 * @property {number} growthDays
 * @property {number} seedPrice
 * @property {number} sellPrice
 * @property {number|null|undefined} regrowDays
 * @property {string[]} seasons
 */

/**
 * @typedef {Object} PlannerEvent
 * @property {number} day
 * @property {number} season
 * @property {string} name
 * @property {boolean} festival
 */

// Core constants and default player settings used by planner logic.
export const SEASON_DAYS = 28;
export const YEAR_DAYS = SEASON_DAYS * 4;
export const VERSION = "2.0";
export const DATA_VERSION = "2";

export const playerSettings = {
	profession: "none", // "none" | "agriculturist" | "tiller"
	farmingLevel: 0 // integer 0-10
};

const fertilizerEffects = {
	"basic fertilizer": {qualityBonus: 0.01},
	"quality fertilizer": {qualityBonus: 0.02},
	"deluxe fertilizer": {qualityBonus: 0.04},
	"speed-gro": {growthModifier: 0.9},
	"deluxe speed-gro": {growthModifier: 0.75},
	"hyper speed-gro": {growthModifier: 0.67},
	"basic retaining soil": {waterRetention: 0.33},
	"quality retaining soil": {waterRetention: 0.66},
	"deluxe retaining soil": {waterRetention: 1.0}
};

const fertilizerCosts = {
	"basic fertilizer": 100,
	"quality fertilizer": 150,
	"speed-gro": 100,
	"deluxe speed-gro": 150,
	"basic retaining soil": 100,
	"quality retaining soil": 150
};

const fertilizerIdToEffectKey = {
	basic_fertilizer: "basic fertilizer",
	quality_fertilizer: "quality fertilizer",
	deluxe_fertilizer: "deluxe fertilizer",
	speed_gro: "speed-gro",
	delux_speed_gro: "deluxe speed-gro",
	deluxe_speed_gro: "deluxe speed-gro",
	hyper_speed_gro: "hyper speed-gro",
	basic_retaining_soil: "basic retaining soil",
	quality_retaining_soil: "quality retaining soil",
	deluxe_retaining_soil: "deluxe retaining soil"
};

export const fertilizerImageAliases = {
	deluxe_speed_gro: "delux_speed_gro"
};

export function normalize_fertilizer_effect_name(name){
	return ((name || "") + "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function normalize_fertilizer_image_name(name){
	return ((name || "") + "").toLowerCase().trim().replace(/[\s-]+/g, "_");
}

export function is_dev_mode(){
	return typeof window != "undefined"
		&& window.location
		&& window.location.hash == "#dev";
}

export function dev_log(){
	if (!is_dev_mode() || !window.console || !console.log) return;
	console.log.apply(console, arguments);
}

export { clamp_farming_level, round, clean_zero };

export function get_fertilizer_effect_key(fertilizer){
	if (!fertilizer) return "";
	
	var fertilizer_id = "";
	var fertilizer_name = "";
	if (typeof fertilizer == "string"){
		fertilizer_id = ((fertilizer || "") + "").toLowerCase().trim();
		fertilizer_name = normalize_fertilizer_effect_name(fertilizer);
	} else {
		fertilizer_id = ((fertilizer.id || "") + "").toLowerCase().trim();
		fertilizer_name = normalize_fertilizer_effect_name(fertilizer.name || fertilizer_id);
	}
	
	if (fertilizer_id && fertilizerIdToEffectKey[fertilizer_id]){
		return fertilizerIdToEffectKey[fertilizer_id];
	}
	if (fertilizer_name && fertilizerEffects[fertilizer_name]){
		return fertilizer_name;
	}
	
	var from_id = normalize_fertilizer_effect_name(fertilizer_id.replace(/_/g, " "));
	if (from_id && fertilizerEffects[from_id]){
		return from_id;
	}
	return "";
}

export function get_fertilizer_effect(fertilizer){
	var effect_key = get_fertilizer_effect_key(fertilizer);
	if (!effect_key || !fertilizerEffects[effect_key]) return {};
	return fertilizerEffects[effect_key];
}

export function getSeedCost(crop){
	if (!crop) return 0;
	return Number(crop.seedPrice) || 0;
}

export function get_seed_cost(crop){
	return getSeedCost(crop);
}

export function get_fertilizer_cost(currentFertilizer){
	var fertilizer_name = "";
	if (currentFertilizer && currentFertilizer.name){
		fertilizer_name = normalize_fertilizer_effect_name(currentFertilizer.name);
	}
	if (fertilizer_name && typeof fertilizerCosts[fertilizer_name] != "undefined"){
		return fertilizerCosts[fertilizer_name] || 0;
	}
	
	// Saved plans may only have id-based fertilizer references.
	var effect_key = get_fertilizer_effect_key(currentFertilizer);
	if (effect_key && typeof fertilizerCosts[effect_key] != "undefined"){
		return fertilizerCosts[effect_key] || 0;
	}
	return 0;
}

export function get_total_planting_cost(crop, currentFertilizer, amount){
	amount = parseInt(amount, 10);
	if (isNaN(amount) || amount < 1) amount = 1;
	
	var per_seed_cost = 0;
	if (crop && typeof crop.seedCost == "number" && !isNaN(crop.seedCost)){
		per_seed_cost = crop.seedCost;
	} else {
		per_seed_cost = get_seed_cost(crop);
	}
	var seed_cost = per_seed_cost * amount;
	var fertilizer_cost = get_fertilizer_cost(currentFertilizer) * amount;
	var total_cost = seed_cost + fertilizer_cost;
	var display_cost = total_cost === 0 ? 0 : total_cost;
	
	return {
		seedCost: seed_cost,
		fertilizerCost: fertilizer_cost,
		totalCost: total_cost,
		displayCost: display_cost
	};
}

export function get_crop_base_growth_days(crop){
	if (!crop) return 1;
	
	var base_growth = parseInt(crop.base_grow || crop.grow || crop.growthDays, 10);
	if (isNaN(base_growth) || base_growth < 1){
		base_growth = 0;
		if (crop.stages && crop.stages.length){
			for (var i = 0; i < crop.stages.length; i++){
				base_growth += parseInt(crop.stages[i] || 0, 10);
			}
		}
	}
	if (isNaN(base_growth) || base_growth < 1) base_growth = 1;
	return base_growth;
}

export function get_crop_regrow_days(crop){
	var regrow_days = crop && (crop.regrowDays || crop.regrow);
	regrow_days = parseInt(regrow_days, 10);
	if (isNaN(regrow_days)) regrow_days = -1;
	return regrow_days;
}

export function get_growth_days_with_modifiers(crop, currentFertilizer, profession){
	var fert = get_fertilizer_effect(currentFertilizer);
	var base_growth = get_crop_base_growth_days(crop);
	var growth_modifier = fert.growthModifier || 1;
	
	if ((profession || playerSettings.profession) == "agriculturist"){
		growth_modifier *= 0.9;
	}
	
	return Math.max(1, Math.floor(base_growth * growth_modifier));
}

export function get_quality_distribution(level, quality_bonus){
	level = clamp_farming_level(level);
	quality_bonus = parseFloat(quality_bonus || 0);
	if (isNaN(quality_bonus)) quality_bonus = 0;
	
	var gold_chance = Math.min(0.75, (level * 0.01) + quality_bonus);
	var silver_chance = Math.min(0.75, gold_chance * 2);
	var normal_chance = Math.max(0, 1 - (gold_chance + silver_chance));
	
	return {
		normal: normal_chance,
		silver: silver_chance,
		gold: gold_chance
	};
}

export function get_average_sell_price(sellPrice, level, fertilizer){
	var fert = get_fertilizer_effect(fertilizer);
	var distribution = get_quality_distribution(level, fert.qualityBonus || 0);
	
	return (sellPrice * distribution.normal)
		+ (sellPrice * 1.25 * distribution.silver)
		+ (sellPrice * 1.5 * distribution.gold);
}

export function calculateGrowthDays(crop, currentFertilizer, profession){
	return get_growth_days_with_modifiers(crop, currentFertilizer, profession);
}

export function calculateHarvestDate(plantDay, crop, currentFertilizer, profession){
	plantDay = parseInt(plantDay, 10);
	if (isNaN(plantDay) || plantDay < 1) plantDay = 1;
	return plantDay + calculateGrowthDays(crop, currentFertilizer, profession);
}

export function getTotalPlantingCost(crop, currentFertilizer, amount){
	return get_total_planting_cost(crop, currentFertilizer, amount);
}

export function getCropLifecycle(crop, plantDay, maxDay, currentFertilizer, profession){
	if (!crop || !plantDay) return [];
	
	var growthDays = get_growth_days_with_modifiers(crop, currentFertilizer, profession || playerSettings.profession);
	var regrowDays = get_crop_regrow_days(crop);
	var limitDay = typeof maxDay == "number" ? maxDay : plantDay + SEASON_DAYS - 1;
	
	var lifecycle = [];
	var harvestDay = plantDay + growthDays;
	if (harvestDay > limitDay) return lifecycle;
	
	lifecycle.push({
		day: harvestDay,
		type: "harvest",
		crop: crop
	});
	
	if (regrowDays > 0){
		var nextDay = harvestDay + regrowDays;
		while (nextDay <= limitDay){
			lifecycle.push({
				day: nextDay,
				type: "harvest",
				crop: crop
			});
			nextDay += regrowDays;
		}
	}
	
	return lifecycle;
}

export function calculateMultiSeasonProfit(crop, plantDay, seasonCount, options){
	options = options || {};
	if (!crop) return 0;
	
	plantDay = parseInt(plantDay, 10);
	if (isNaN(plantDay) || plantDay < 1) plantDay = 1;
	
	seasonCount = parseInt(seasonCount, 10);
	if (isNaN(seasonCount) || seasonCount < 1) seasonCount = 1;
	
	var totalDays = seasonCount * SEASON_DAYS;
	var limitDay = plantDay + totalDays - 1;
	var regrowDays = get_crop_regrow_days(crop);
	
	var plantingMultiplier = parseInt(options.plantingMultiplier, 10);
	if (isNaN(plantingMultiplier) || plantingMultiplier < 1) plantingMultiplier = 1;
	
	var harvestYield = parseFloat(options.harvestYield);
	if (isNaN(harvestYield) || harvestYield <= 0){
		harvestYield = (crop.harvest && crop.harvest.min) ? crop.harvest.min : 1;
	}
	
	var avgSellPrice = options.avgSellPrice;
	if (typeof avgSellPrice != "number"){
		avgSellPrice = get_average_sell_price(crop.sell || 0, clamp_farming_level(options.farmingLevel || 0), options.fertilizer);
	}
	
	var harvestValue = avgSellPrice * harvestYield * plantingMultiplier;
	var plantingCost = get_total_planting_cost(crop, options.fertilizer, plantingMultiplier).totalCost;
	
	var totalProfit = 0;
	var currentPlantDay = plantDay;
	while (currentPlantDay <= limitDay){
		var lifecycle = getCropLifecycle(crop, currentPlantDay, limitDay, options.fertilizer, options.profession);
		if (!lifecycle.length) break;
		
		totalProfit -= plantingCost;
		for (var i = 0; i < lifecycle.length; i++){
			var event = lifecycle[i];
			if (event.type == "harvest" && event.day <= limitDay){
				totalProfit += harvestValue;
			}
		}
		
		// Regrowing crops only pay seed cost once.
		if (regrowDays > 0) break;
		currentPlantDay = lifecycle[0].day;
	}
	
	return totalProfit;
}

export function calculateProfit(crop, settings){
	settings = settings || {};
	var profession = settings.profession || playerSettings.profession || "none";
	var farming_level = clamp_farming_level(
		(typeof settings.farmingLevel != "undefined") ? settings.farmingLevel : playerSettings.farmingLevel
	);
	var use_fixed_budget = settings.useFixedBudget ? true : false;
	var fertilizer = settings.fertilizer || null;
	var season_count = parseInt(settings.seasonCount, 10);
	if (isNaN(season_count) || season_count < 1){
		season_count = Math.max(1, (crop.seasons || []).length || 1);
	}
	
	var base_sell = crop.base_sell || crop.sell || 0;
	var sell_price = base_sell;
	if (profession == "tiller"){
		sell_price *= 1.1;
	}
	sell_price = round(sell_price, 2);
	
	var growth_days = get_growth_days_with_modifiers(crop, fertilizer, profession);
	var avg_sell_price = get_average_sell_price(sell_price, farming_level, fertilizer);
	
	var planting_multiplier = 1;
	var seed_cost = get_seed_cost(crop);
	if (use_fixed_budget){
		planting_multiplier = seed_cost > 0 ? Math.floor(1000 / seed_cost) : 1;
		planting_multiplier = Math.max(1, planting_multiplier);
	}
	
	var total_days = season_count * SEASON_DAYS;
	var total_season_profit = calculateMultiSeasonProfit(crop, 1, season_count, {
		fertilizer: fertilizer,
		avgSellPrice: avg_sell_price,
		harvestYield: crop.harvest.min || 1,
		plantingMultiplier: planting_multiplier,
		profession: profession,
		farmingLevel: farming_level
	});
	var profit_per_day = round(total_season_profit / total_days, 1);
	
	return {
		sellPrice: sell_price,
		growthDays: growth_days,
		avgSellPrice: avg_sell_price,
		seasonCount: season_count,
		totalDays: total_days,
		totalSeasonProfit: total_season_profit,
		profitPerDay: profit_per_day
	};
}
