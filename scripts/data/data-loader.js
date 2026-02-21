import { DATA_VERSION, getSeedCost } from "../core/planner-core.js";

/**
 * Data loading and persistence helpers for planner config and local storage.
 */

/**
 * Convert external crop data to planner's normalized shape.
 * @param {Object} crop
 * @returns {Object}
 */
export function adaptPlannerCrop(crop){
	var seasons = [];
	(crop.seasons || []).forEach(function(season){
		seasons.push((season + "").toLowerCase());
	});
	var image_safe_id = ((crop.name || "") + "").toLowerCase().replace(/\s+/g, "_");
	var seed_cost = getSeedCost(crop);
	
	return {
		id: image_safe_id,
		name: crop.name,
		buy: seed_cost,
		seedPrice: seed_cost,
		seedCost: seed_cost,
		sell: crop.sellPrice,
		regrow: crop.regrowDays,
		regrowDays: crop.regrowDays,
		growthDays: crop.growthDays,
		stages: [crop.growthDays],
		seasons: seasons,
		harvest: {
			min: 1,
			max: 1,
			extra_chance: 0,
			level_increase: 0
		}
	};
}

/**
 * Adapt a list of raw crops into planner-ready crops.
 * @param {Object[]} crops
 * @returns {Object[]}
 */
export function adaptPlannerCrops(crops){
	var adapted = [];
	(crops || []).forEach(function(crop){
		adapted.push(adaptPlannerCrop(crop));
	});
	return adapted;
}

/**
 * Load planner config and external crop payload.
 * @returns {Promise<{config: Object, plannerData: Object}>}
 */
export async function loadData(){
	const [configResponse, plannerResponse] = await Promise.all([
		fetch("config.json"),
		fetch("data/planner-ready-data.json")
	]);
	
	if (!configResponse.ok || !plannerResponse.ok){
		throw new Error("Failed to load planner JSON data.");
	}
	
	const config = await configResponse.json();
	const plannerData = await plannerResponse.json();
	
	if (plannerData && plannerData.crops){
		config.crops = adaptPlannerCrops(plannerData.crops);
	}
	
	return { config, plannerData };
}

/**
 * Save JSON data with versioned key.
 * @param {string} key
 * @param {any} data
 * @param {string} [dataVersion]
 * @returns {void}
 */
export function SAVE_JSON(key, data, dataVersion){
	const json_data = JSON.stringify(data);
	const version = dataVersion || DATA_VERSION;
	localStorage.setItem(key + "_v" + version, json_data);
}

/**
 * Load JSON data with versioned key.
 * @param {string} key
 * @param {boolean} [raw_json]
 * @param {string} [dataVersion]
 * @returns {any}
 */
export function LOAD_JSON(key, raw_json, dataVersion){
	const version = dataVersion || DATA_VERSION;
	const json_data = localStorage.getItem(key + "_v" + version);
	if (!json_data) return;
	if (raw_json) return json_data;
	return JSON.parse(json_data);
}

/**
 * Save planner year plan payload to local storage.
 * @param {Object[]} years
 * @param {string} [dataVersion]
 * @returns {void}
 */
export function savePlans(years, dataVersion){
	const plan_data = [];
	(years || []).forEach(function(year){
		const year_data = year.get_data ? year.get_data() : year;
		plan_data.push(year_data);
	});
	SAVE_JSON("plans", plan_data, dataVersion || DATA_VERSION);
}

/**
 * Load planner year plan payload from local storage.
 * @param {string} [dataVersion]
 * @returns {Object[]|undefined}
 */
export function loadPlans(dataVersion){
	return LOAD_JSON("plans", false, dataVersion || DATA_VERSION);
}

/**
 * Save player config payload to local storage.
 * @param {Object} playerData
 * @param {string} [dataVersion]
 * @returns {void}
 */
export function savePlayer(playerData, dataVersion){
	SAVE_JSON("player", playerData, dataVersion || DATA_VERSION);
}

/**
 * Load player config payload from local storage.
 * @param {string} [dataVersion]
 * @returns {Object|undefined}
 */
export function loadPlayer(dataVersion){
	return LOAD_JSON("player", false, dataVersion || DATA_VERSION);
}
