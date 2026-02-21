/**
 * @typedef {Object} PlannerState
 * @property {Object[]} years
 * @property {Object[]} cropsList
 * @property {Object<string, Object>} cropsById
 * @property {Object<string, Object>} eventsByDate
 * @property {{profession: string, farmingLevel: number}} playerSettings
 * @property {"farm"|"greenhouse"} currentMode
 * @property {number} currentSeasonIndex
 * @property {number} currentYearIndex
 */

/**
 * Create a centralized planner state object with explicit mutation helpers.
 * @param {Partial<PlannerState>} [initialState]
 * @returns {{
 *   getState: () => PlannerState,
 *   get: (key: keyof PlannerState) => any,
 *   set: (key: keyof PlannerState, value: any) => any,
 *   patch: (partial: Partial<PlannerState>) => PlannerState,
 *   reset: (nextState?: Partial<PlannerState>) => PlannerState
 * }}
 */
export function createPlannerState(initialState){
	const defaults = {
		years: [],
		cropsList: [],
		cropsById: {},
		eventsByDate: {},
		playerSettings: {
			profession: "none",
			farmingLevel: 0
		},
		currentMode: "farm",
		currentSeasonIndex: 0,
		currentYearIndex: 0
	};
	
	let plannerState = Object.assign({}, defaults, initialState || {});
	
	return {
		getState: function(){
			return plannerState;
		},
		get: function(key){
			return plannerState[key];
		},
		set: function(key, value){
			plannerState[key] = value;
			return value;
		},
		patch: function(partial){
			plannerState = Object.assign({}, plannerState, partial || {});
			return plannerState;
		},
		reset: function(nextState){
			plannerState = Object.assign({}, defaults, nextState || {});
			return plannerState;
		}
	};
}
