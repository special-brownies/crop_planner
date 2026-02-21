import {
	SEASON_DAYS,
	YEAR_DAYS,
	VERSION,
	DATA_VERSION,
	playerSettings,
	fertilizerImageAliases,
	normalize_fertilizer_effect_name,
	normalize_fertilizer_image_name,
	is_dev_mode,
	dev_log,
	clamp_farming_level,
	get_fertilizer_effect_key,
	get_fertilizer_effect,
	getSeedCost,
	get_seed_cost,
	get_fertilizer_cost,
	get_total_planting_cost,
	get_crop_base_growth_days,
	get_crop_regrow_days,
	get_growth_days_with_modifiers,
	get_quality_distribution,
	get_average_sell_price
} from "../core/planner-core.js";
import {
	loadData as defaultDataLoader,
	adaptPlannerCrop,
	adaptPlannerCrops,
	SAVE_JSON,
	LOAD_JSON
} from "../data/data-loader.js";
import { createPlannerState } from "../core/planner-state.js";
import { round, clean_zero } from "../utils/math.js";
import { formatNumber } from "../utils/format.js";

const $ = window.jQuery || window.$;
let dataLoaderFn = defaultDataLoader;
let plannerModuleRegistered = false;

/**
 * Register AngularJS module/controller for the planner app.
 * @param {{ angularRef?: any, $?: any, loadData?: Function }} [options]
 * @returns {void}
 */
export function initPlannerApp(options = {}){
	if (typeof options.loadData == "function"){
		dataLoaderFn = options.loadData;
	}
	
	const angularRef = options.angularRef || window.angular;
	if (!angularRef){
		throw new Error("AngularJS was not found on window.");
	}
	
	if (plannerModuleRegistered) return;
	angularRef.module("planner_app", ["checklist-model"])
		.controller("planner_controller", planner_controller);
	plannerModuleRegistered = true;
}
function planner_controller($scope){
	
	/********************************
		PLANNER VARIABLES
	********************************/
	var self = this;
	const planner = self; // Preserve legacy free `planner` references in strict ES modules.
	window.planner = planner;
	
	// Centralized planner state with explicit getters/setters.
	const plannerState = createPlannerState({
		years: [],
		cropsList: [],
		cropsById: {},
		eventsByDate: {},
		playerSettings: playerSettings,
		currentMode: "farm",
		currentSeasonIndex: 0,
		currentYearIndex: 0
	});
	self.state = plannerState;
	
	// Core data & objects
	self.config = {};
	self.loaded = false;
	self.sidebar;
	self.player;
	self.planner_modal;
	
	// Static planner data
	self.days = new Array(YEAR_DAYS);	// Array of days in a year (only used by one ng-repeat)
	self.seasons = [];					// Array of seasons
	self.SEASON_DAYS = SEASON_DAYS;		// Exposing SEASON_DAYS constant to app scope
	self.crops_list = plannerState.get("cropsList"); // [id, id, ...]
	self.crops = plannerState.get("cropsById"); // {id: {data}}
	self.fertilizer = {}; 				// [fertilizer, fertilizer, ...]
	self.events = plannerState.get("eventsByDate"); // Birthdays & festivals
	
	// State objects & variables
	self.years = plannerState.get("years");
	
	self.cdate;							// Current date to add plan to
	self.cseason;						// Current season
	self.cmode = plannerState.get("currentMode"); // Current farm mode (farm / greenhouse)
	self.cyear;							// Current year
	
	self.newplan;
	self.editplan;
	
	// Undo/redo history stack state
	const historyStack = [];
	const redoStack = [];
	
	// Core planner functions
	self.update = update;
	self.add_plan = add_plan;
	self.add_plan_key = add_plan_key;
	self.edit_plan = edit_plan;
	self.remove_plan = remove_plan;
	self.clear_season = clear_season;
	self.clear_year = clear_year;
	self.clear_all = clear_all;
	self.open_plans = open_plans;
	
	self.inc_year = inc_year;			// Increment/decrement current year
	self.inc_season = inc_season;		// Increment/decrement current season
	self.set_season = set_season;		// Set current season
	self.cfarm = cfarm;					// Get current farm
	self.in_greenhouse = in_greenhouse; // Check if current farm mode == greenhouse
	self.toggle_mode = toggle_mode;		// Toggle current farm mode (farm / greenhouse)
	self.set_mode = set_mode;			// Set current farm mode (farm / greenhouse)
	
	self.get_season = get_season;		// Get season object by id
	self.get_date = get_date;			// Get formatted date string
	self.ci_set_sort = ci_set_sort;		// Set key to sort crop info by
	self.apply_sort = apply_sort;
	self.planner_valid_crops = planner_valid_crops;
	self.get_visible_crops = get_visible_crops;
	self.is_best_crop = is_best_crop;
	self.set_profession = set_profession;
	self.calculateMultiSeasonProfit = calculateMultiSeasonProfit;
	
	// Dashboard, tooltip, and history actions exposed to templates
	self.undo = undo;
	self.redo = redo;
	self.can_undo = can_undo;
	self.can_redo = can_redo;
	self.show_crop_tooltip = show_crop_tooltip;
	self.move_crop_tooltip = move_crop_tooltip;
	self.hide_crop_tooltip = hide_crop_tooltip;
	
	// Crop info search/filter settings
	self.cinfo_settings = {
		season: "spring",
		seasons: ["spring"],
		season_options: [],
		sort: "profitPerDay",
		search: "",
		regrows: false,
		order: true,
		use_fbp: false,
		season_filter: "all",
	};
	
	let cropsData = [];
	self.best_crop_id = null;
	self.playerSettings = plannerState.get("playerSettings");
	
	$scope.$watch(function(){
		return self.player ? self.player.level : null;
	}, function(new_level){
		if (!self.player) return;
		
		var farming_level = clamp_farming_level(new_level);
		var level_changed = self.playerSettings.farmingLevel !== farming_level;
		if (self.player.level !== farming_level){
			self.player.level = farming_level;
		}
		self.playerSettings.farmingLevel = farming_level;
		
		if (!level_changed) return;
		refresh_crop_metrics();
		if (self.years.length){
			update(self.years[0].data.farm, true);
			update(self.years[0].data.greenhouse, true);
		}
		self.player.save();
	});
	
	
	/********************************
		UI HELPERS
	********************************/
	// Dashboard helper: return a stable element reference by id.
	function get_profit_dashboard_element(){
		return document.getElementById("profit-dashboard");
	}
	
	// Dashboard helper: format numbers without changing planner math.
	function format_dashboard_value(value, decimals){
		value = Number(value) || 0;
		value = round(value, decimals || 0);
		return formatNumber(value, decimals || 0);
	}
	
	// Dashboard helper: read current season totals already computed by update().
	function getProfitDashboardSummary(){
		var summary = {
			investment: 0,
			revenue: 0,
			net: 0,
			perTile: 0,
			roi: 0
		};
		
		var farm = self.cfarm();
		var season = self.cseason;
		if (!farm || !season || !farm.plans || !farm.harvests || !farm.totals || !farm.totals.season){
			return summary;
		}
		
		for (var date = season.start; date <= season.end; date++){
			var plans = farm.plans[date] || [];
			for (var i = 0; i < plans.length; i++){
				var plan = plans[i];
				if (typeof plan.totalCost == "number" && !isNaN(plan.totalCost)){
					summary.investment += plan.totalCost;
				} else if (plan && plan.get_cost_breakdown){
					summary.investment += plan.get_cost_breakdown().totalCost;
				}
			}
			
			var harvests = farm.harvests[date] || [];
			for (var ii = 0; ii < harvests.length; ii++){
				var harvest = harvests[ii];
				summary.revenue += Number(harvest.revenue && harvest.revenue.min) || 0;
			}
		}
		
		var season_totals = farm.totals.season[season.index];
		if (!season_totals) return summary;
		var net = Number(season_totals.profit && season_totals.profit.min) || 0;
		var plantings = Number(season_totals.plantings) || 0;
		summary.net = clean_zero(net);
		summary.perTile = plantings > 0 ? clean_zero(round(net / plantings, 1)) : 0;
		summary.roi = summary.investment > 0 ? clean_zero(round((net / summary.investment) * 100, 1)) : 0;
		return summary;
	}
	
	// Dashboard helper: render summary cards in one place.
	function updateProfitDashboard(summary){
		var dashboard = get_profit_dashboard_element();
		if (!dashboard) return;
		
		summary = summary || getProfitDashboardSummary();
		dashboard.innerHTML = ""
			+ "<div class='profit-card'>Investment: " + format_dashboard_value(summary.investment, 0) + "g</div>"
			+ "<div class='profit-card'>Revenue: " + format_dashboard_value(summary.revenue, 0) + "g</div>"
			+ "<div class='profit-card'>Net Profit: " + format_dashboard_value(summary.net, 0) + "g</div>"
			+ "<div class='profit-card'>Profit/Tile: " + format_dashboard_value(summary.perTile, 1) + "g</div>"
			+ "<div class='profit-card'>ROI: " + format_dashboard_value(summary.roi, 1) + "%</div>";
	}
	
	// Dashboard helper: recompute current view and rerender.
	function refreshProfitDashboard(){
		updateProfitDashboard(getProfitDashboardSummary());
	}
	
	// Tooltip helper: return reusable tooltip element.
	function get_tooltip_element(){
		return document.getElementById("tooltip");
	}
	
	// Tooltip helper: show crop details when a row is hovered.
	function show_crop_tooltip(event, crop){
		var tooltip = get_tooltip_element();
		if (!tooltip || !crop) return;
		
		var regrow_days = parseInt(crop.regrowDays || crop.regrow, 10);
		var regrow_display = (isNaN(regrow_days) || regrow_days <= 0) ? "None" : regrow_days + " days";
		var harvest_count = (crop.harvest && crop.harvest.min) ? crop.harvest.min : 1;
		var profit_per_harvest = clean_zero(round(((Number(crop.sellPrice) || 0) * harvest_count) - (Number(crop.buy) || 0), 1));
		
		tooltip.innerHTML = ""
			+ "<strong>" + crop.name + "</strong><br>"
			+ "Growth: " + (Number(crop.growthDays) || 0) + " days<br>"
			+ "Regrow: " + regrow_display + "<br>"
			+ "Seed: " + format_dashboard_value(crop.buy, 0) + "g<br>"
			+ "Sell: " + format_dashboard_value(crop.sellPrice, 1) + "g<br>"
			+ "Profit/Harvest: " + format_dashboard_value(profit_per_harvest, 1) + "g";
		tooltip.classList.remove("hidden");
		move_crop_tooltip(event);
	}
	
	// Tooltip helper: move tooltip near cursor while staying in viewport.
	function move_crop_tooltip(event){
		var tooltip = get_tooltip_element();
		if (!tooltip || tooltip.classList.contains("hidden") || !event) return;
		
		var cursor_x = event.pageX;
		var cursor_y = event.pageY;
		if (typeof cursor_x != "number" || typeof cursor_y != "number"){
			cursor_x = (event.clientX || 0) + window.pageXOffset;
			cursor_y = (event.clientY || 0) + window.pageYOffset;
		}
		
		var offset = 14;
		var left = cursor_x + offset;
		var top = cursor_y + offset;
		var max_left = window.pageXOffset + window.innerWidth - tooltip.offsetWidth - 10;
		var max_top = window.pageYOffset + window.innerHeight - tooltip.offsetHeight - 10;
		left = Math.max(window.pageXOffset + 10, Math.min(left, max_left));
		top = Math.max(window.pageYOffset + 10, Math.min(top, max_top));
		
		tooltip.style.left = left + "px";
		tooltip.style.top = top + "px";
	}
	
	// Tooltip helper: hide tooltip when cursor leaves crop row.
	function hide_crop_tooltip(){
		var tooltip = get_tooltip_element();
		if (!tooltip) return;
		tooltip.classList.add("hidden");
		tooltip.style.left = "";
		tooltip.style.top = "";
	}
	
	// History helper: check if undo action is available.
	function can_undo(){
		return historyStack.length > 0;
	}
	
	// History helper: check if redo action is available.
	function can_redo(){
		return redoStack.length > 0;
	}
	
	// History helper: reset undo/redo stacks for non-history mutations.
	function clear_history(){
		historyStack.length = 0;
		redoStack.length = 0;
	}
	
	// History helper: serialize planner plans and navigation state only.
	function serializePlannerState(){
		var serialized_years = [];
		$.each(self.years, function(i, year){
			serialized_years.push(year.get_data() || {});
		});
		if (!serialized_years.length){
			serialized_years.push({});
		}
		
		return JSON.stringify({
			years: serialized_years,
			cmode: self.cmode,
			cyearIndex: self.cyear ? self.cyear.index : 0,
			cseasonIndex: self.cseason ? self.cseason.index : 0
		});
	}
	
	// History helper: restore planner state from a serialized snapshot.
	function restorePlannerState(serialized_state){
		if (!serialized_state) return false;
		var state;
		try {
			state = typeof serialized_state == "string" ? JSON.parse(serialized_state) : serialized_state;
		} catch(e){
			return false;
		}
		
		var year_states = (state.years && state.years.length) ? state.years : [{}];
		plannerState.set("years", []);
		self.years = plannerState.get("years");
		$.each(year_states, function(i, year_data){
			var restored_year = new Year(i);
			restored_year.set_data(year_data || {});
			self.years.push(restored_year);
		});
		if (!self.years.length){
			plannerState.set("years", [new Year(0)]);
			self.years = plannerState.get("years");
		}
		
		self.cmode = state.cmode == "greenhouse" ? "greenhouse" : "farm";
		plannerState.set("currentMode", self.cmode);
		var cyear_index = parseInt(state.cyearIndex, 10);
		if (isNaN(cyear_index)) cyear_index = 0;
		cyear_index = Math.max(0, Math.min(cyear_index, self.years.length - 1));
		self.cyear = self.years[cyear_index];
		plannerState.set("currentYearIndex", cyear_index);
		
		var cseason_index = parseInt(state.cseasonIndex, 10);
		if (isNaN(cseason_index)) cseason_index = 0;
		cseason_index = Math.max(0, Math.min(cseason_index, self.seasons.length - 1));
		self.cseason = self.seasons[cseason_index];
		plannerState.set("currentSeasonIndex", cseason_index);
		
		self.newplan = new Plan;
		self.editplan = null;
		save_data();
		update(self.years[0].data.farm, true);
		update(self.years[0].data.greenhouse, true);
		refreshProfitDashboard();
		hide_crop_tooltip();
		return true;
	}
	
	// History helper: wrap only supported mutations with snapshot history.
	function runWithHistory(action_fn){
		var before_state = serializePlannerState();
		var result = action_fn ? action_fn() : undefined;
		var after_state = serializePlannerState();
		if (before_state != after_state){
			historyStack.push(before_state);
			redoStack.length = 0;
		}
		return result;
	}
	
	// History action: restore previous snapshot and stage current snapshot for redo.
	function undo(){
		if (!historyStack.length) return;
		var current_state = serializePlannerState();
		var previous_state = historyStack.pop();
		if (restorePlannerState(previous_state)){
			redoStack.push(current_state);
		}
	}
	
	// History action: restore next snapshot and stage current snapshot for undo.
	function redo(){
		if (!redoStack.length) return;
		var current_state = serializePlannerState();
		var next_state = redoStack.pop();
		if (restorePlannerState(next_state)){
			historyStack.push(current_state);
		}
	}
	
	
	/********************************
		PLANNER INITIALIZATION
	********************************/
	function adapt_planner_crop(crop){
		return adaptPlannerCrop(crop);
	}
	
	function adapt_planner_crops(crops){
		return adaptPlannerCrops(crops);
	}
	
	function get_profession(){
		return self.playerSettings.profession || "none";
	}
	
	function get_farming_level(){
		return clamp_farming_level(self.playerSettings.farmingLevel);
	}
	
	function apply_profession_to_player(){
		var profession = get_profession();
		self.player.profession = profession;
		self.player.tiller = (profession == "tiller" || profession == "agriculturist");
		self.player.agriculturist = (profession == "agriculturist");
	}
	
	function apply_farming_level_to_player(){
		self.player.level = get_farming_level();
	}
	
	function sync_profession_from_player(){
		var valid_professions = {none: true, tiller: true, agriculturist: true};
		var profession = valid_professions[self.player.profession] ? self.player.profession : "none";
		if (profession == "none"){
			if (self.player.agriculturist){
				profession = "agriculturist";
			} else if (self.player.tiller){
				profession = "tiller";
			}
		}
		self.playerSettings.profession = profession;
		self.playerSettings.farmingLevel = clamp_farming_level(self.player.level);
		self.player.level = self.playerSettings.farmingLevel;
		self.player.profession = profession;
	}
	
	function set_profession(profession){
		var valid_professions = {none: true, tiller: true, agriculturist: true};
		if (!valid_professions[profession]) profession = "none";
		
		self.playerSettings.profession = profession;
		apply_profession_to_player();
		apply_farming_level_to_player();
		refresh_crop_metrics();
		self.player.save();
		if (self.years.length){
			update(self.years[0].data.farm, true);
			update(self.years[0].data.greenhouse, true);
		}
	}
	
	function calculateProfit(crop, settings){
		settings = settings || {};
		var profession = settings.profession || get_profession();
		var farming_level = (typeof settings.farmingLevel != "undefined") ? settings.farmingLevel : get_farming_level();
		farming_level = clamp_farming_level(farming_level);
		var use_fixed_budget = settings.useFixedBudget ? true : false;
		var fertilizer = settings.fertilizer || self.fertilizer.none;
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
			profession: profession
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
	
	function refresh_crop_metrics(){
		var settings = {
			profession: get_profession(),
			farmingLevel: get_farming_level()
		};
		$.each(self.crops_list, function(i, crop){
			var season_count = Math.max(1, (crop.seasons || []).length || 1);
			var profit_data = calculateProfit(crop, {
				profession: settings.profession,
				farmingLevel: settings.farmingLevel,
				seasonCount: season_count
			});
			var fixed_profit_data = calculateProfit(crop, {
				profession: settings.profession,
				farmingLevel: settings.farmingLevel,
				seasonCount: season_count,
				useFixedBudget: true
			});
			crop.sellPrice = profit_data.sellPrice;
			crop.growthDays = profit_data.growthDays;
			crop.profitPerDay = profit_data.profitPerDay;
			crop.profit = profit_data.profitPerDay;
			crop.fixed_profit = fixed_profit_data.profitPerDay;
		});
	}
	
	function get_crop_sort_value(crop, sort_key){
		switch(sort_key){
			case "growthDays":
			case "grow":
				return crop.growthDays;
			case "sellPrice":
			case "sell":
				return crop.sellPrice;
			case "profitPerDay":
			case "profit":
			case "fixed_profit":
				return self.cinfo_settings.use_fbp ? crop.fixed_profit : crop.profitPerDay;
			case "buy":
				return crop.buy;
			case "name":
			default:
				return crop.name;
		}
	}
	
	function get_visible_crops(){
		var search = (self.cinfo_settings.search || "").toLowerCase();
		var season_filter = self.cinfo_settings.season_filter || "all";
		var seasons = self.cinfo_settings.seasons || [];
		var rows = [];
		
		$.each(self.crops_list, function(i, crop){
			if (search && crop.name.toLowerCase().indexOf(search) == -1) return;
			if (self.cinfo_settings.regrows && !(crop.regrow > 0)) return;
			
			var in_season = false;
			if (season_filter != "all"){
				in_season = crop.seasons.indexOf(season_filter) != -1;
			} else if (seasons.length){
				$.each(seasons, function(ii, season){
					if (crop.seasons.indexOf(season) != -1){
						in_season = true;
						return false;
					}
				});
			} else {
				in_season = true;
			}
			
			if (!in_season) return;
			rows.push(crop);
		});
		
		var sort_key = self.cinfo_settings.sort || "profitPerDay";
		rows.sort(function(a, b){
			var va = get_crop_sort_value(a, sort_key);
			var vb = get_crop_sort_value(b, sort_key);
			if (typeof va == "string" || typeof vb == "string"){
				va = (va || "").toString().toLowerCase();
				vb = (vb || "").toString().toLowerCase();
				return va.localeCompare(vb);
			}
			return va - vb;
		});
		if (self.cinfo_settings.order) rows.reverse();
		
		var best_crop = null;
		$.each(rows, function(i, crop){
			if (!best_crop || crop.profitPerDay > best_crop.profitPerDay){
				best_crop = crop;
			}
		});
		self.best_crop_id = best_crop ? best_crop.id : null;
		
		return rows;
	}
	
	function is_best_crop(crop){
		return crop && crop.id == self.best_crop_id;
	}
	
	function init(){
		// Initialize planner variables
		self.sidebar = new Sidebar;
		self.player = new Player;
		sync_profession_from_player();
		apply_profession_to_player();
		apply_farming_level_to_player();
		self.planner_modal  = $("#crop_planner");
		
		for (var i = 0; i < self.days.length; i++) self.days[i] = i + 1;
		self.seasons = [new Season(0), new Season(1), new Season(2), new Season(3)];
		self.cseason = self.seasons[0];
		plannerState.set("currentSeasonIndex", self.cseason.index);
		self.cinfo_settings.season_options = [self.seasons[0], self.seasons[1], self.seasons[2]];
		
		// Enable bootstrap tooltips
		$("body").tooltip({selector: "[data-toggle=tooltip]", trigger: "hover", container: "body"});
		
		// Keydown events
		$(document).keydown(function(e){
			if (planner_event_handler(e)) return;
			if (self.sidebar.keydown(e)) return;
		});
		
		// On modal close: save plans and update
		self.planner_modal.on("hide.bs.modal", function(){
			// Only if currently editing
			if (self.editplan){
				self.editplan = null;
				self.update(self.cyear);
				$scope.$apply();
			}
		});
		
		// Development mode
		// has issues in Firefox, works fine in Chrome
		if (window.location.hash == "#dev"){
			console.log("Development mode enabled.");
			
			// Update CSS every 400 ms
			var stylesheet = $("link[href='style.css']");
			var stylesheet_url = stylesheet.attr("href");
			setInterval(function(){
				var time = Date.now();
				stylesheet.attr("href", stylesheet_url + "?t=" + time);
			}, 400);
		}
		
		// Load planner config data and external crops data
		dataLoaderFn().then(function(result){
			self.config = result && result.config ? result.config : {};
			var planner_data = result && result.plannerData ? result.plannerData : {};
			if (planner_data.crops){
				self.config.crops = adapt_planner_crops(planner_data.crops);
			}
			
			cropsData = self.config.crops || [];
			
			// Process crop data
			$.each(cropsData, function(i, crop){
				crop = new Crop(crop);
				self.crops_list.push(crop);
				self.crops[crop.id] = crop;
			});
			refresh_crop_metrics();
			
			// Process fertilizer data
			$.each(self.config.fertilizer, function(i, fertilizer){
				fertilizer = new Fertilizer(fertilizer);
				self.config.fertilizer[i] = fertilizer;
				self.fertilizer[fertilizer.id] = fertilizer;
			});
			
			// Process events data
			var s_index = 0;
			$.each(self.config.events, function(season_name, season){
				$.each(season, function(ii, c_event){
					c_event.season = s_index;
					c_event = new CalendarEvent(c_event);
					self.events[c_event.date] = c_event;
				});
				
				s_index++;
			});
			
			// Create newplan template
			self.newplan = new Plan;
			
			// Load saved plans from browser storage
			var plan_count = load_data();
			
			// Create first year if it doesn't exist
			if (!self.years.length) self.years.push(new Year(0));
			
			// Set current year to first year
			self.cyear = self.years[0];
			plannerState.set("currentYearIndex", self.cyear ? self.cyear.index : 0);
			
			// Debug info
			console.log("Loaded " + self.crops_list.length + " crops.");
			console.log("Loaded " + plan_count + " plans into " + self.years.length + " year(s).");
			
			// Update plans
			update(self.years[0].data.farm, true); // Update farm
			update(self.years[0].data.greenhouse, true); // Update greenhouse
			refreshProfitDashboard();
			
			self.loaded = true;
			$scope.$apply();
		}).catch(function(error){
			alert("An error occurred in loading planner data. Check the browser console.");
			console.log("Error: ", error);
		});
	}
	
	
	/********************************
		CORE PLANNER FUNCTIONS
	********************************/
	// Planner general event handler
	function planner_event_handler(e){
		// Not focused on anything
		if ($(document.activeElement).is("input") || $(document.activeElement).is("textarea")) return;
		
		// Sidebar must be closed
		if (self.sidebar.is_open()) return;
		
		// Planner modal must be closed
		if (self.planner_modal.hasClass("in")) return;
		
		var event_handled = true;
		if (e.which == 39){
			// Right arrow
			self.inc_season(1);
		} else if (e.which == 37){
			// Left arrow
			self.inc_season(-1);
		} else if (e.which == 27){
			// ESC
			self.sidebar.open("cropinfo");
		} else if (e.which == 192){
			// Tilde
			self.toggle_mode();
		} else {
			event_handled = false;
		}
		
		if (event_handled){
			e.preventDefault();
			$scope.$apply();
			return true;
		}
	}
	
	// Save plan data to browser storage
	function save_data(){
		// Save plan data
		var plan_data = [];
		$.each(self.years, function(i, year){
			var year_data = year.get_data();
			//if (!year_data) return; // continue
			plan_data.push(year_data);
		});
		SAVE_JSON("plans", plan_data);
	}
	
	// Load plan data from browser storage
	function load_data(){
		// Load plan data
		var plan_data = LOAD_JSON("plans");
		if (!plan_data) return 0;
		
		var plan_count = 0;
		plannerState.set("years", []);
		self.years = plannerState.get("years");
		$.each(plan_data, function(i, year_data){
			var new_year = new Year(i);
			plan_count += new_year.set_data(year_data);
			self.years.push(new_year);
		});
		self.cyear = self.years[0];
		plannerState.set("currentYearIndex", self.cyear ? self.cyear.index : 0);
		
		return plan_count;
	}
	
	// Update planner info of current farm/year
	function update(farm, full_update){
		// Received year, expected farm
		if (farm instanceof Year) farm = farm.farm();
		
		// If farm is null, get first farm/year
		farm = farm || self.years[0].farm();
		
		// Update all years after this one VS just this year
		full_update = full_update || (farm.greenhouse && farm.has_regrowing_crops());
		
		// Reset harvests
		farm.harvests = [];
		
		// Reset financial totals
		farm.totals = {};
		farm.totals.day = {};
		farm.totals.season = [new Finance, new Finance, new Finance, new Finance];
		farm.totals.year = new Finance;
		
		// Rebuild data
		$.each(farm.plans, function(date, plans){
			date = parseInt(date);
			
			$.each(plans, function(i, plan){
				var crop = plan.crop;
				var planting_cost_breakdown = plan.get_cost_breakdown();
				var planting_cost = planting_cost_breakdown.totalCost;
				plan.seedCost = planting_cost_breakdown.seedCost;
				plan.fertilizerCost = planting_cost_breakdown.fertilizerCost;
				plan.totalCost = planting_cost_breakdown.totalCost;
				var season = self.seasons[Math.floor((plan.date-1)/SEASON_DAYS)];
				var crop_end = crop.end;
				
				if (farm.greenhouse){
					crop_end = YEAR_DAYS;
				}
				
				// Update daily costs for planting
				if (!farm.totals.day[date]) farm.totals.day[date] = new Finance;
				var d_plant = farm.totals.day[date];
				d_plant.profit.min -= planting_cost;
				d_plant.profit.max -= planting_cost;
				
				// Update seasonal costs for planting
				var s_plant_total = farm.totals.season[season.index];
				s_plant_total.profit.min -= planting_cost;
				s_plant_total.profit.max -= planting_cost;
				
				// Update seasonal number of plantings
				s_plant_total.plantings += plan.amount;
				
				var fert_effect = get_fertilizer_effect(plan.fertilizer);
				plan.waterRetentionChance = fert_effect.waterRetention || 0;
				
				var lifecycle = getCropLifecycle(crop, date, crop_end, plan.fertilizer);
				if (!lifecycle.length) return;
				
				var harvests = [];
				for (var i = 0; i < lifecycle.length; i++){
					harvests.push(new Harvest(plan, lifecycle[i].day, i > 0));
				}
				
				// Assign harvests to plan object
				plan.harvests = harvests;
				
				// Add up all harvests
				for (var i = 0; i < harvests.length; i++){
					var harvest = harvests[i];
					
					// Update harvests
					if (!farm.harvests[harvest.date]) farm.harvests[harvest.date] = [];
					farm.harvests[harvest.date].push(harvest);
					
					// Update daily revenues from harvests
					if (!farm.totals.day[harvest.date]) farm.totals.day[harvest.date] = new Finance;
					var d_harvest = farm.totals.day[harvest.date];
					d_harvest.profit.min += harvest.revenue.min;
					d_harvest.profit.max += harvest.revenue.max;
					
					// Update seasonal revenues from harvests
					var h_season = Math.floor((harvest.date - 1) / SEASON_DAYS);
					var s_harvest_total = farm.totals.season[h_season];
					s_harvest_total.profit.min += harvest.revenue.min;
					s_harvest_total.profit.max += harvest.revenue.max;
					
					// Update seasonal number of harvests
					s_harvest_total.harvests.min += harvest.yield.min;
					s_harvest_total.harvests.max += harvest.yield.max;
				}
			});
		});
		
		// Add up annual total
		for (var i = 0; i < farm.totals.seasons; i++){
			var season = farm.totals.seasons[i];
			var y_total = farm.totals.year;
			y_total.profit.min += season.profit.min
			y_total.profit.max += season.profit.max
		}
		
		// Update next year
		if (full_update){
			var next_year = farm.year.next();
			if (next_year){
				update(next_year, true);
			}
		}
		
		refreshProfitDashboard();
	}
	
	// Add self.newplan to plans list
	function add_plan(date, auto_replant){
		if (!validate_plan_amount()) return;
		runWithHistory(function(){
			self.cyear.add_plan(self.newplan, date, auto_replant);
			self.newplan = new Plan;
		});
	}
	
	// Add plan to plans list on enter keypress
	function add_plan_key(date, e){
		if (e.which != 13) return;
		if (!validate_plan_amount()) return;
		add_plan(date);
	}
	
	// Validate newplan amount
	function validate_plan_amount(){
		// Remove all whitespace
		var amount = (self.newplan.amount + "") || "";
		amount = amount.replace(/\s/g, "");
		
		// Is empty string
		if (!amount){
			self.newplan.amount = 1;
			return;
		}
		
		// Check if input is in gold
		if (amount.toLowerCase().endsWith("g")){
			var match = amount.match(/^([0-9]+)g$/i)
			if (!match) return;
			
			var gold = parseInt(match[1] || 0);
			var crop = self.crops[self.newplan.crop_id];
			if (!crop) return;
			var seed_cost = get_seed_cost(crop);
			amount = seed_cost > 0 ? Math.floor(gold / seed_cost) : 1;
			amount = amount || 1;
			self.newplan.amount = amount;
			return;
		}
		
		// Invalid non-integer amount
		if (!amount.match(/^[0-9]+$/)) return;
		
		// Parse normal integer input
		amount = parseInt(amount || 0);
		if (amount <= 0) return;
		
		return true;
	}
	
	// Edit plan
	function edit_plan(plan, save){
		if (save){
			self.editplan = null;
			save_data();
			update(self.cyear);
			return;
		} else if (self.editplan){
			// Other edit already open
			save_data();
			update(self.cyear);
		}
		
		self.editplan = plan;
	}
	
	// Remove plan from plans list of current farm/year
	function remove_plan(date, index){
		runWithHistory(function(){
			self.editplan = null;
			self.cyear.remove_plan(date, index);
		});
	}
	
	// Remove plans from current farm/season
	function clear_season(season){
		clear_history();
		var full_update = self.cfarm().has_regrowing_crops(season);
		for (var date = season.start; date <= season.end; date++){
			self.cfarm().plans[date] = [];
		}
		save_data();
		update(self.cyear, full_update);
	}
	
	// Remove plans from current farm/year
	function clear_year(year){
		clear_history();
		var farm = year.farm();
		var full_update = farm.has_regrowing_crops();
		$.each(farm.plans, function(date, plans){
			farm.plans[date] = [];
		});
		save_data();
		update(year, full_update);
	}
	
	// Remove all plans
	function clear_all(){
		if (!confirm("Permanently clear all plans?")) return;
		clear_history();
		plannerState.set("years", [new Year(0)]);
		self.years = plannerState.get("years");
		self.cyear = self.years[0];
		plannerState.set("currentYearIndex", 0);
		save_data();
		update(null, true);
	}
	
	// Open crop planner modal
	function open_plans(date){
		self.planner_modal.modal();
		self.cdate = date;
	}
	
	////////////////////////////////
	
	// Increment/decrement current year; creates new year if necessary
	function inc_year(direction){
		direction = direction > 0 ? true : false;
		
		if (direction){
			// Next year
			self.cyear = self.cyear.next(true);
		} else {
			// Previous year
			var prev_year = self.cyear.previous();
			if (!prev_year) return;
			self.cyear = prev_year;
		}
		plannerState.set("currentYearIndex", self.cyear ? self.cyear.index : 0);
		
		refreshProfitDashboard();
	}
	
	// Increment/decrement current season; creates new year if necessary
	function inc_season(direction){
		direction = direction > 0 ? true : false;
		var next_season = direction ? self.cseason.index + 1 : self.cseason.index - 1;
		
		if (next_season > 3){
			// Next season
			next_season = 0;
			self.cyear = self.cyear.next(true);
		} else if (next_season < 0) {
			// Previous season
			next_season = 3;
			var prev_year = self.cyear.previous();
			if (!prev_year) return;
			self.cyear = prev_year;
		}
		plannerState.set("currentYearIndex", self.cyear ? self.cyear.index : 0);
		
		self.set_season(next_season);
	}
	
	// Set current season
	function set_season(index){
		self.cseason = self.seasons[index];
		plannerState.set("currentSeasonIndex", self.cseason ? self.cseason.index : 0);
		self.newplan.crop_id = null;
		refreshProfitDashboard();
	}
	
	// Get current farm object of current year
	function cfarm(){
		if (!self.cyear) return {};
		return self.cyear.farm();
	}
	
	// Check if current farm mode is greenhouse
	function in_greenhouse(){
		return self.cmode == "greenhouse";
	}
	
	// Toggle current farm mode
	function toggle_mode(){
		if (self.cmode == "farm"){
			set_mode("greenhouse");
		} else {
			set_mode("farm");
		}
	}
	
	// Set current farm mode
	function set_mode(mode){
		self.cmode = mode;
		plannerState.set("currentMode", self.cmode);
		refreshProfitDashboard();
	}
	
	////////////////////////////////
	
	// Get season object by id name or date
	function get_season(id){
		// Get season containing a date
		if (typeof id == "number"){
			return self.seasons[Math.floor((id - 1) / SEASON_DAYS)];
		}
		
		// Get season by string ID
		for (var i = 0; i < self.seasons.length; i++){
			if (self.seasons[i].id == id) return self.seasons[i];
		}
	}
	
	// Get formatted date
	function get_date(real_date, format){
		real_date = real_date || self.cdate;
		if (!real_date) return;
		var date = real_date % SEASON_DAYS || SEASON_DAYS;
		
		var nth = "th"; // st nd rd th
		if (date <= 3 || date >= 21){
			switch((date % 100) % 10){
				case 1: nth = "st"; break;
				case 2: nth = "nd"; break;
				case 3: nth = "rd"; break;
			}
		}
		
		var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
		var day = days[date % 7];
		var season = self.seasons[Math.floor((real_date - 1) / SEASON_DAYS)];
		season = season.name;
		
		var str = format.replace("%l", day)
						.replace("%j", date)
						.replace("%S", nth)
						.replace("%F", season);
		
		return str;
	}
	
	// Set key to sort crop info by
	function ci_set_sort(key){
		var descending_keys = {profitPerDay: true, fixed_profit: true, sellPrice: true, growthDays: true, sell: true, grow: true, buy: true};
		if (self.cinfo_settings.sort == key){
			self.cinfo_settings.order = !self.cinfo_settings.order;
		} else {
			self.cinfo_settings.sort = key;
			self.cinfo_settings.order = descending_keys[key] ? true : false;
		}
	}
	
	function apply_sort(key){
		var descending_keys = {profitPerDay: true, fixed_profit: true, sellPrice: true, growthDays: true, sell: true, grow: true, buy: true};
		self.cinfo_settings.sort = key;
		self.cinfo_settings.order = descending_keys[key] ? true : false;
	}
	
	function getCropLifecycle(crop, plantDay, maxDay, currentFertilizer, professionOverride){
		if (!crop || !plantDay) return [];
		
		var growthDays = get_growth_days_with_modifiers(crop, currentFertilizer, professionOverride || get_profession());
		var regrowDays = get_crop_regrow_days(crop);
		
		var limitDay = maxDay;
		if (typeof limitDay != "number"){
			limitDay = get_season(plantDay).end;
		}
		
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
	
	function calculateMultiSeasonProfit(crop, plantDay, seasonCount, options){
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
			avgSellPrice = get_average_sell_price(crop.sell || 0, get_farming_level(), options.fertilizer);
		}
		
		var harvestValue = avgSellPrice * harvestYield * plantingMultiplier;
		var plantingCost = get_total_planting_cost(crop, options.fertilizer, plantingMultiplier).totalCost;
		
		var totalProfit = 0;
		var currentPlantDay = plantDay;
		while (currentPlantDay <= limitDay){
			var lifecycle = getCropLifecycle(crop, currentPlantDay, limitDay, options.fertilizer, options.profession);
			if (!lifecycle.length) break;
			
			totalProfit -= plantingCost;
			$.each(lifecycle, function(i, event){
				if (event.type == "harvest" && event.day <= limitDay){
					totalProfit += harvestValue;
				}
			});
			
			// Regrowing crops only pay seed cost once.
			if (regrowDays > 0) break;
			currentPlantDay = lifecycle[0].day;
		}
		
		return totalProfit;
	}
	
	// Filter crops that can be planted in the planner's drop down list
	function planner_valid_crops(crop){
		return crop.can_grow(self.cseason, true) || self.in_greenhouse();
	}
	
	
	/********************************
		CLASSES
	********************************/
	/****************
		Sidebar class - controlling the sidebar [single instance]
	****************/
	function Sidebar(){
		var self = this;
		self.mode = "";
		self.crop = null; // crop object
		
		self.keydown = keydown;
		self.open = open_view;
		self.close = close_view;
		self.is_open = is_open;
		self.open_crop = open_crop;
		self.back = back;
		self.export_data = export_data;
		self.import_data = import_data;
		self.legacy_import_data = legacy_import_data;
		
		function keydown(e){
			// Sidebar must be open
			if (!self.is_open()) return;
			
			var event_handled = true;
			if (e.which == 27){
				// ESC
				back();
			} else {
				event_handled = false
			}
			
			if (event_handled){
				e.preventDefault();
				$scope.$apply();
				return true;
			}
		}
		
		function close_view(){
			open_view("");
		}
		
		function is_open(){
			return self.mode != "";
		}
		
		function open_view(view){
			// Toggle off
			if (self.mode == view)
				view = "";
			hide_crop_tooltip();
			
			// Clear properties & save on close
			if (!view){
				self.crop = null;
				planner.cinfo_settings.search = "";
				planner.player.save();
				planner.update(null, true);
			} else {
				// Set certain properties on open
				if (planner.cseason.id != "winter")
					planner.cinfo_settings.seasons = [planner.cseason.id];
			}
			
			// Set mode
			self.mode = view;
		}
		
		function back(full_close){
			// back to crop info
			if (self.crop){
				self.crop = null;
				if (!full_close) return;
			}
			
			open_view("");
		}
		
		function open_crop(crop){
			hide_crop_tooltip();
			self.mode = "cropinfo";
			self.crop = crop;
		}
		
		function export_data(){
			// Save player
			//planner.player.save();
			
			// Export data
			var out_data = {};
			out_data.plans = LOAD_JSON("plans");
			//out_data.player = LOAD_JSON("player");
			out_data.version = DATA_VERSION;
			
			var blob = new Blob([JSON.stringify(out_data)], {type: "octet/stream"});
			var blob_url = window.URL.createObjectURL(blob);
			
			var link = document.createElement("a");
			link.href = blob_url;
			link.style = "display: none";
			link.download = "Crop Planner [" + Date.now() + "]" + ".json";
			document.body.appendChild(link);
			link.click();
		}
		
		function import_data(){
			var input = $("<input type='file' accept='.json'>").appendTo("body");
			input.css("display", "none");
			input.change(read_file);
			input.click();
		}
		
		function read_file(evt){
			var file = evt.target.files[0];
			if (!file) return;
			
			// Read data from JSON file
			var reader = new FileReader;
			reader.onload = function(e){
				var data = {};
				
				try {
					data = JSON.parse(e.target.result);
				} catch(e){
					alert("Not valid JSON data to import.")
					return;
				}
				
				//if (!data.plans || !data.player){
				if (!data.plans){
					alert("Invalid data to import.")
					return;
				}
				
				if (data.version != DATA_VERSION){
					alert("Incompatible plan version.");
					return;
				}
				
				clear_history();
				SAVE_JSON("plans", data.plans);
				//SAVE_JSON("player", data.player);
				
				var plan_count = load_data();
				//planner.player.load();
				update(planner.years[0].data.farm, true); // Update farm
				update(planner.years[0].data.greenhouse, true); // Update greenhouse
				$scope.$apply();
				alert("Successfully imported " + plan_count + " plans into " + planner.years.length + " year(s).");
				console.log("Imported " + plan_count + " plans into " + planner.years.length + " year(s).");
			};
			
			reader.readAsText(file);
		}
		
		function legacy_import_data(){
			if (!confirm("This will attempt to import planner data from the old v1 planner, and will overwrite any current plans. This change is not reversible and is not guaranteed to always work. Continue?")) return;
			clear_history();
			
			// Load old v1 planner data
			var plan_data = localStorage.getItem("crops");
			if (!plan_data){ alert("No plan data to import"); return; }
			plan_data = JSON.parse(plan_data);
			if (!plan_data){ alert("No plan data to import"); return; }
			
			// Create new plan data
			var new_plans = [{"farm":{}, "greenhouse":{}}];
			$.each(plan_data, function(date, plans){
				date = parseInt(date);
				$.each(plans, function(i, plan){
					plan.date = date;
					if (!planner.crops[plan.crop]) return; // Invalid crop
					
					if (plan.greenhouse){
						if (!new_plans[0].greenhouse[date]) new_plans[0].greenhouse[date] = [];
						delete plan.greenhouse;
						new_plans[0].greenhouse[date].push(plan);
					} else {
						if (!new_plans[0].farm[date]) new_plans[0].farm[date] = [];
						new_plans[0].farm[date].push(plan);
					}
					
					plan_count++;
				});
			});
			
			// Save data
			SAVE_JSON("plans", new_plans);
			
			// Reload data and update
			var plan_count = load_data();
			update(planner.years[0].data.farm, true); // Update farm
			update(planner.years[0].data.greenhouse, true); // Update greenhouse
			alert("Successfully imported " + plan_count + " legacy plans into " + planner.years.length + " year(s).");
			console.log("Imported " + plan_count + " legacy plans into " + planner.years.length + " year(s).");
		}
	}
	
	
	/****************
		Player class - user-set player configs [single instance]
	****************/
	function Player(){
		var self = this;
		self.level = 0; // farming level; starts at 0
		self.tiller = false;
		self.agriculturist = false;
		self.profession = "none";
		
		self.load = load
		self.save = save;
		self.toggle_perk = toggle_perk;
		self.quality_chance = quality_chance;
		
		// Miscellaneous client settings
		self.settings = {
			show_events: true,
		};
		
		
		init();
		
		
		function init(){
			load();
			console.log("Loaded player settings");
		}
		
		// Load player config from browser storage
		function load(){
			var pdata = LOAD_JSON("player");
			if (!pdata) return;
			
			if (pdata.profession) self.profession = pdata.profession;
			if (pdata.tiller) self.tiller = true;
			if (pdata.agriculturist) self.agriculturist = true;
			if (self.profession == "agriculturist"){
				self.tiller = true;
				self.agriculturist = true;
			} else if (self.profession == "tiller"){
				self.tiller = true;
				self.agriculturist = false;
			}
			if (typeof pdata.level != "undefined"){
				self.level = clamp_farming_level(pdata.level);
			}
			if (pdata.settings) self.settings = pdata.settings;
		}
		
		// Save player config to browser storage
		function save(){
			var pdata = {};
			pdata.profession = self.profession || "none";
			if (self.tiller) pdata.tiller = self.tiller;
			if (self.agriculturist) pdata.agriculturist = self.agriculturist;
			pdata.settings = self.settings;
			pdata.level = clamp_farming_level(self.level);
			SAVE_JSON("player", pdata);
		}
		
		// Toggle profession perks
		function toggle_perk(key){
			self[key] = !self[key];
			
			// Must have Tiller to have Agriculturist
			if (!self.tiller && key == "tiller"){
				self.agriculturist = false;
			} else if (self.agriculturist && key == "agriculturist"){
				self.tiller = true;
			}
			
			self.profession = "none";
			if (self.agriculturist){
				self.profession = "agriculturist";
			} else if (self.tiller){
				self.profession = "tiller";
			}
			
			if (planner && planner.set_profession){
				planner.set_profession(self.profession);
			}
		}
		
		// Get scalar value of chance of crop being 0=regular; 1=silver; 2=gold quality
		// [SOURCE: StardewValley/Crop.cs : function harvest]
		function quality_chance(quality, mult, locale){
			quality = quality || 0;		// Default: check regular quality chance
			mult = mult || 0;			// Fertilizer quality bonus (0-1)
			
			var distribution = get_quality_distribution(self.level, mult);
			var gold_chance = distribution.gold;
			var silver_chance = distribution.silver;
			var regular_chance = distribution.normal;
			
			var chance = 0;
			switch (quality){
				case 0:
					chance = regular_chance;
					break;
				case 1:
					chance = Math.min(1, silver_chance);
					break;
				case 2:
					chance = Math.min(1, gold_chance);
					break;
			}
			
			if (locale) return Math.round(chance * 100);
			return chance;
		}
	}
	
	
	/****************
		Season class - representing one of the four seasons
	****************/
	function Season(ind){
		var self = this;
		self.index = ind;
		self.id;
		self.name;
		self.start = 0;
		self.end = 0;
		
		
		init();
		
		
		function init(){
			var seasons = ["spring", "summer", "fall", "winter"];
			self.id = seasons[self.index];
			self.name = self.id.charAt(0).toUpperCase() + self.id.slice(1);
			self.start = (self.index * SEASON_DAYS) + 1;
			self.end = self.start + SEASON_DAYS - 1;
		}
	}
	
	Season.prototype.get_image = function(){
		return "images/seasons/" + this.id + ".png";
	};
	
	
	/****************
		Crop class - represents a crop
	****************/
	function Crop(data){
		var self = this;
		
		// Config properties
		self.id;
		self.name;
		self.sell;
		self.buy;
		self.seedPrice = 0;
		self.seedCost = 0;
		self.seasons = [];
		self.stages = [];
		self.regrow;
		self.wild = false;
		
		// Harvest data
		self.harvest = {
			min: 1,
			max: 1,
			level_increase: 1,
			extra_chance: 0
		};
		
		// Custom properties
		self.note = "";
		self.start = 0;			// Start of grow season(s)
		self.end = 0;			// End of grow season(s)
		self.base_sell = 0;		// Base sell price before profession modifiers
		self.base_grow = 0;		// Base growth days before profession modifiers
		self.grow = 0;			// Total days to grow
		self.profit = 0;		// Minimum profit/day (for crops info menu)
		self.fixed_profit = 0;	// Fixed budget profit
		self.profitPerDay = 0;
		self.growthDays = 0;
		self.sellPrice = 0;
		
		
		init();
		
		
		function init(){
			if (!data) return;
			var seed_price = Number(data.seedPrice);
			if (isNaN(seed_price)) seed_price = Number(data.seedCost);
			if (isNaN(seed_price)) seed_price = Number(data.buy);
			if (isNaN(seed_price)) seed_price = 0;
			
			// Base properties
			self.id = data.id;
			self.name = data.name;
			self.sell = data.sell;
			self.seedPrice = seed_price;
			self.seedCost = seed_price;
			self.buy = seed_price;
			self.seasons = data.seasons;
			self.stages = data.stages;
			self.regrow = data.regrow;
			if (data.wild) self.wild = true;
			
			// Harvest data
			if (data.harvest.min) self.harvest.min = data.harvest.min;
			if (data.harvest.max) self.harvest.max = data.harvest.max;
			if (data.harvest.level_increase) self.harvest.level_increase = data.harvest.level_increase;
			if (data.harvest.extra_chance) self.harvest.extra_chance = data.harvest.extra_chance;
			
			// Custom properties
			if (data.note) self.note = data.note;
			self.start = get_season(data.seasons[0]).start;
			self.end = get_season(data.seasons[data.seasons.length-1]).end;
			self.grow = 0;
			for (var i = 0; i < data.stages.length; i++){
				self.grow += data.stages[i];
			}
			self.base_sell = self.sell;
			self.base_grow = self.grow;
			
			// Initial values before profession-aware refresh
			var base_profit = calculateProfit(self, {profession: "none"});
			var base_fixed_profit = calculateProfit(self, {profession: "none", useFixedBudget: true});
			self.sellPrice = base_profit.sellPrice;
			self.growthDays = base_profit.growthDays;
			self.profitPerDay = base_profit.profitPerDay;
			self.profit = base_profit.profitPerDay;
			self.fixed_profit = base_fixed_profit.profitPerDay;
		}
	}
	
	// Get crop quality-modified sell price
	// [SOURCE: StardewValley/Object.cs : function sellToStorePrice]
	Crop.prototype.get_sell = function(quality){
		quality = quality || 0;
		return Math.floor(this.sell * (1 + (quality * 0.25)));
	};
	
	// Check if crop can grow on date/season
	Crop.prototype.can_grow = function(date, is_season, in_greenhouse){
		var self = this;
		
		// Expected numeric date, received array of seasons
		if (date.constructor === Array){
			var result = false;
			$.each(date, function(i, v){
				result = result || self.can_grow(v, is_season, in_greenhouse);
				if (result) return false; // break on true
			});
			return result;
		}
		
		if (in_greenhouse && (date <= YEAR_DAYS)) return true;
		if (is_season){
			var season = date;
			if (typeof season == "string") season = planner.get_season(season);
			return (this.start <= season.start) && (this.end >= season.end);
		} else {
			return (date >= this.start) && (date <= this.end);
		}
	};
	
	// Get url to Stardew Valley wiki
	Crop.prototype.get_url = function(){
		var fragment = this.id.split("_");
		for (var i=0; i<fragment.length; i++){
			fragment[i] = fragment[i].charAt(0).toUpperCase() + fragment[i].slice(1);
		}
		fragment = fragment.join("_");
		return "http://stardewvalleywiki.com/Crops#"+fragment;
	};
	
	// Get thumbnail image
	Crop.prototype.get_image = function(seeds){
		if (seeds && this.wild){
			return "images/seeds/wild_"+this.seasons[0]+".png";
		}
		if (seeds) return "images/seeds/"+this.id+".png";
		return "images/crops/"+this.id+".png";
	};
	
	
	/****************
		Year class - yearly plans
	****************/
	function Year(year_index){
		var self = this;
		self.index = 0;
		self.start = 0;
		self.end = 0;
		self.data = {};
		
		
		init();
		
		
		function init(){
			self.index = year_index;
			self.start = (self.index * YEAR_DAYS) + 1;
			self.end = self.start + YEAR_DAYS - 1;
			
			self.data.farm = new Farm(self);
			self.data.greenhouse = new Farm(self, true);
		}
	}
	
	// Return current Farm object based on planner mode
	Year.prototype.farm = function(){
		return this.data[planner.cmode];
	};
	
	// Returns next year
	Year.prototype.next = function(force_create){
		var next_id = this.index + 1;
		if (next_id >= planner.years.length){
			if (!force_create) return;
			var new_year = new Year(next_id);
			planner.years.push(new_year);
			return new_year;
		}
		return planner.years[next_id];
	};
	
	// Returns previous year
	Year.prototype.previous = function(){
		var next_id = this.index - 1;
		if (next_id < 0) return;
		return planner.years[next_id];
	};
	
	// Get data from year (for saving)
	Year.prototype.get_data = function(){
		var self = this;
		var year_plans = {};
		var total_count = 0;
		
		$.each(self.data, function(type, farm){
			var type_plans = {};
			var type_count = 0;
			
			$.each(farm.plans, function(date, plans){
				if (!plans.length) return;
				type_count += plans.length;
				total_count += plans.length;
				type_plans[date] = [];
				
				$.each(plans, function(i, plan){
					type_plans[date].push(plan.get_data());
				});
			});
			
			if (type_count) year_plans[type] = type_plans;
		});
		
		if (!total_count) return;
		return year_plans;
	};
	
	// Load data into year (from loading)
	Year.prototype.set_data = function(l_data){
		var self = this;
		var plan_count = 0;
		
		$.each(l_data, function(type, plan_data){
			$.each(plan_data, function(date, plans){
				date = parseInt(date);
				
				$.each(plans, function(i, plan){
					plan.date = date;
					if (!planner.crops[plan.crop]) return; // Invalid crop
					var plan_object = new Plan(plan, type == "greenhouse");
					self.data[type].plans[date].push(plan_object);
					plan_count++;
				});
			});
		});
		
		return plan_count;
	};
	
	// Add plan to this farm/year
	Year.prototype.add_plan = function(newplan, date, auto_replant){
		// Validate data
		if (!newplan.crop_id) return false;
		
		// Date out of bounds
		if (date < 1 || date > YEAR_DAYS) return false;
		
		// Check that crop can grow
		var crop = planner.crops[newplan.crop_id];
		if (!crop || !crop.can_grow(date, false, planner.in_greenhouse())) return false;
		newplan.crop = crop;
		
		// Amount to plant
		newplan.amount = parseInt(newplan.amount || 0);
		if (newplan.amount <= 0) return false;
		
		// Add plan
		var plan = new Plan(newplan.get_data(), planner.in_greenhouse());
		plan.date = date;
		plan.get_cost_breakdown();
		this.farm().plans[date].push(plan);
		
		// Auto-replanting within current year
		var regrowDays = crop.regrowDays;
		if (regrowDays === null || typeof regrowDays == "undefined"){
			regrowDays = crop.regrow;
		}
		regrowDays = parseInt(regrowDays);
		if (isNaN(regrowDays)) regrowDays = -1;
		
		if (!auto_replant || regrowDays > 0){
			// Update
			update(this);
			save_data();
		} else if (auto_replant){
			var in_greenhouse = planner.in_greenhouse();
			var crop_end = in_greenhouse ? YEAR_DAYS : crop.end;
			var lifecycle = getCropLifecycle(crop, date, crop_end, plan.fertilizer);
			if (!lifecycle.length){
				// No more cycles available for current crop
				update(this);
				save_data();
				return;
			}
			
			// Replant on harvest day (non-regrow crops)
			var replant_event = {
				day: lifecycle[0].day,
				type: "replant",
				crop: crop
			};
			var nextPlanting = replant_event.day;
			var nextLifecycle = getCropLifecycle(crop, nextPlanting, crop_end, plan.fertilizer);
			if (!nextLifecycle.length){
				update(this);
				save_data();
				return;
			}

			// Auto-replant
			this.add_plan(newplan, nextPlanting, true);
		}
	};
	
	// Remove plan from current farm/year
	Year.prototype.remove_plan = function(date, index){
		var farm = this.farm();
		if (!farm.plans[date][index]) return;
		var regrowDays = parseInt(farm.plans[date][index].crop.regrowDays);
		if (isNaN(regrowDays)) regrowDays = parseInt(farm.plans[date][index].crop.regrow);
		var full_update = regrowDays > 0;
		farm.plans[date].splice(index, 1);
		save_data();
		update(this, full_update);
	};
	
	
	/****************
		Farm class - used only within Year
	****************/
	function Farm(parent_year, is_greenhouse){
		var self = this;
		self.year;
		self.greenhouse = false;
		self.plans = {};
		self.harvests = {};
		self.totals = {};
		
		
		init();
		
		
		function init(){
			self.year = parent_year;
			self.greenhouse = is_greenhouse;
			
			for (var i = 0; i < YEAR_DAYS; i++){
				self.plans[i+1] = [];
			}
			self.totals.season = [new Finance, new Finance, new Finance, new Finance];
		}
	}
	
	// Check if farm has crops that regrow; season param optional
	Farm.prototype.has_regrowing_crops = function(season){
		var start_day = 1;
		var end_day = YEAR_DAYS;
		
		if (season){
			start_day = season.start;
			end_day = season.end;
		}
		
		for (var date = start_day; date <= end_day; date++){
			for (var i = 0; i < this.plans[date].length; i++){
				var regrowDays = parseInt(this.plans[date][i].crop.regrowDays);
				if (isNaN(regrowDays)) regrowDays = parseInt(this.plans[date][i].crop.regrow);
				if (regrowDays > 0){
					return true;
				}
			}
		}
		return false;
	};
	
	// Get image representing farm type
	Farm.prototype.get_image = function(){
		var type = this.greenhouse ? "greenhouse" : "scarecrow";
		return "images/" + type + ".png";
	};
	
	/****************
		Harvest class - represents crops harvested on a date
	****************/
	function Harvest(plan, date, is_regrowth){
		var self = this;
		self.date = 0;
		self.plan = {};
		self.crop = {};
		self.yield = {min: 0, max: 0};
		self.revenue = {min: 0, max: 0};
		self.cost = 0;
		self.profit = {min: 0, max: 0};
		self.is_regrowth = false;
		
		
		init();
		
		
		function init(){
			if (!plan || !date) return;
			var crop = plan.crop;
			self.plan = plan;
			self.crop = crop;
			self.date = date;
			
			// Calculate crop yield (+ extra crop drops)
			// [SOURCE: StardewValley/Crop.cs : function harvest]
			self.yield.min = crop.harvest.min * plan.amount;
			self.yield.max = (Math.min(crop.harvest.min + 1, crop.harvest.max + 1 + (planner.player.level / crop.harvest.level_increase))-1) * plan.amount;
			
			// Harvest revenue and costs
			var fert_effect = get_fertilizer_effect(plan.fertilizer);
			var quality_bonus = fert_effect.qualityBonus || 0;
			
			// Fertilizers expire at the beginning of a new season in the greenhouse
			if (self.plan.greenhouse && (planner.get_season(self.date) != planner.get_season(self.plan.date)))
				quality_bonus = 0;
			
			// Calculate min/max revenue based on regular/silver/gold chance
			var regular_chance = planner.player.quality_chance(0, quality_bonus);
			var silver_chance = planner.player.quality_chance(1, quality_bonus);
			var gold_chance = planner.player.quality_chance(2, quality_bonus);
			
			var min_revenue = crop.get_sell(0);
			var max_revenue = (min_revenue*regular_chance) + (crop.get_sell(1)*silver_chance) + (crop.get_sell(2)*gold_chance);
			max_revenue = Math.min(crop.get_sell(2), max_revenue);
			
			// Quality from fertilizer only applies to picked harvest
			// and not to extra dropped yields
			self.revenue.min = Math.floor(min_revenue) * self.yield.min;
			self.revenue.max = Math.floor(max_revenue) + (Math.floor(min_revenue) * Math.max(0, self.yield.max - 1));
			if (typeof plan.totalCost == "number" && !isNaN(plan.totalCost)){
				self.cost = plan.totalCost;
			} else {
				var cost_breakdown = plan.get_cost_breakdown();
				self.cost = cost_breakdown.totalCost;
			}
			
			// Tiller profession (ID 1)
			// [SOURCE: StardewValley/Object.cs : function sellToStorePrice]
			if (planner.player.tiller){
				self.revenue.min = Math.floor(self.revenue.min * 1.1);
				self.revenue.max = Math.floor(self.revenue.max * 1.1);
			}
			
			// Regrowth
			if (is_regrowth){
				self.is_regrowth = true;
				self.cost = 0;
			}
			
			// Harvest profit
			var net_profit_min = self.revenue.min - self.cost;
			var net_profit_max = self.revenue.max - self.cost;
			self.profit.min = clean_zero(net_profit_min);
			self.profit.max = clean_zero(net_profit_max);
		}
	}
	
	Harvest.prototype.get_cost = function(locale){
		var value = clean_zero(this.cost);
		if (locale) return value.toLocaleString();
		return value;
	};
	
	Harvest.prototype.get_revenue = function(locale, max){
		var value = clean_zero(max ? this.revenue.max : this.revenue.min);
		if (locale) return value.toLocaleString();
		return value;
	};
	
	Harvest.prototype.get_profit = function(locale, max){
		var value = clean_zero(max ? this.profit.max : this.profit.min);
		if (locale) return value.toLocaleString();
		return value;
	};
	
	
	/****************
		Plan class - represents seeds planted on a date
	****************/
	function Plan(data, in_greenhouse){
		var self = this;
		self.date;
		self.crop_id;
		self.crop = {};
		self.amount = 1;
		self.fertilizer = planner.fertilizer["none"];
		self.waterRetentionChance = 0;
		self.seedCost = 0;
		self.fertilizerCost = 0;
		self.totalCost = 0;
		self.harvests = [];
		self.greenhouse = false;
		
		
		init();
		
		
		function init(){
			if (!data) return;
			self.date = data.date;
			self.crop = planner.crops[data.crop];
			self.amount = data.amount;
			if (data.fertilizer && planner.fertilizer[data.fertilizer])
				self.fertilizer = planner.fertilizer[data.fertilizer];
			var fert_effect = get_fertilizer_effect(self.fertilizer);
			self.waterRetentionChance = fert_effect.waterRetention || 0;
			var cost_breakdown = get_total_planting_cost(self.crop, self.fertilizer, self.amount);
			self.seedCost = cost_breakdown.seedCost;
			self.fertilizerCost = cost_breakdown.fertilizerCost;
			self.totalCost = cost_breakdown.totalCost;
			self.greenhouse = in_greenhouse ? true : false;
		}
	}
	
	// Compile data to be saved as JSON
	Plan.prototype.get_data = function(){
		var data = {};
		data.crop = this.crop.id;
		data.amount = this.amount;
		if (this.fertilizer && !this.fertilizer.is_none()) data.fertilizer = this.fertilizer.id;
		return data;
	};
	
	Plan.prototype.get_grow_time = function(){
		return get_growth_days_with_modifiers(this.crop, this.fertilizer, planner.player.profession);
	};
	
	Plan.prototype.get_display_cost = function(locale){
		var display_cost;
		if (typeof this.totalCost == "number" && !isNaN(this.totalCost)){
			display_cost = this.totalCost;
		} else {
			var breakdown = get_total_planting_cost(this.crop, this.fertilizer, this.amount);
			this.seedCost = breakdown.seedCost;
			this.fertilizerCost = breakdown.fertilizerCost;
			this.totalCost = breakdown.totalCost;
			display_cost = breakdown.totalCost;
		}
		
		if ((typeof display_cost != "number" || isNaN(display_cost)) && this.crop){
			var amount = parseInt(this.amount, 10);
			if (isNaN(amount) || amount < 1) amount = 1;
			display_cost = (Number(this.crop.seedCost) || 0) * amount;
		}
		
		if (typeof display_cost != "number" || isNaN(display_cost)){
			display_cost = 0;
		}
		
		display_cost = display_cost === 0 ? 0 : display_cost;
		display_cost = clean_zero(display_cost);
		if (locale) return display_cost.toLocaleString();
		return display_cost;
	};
	
	Plan.prototype.get_cost_breakdown = function(){
		var breakdown = get_total_planting_cost(this.crop, this.fertilizer, this.amount);
		this.seedCost = breakdown.seedCost;
		this.fertilizerCost = breakdown.fertilizerCost;
		this.totalCost = breakdown.totalCost;
		return breakdown;
	};
	
	Plan.prototype.get_cost = function(locale){
		return this.get_display_cost(locale);
	};
	
	Plan.prototype.get_revenue = function(locale, max){
		var amount = 0;
		for (var i = 0; i < this.harvests.length; i++){
			amount += max ? this.harvests[i].revenue.max : this.harvests[i].revenue.min;
		}
		amount = clean_zero(amount);
		if (locale) return amount.toLocaleString();
		return amount;
	};
	
	Plan.prototype.get_profit = function(locale, max){
		var amount = this.get_revenue(max) - this.get_cost();
		amount = clean_zero(amount);
		if (locale) return amount.toLocaleString();
		return amount;
	};
	
	
	/****************
		Fertilizer class - represents a type of fertilizer
	****************/
	function Fertilizer(data){
		var self = this;
		self.id;
		self.name;
		self.buy = 0;
		self.quality = [0, 0, 0]; // for quality-modifying fertilizers
		self.growth_rate = 0; // for growth-modifying fertilizers
		
		
		init();
		
		
		function init(){
			if (!data) return;
			self.id = data.id;
			self.name = data.name;
			self.buy = data.buy;
			if (data.quality) self.quality = data.quality;
			if (data.growth_rate) self.growth_rate = data.growth_rate;
		}
	}
	
	// Check if fertilizer is not being used ("none" type)
	Fertilizer.prototype.is_none = function(){
		return this.id == "none";
	};
	
	// Get fertilizer image
	Fertilizer.prototype.get_image = function(){
		if (this.is_none()) return;
		var normalized_name = normalize_fertilizer_image_name(this.name || this.id);
		if (fertilizerImageAliases[normalized_name]){
			normalized_name = fertilizerImageAliases[normalized_name];
		}
		return "images/fertilizer/" + normalized_name + ".png";
	};
	
	
	/****************
		Finance class - datatype for storing financial details of a day/season/year
	****************/
	function Finance(){
		var self = this;
		self.cost = 0;
		self.revenue = {min: 0, max: 0};
		self.profit = {min: 0, max: 0};
		
		self.plantings = 0; // planting count
		self.harvests = {min: 0, max: 0}; // harvest count
	}
	
	// Return cost value
	Finance.prototype.get_cost = function(locale){
		var value = clean_zero(this.cost);
		if (locale) return value.toLocaleString();
		return value;
	};
	
	// Return revenue value (min or max)
	Finance.prototype.get_revenue = function(locale, max){
		var value = clean_zero(max ? this.revenue.max : this.revenue.min);
		if (locale) return value.toLocaleString();
		return value;
	};
	
	// Return profit value (min or max)
	Finance.prototype.get_profit = function(locale, max){
		var value = clean_zero(max ? this.profit.max : this.profit.min);
		if (locale) return value.toLocaleString();
		return value;
	};
	
	// Return plantings count
	Finance.prototype.get_plantings = function(locale){
		if (locale) return this.plantings.toLocaleString();
		return this.plantings;
	};
	
	// Return harvests count (min or max)
	Finance.prototype.get_harvests = function(locale, max){
		var value = max ? this.harvests.max : this.harvests.min;
		if (locale) return value.toLocaleString();
		return value;
	};
	
	
	/****************
		Calendar Event class - event on the calendar
	****************/
	function CalendarEvent(data){
		var self = this;
		self.day;
		self.season;
		
		self.date;
		self.name = "";
		self.festival = false;
		
		
		init();
		
		
		function init(){
			if (!data) return;
			self.day = data.day;
			self.season = planner.seasons[data.season];
			
			self.date = (data.season * SEASON_DAYS) + self.day;
			self.name = data.name;
			self.festival = data.festival;
		}
	}
	
	// Get event image
	CalendarEvent.prototype.get_image = function(){
		if (this.festival) return "images/flag.gif";
		return "images/people/" + this.name.toLowerCase() + ".png";
	};
	
	// Get readable text of event
	CalendarEvent.prototype.get_text = function(){
		if (!this.festival) return this.name + "'s Birthday";
		return this.name;
	};
	
	
	/********************************
		RUN INITIALIZATION
	********************************/
	// Initialization runs last since Function.prototype methods
	// aren't hoisted
	init();
}

