import { initPlannerApp } from "./ui/planner-ui.js";
import { loadData } from "./data/data-loader.js";

/**
 * Module entrypoint for browser startup.
 * Registers AngularJS controller and wires module-level dependencies.
 * @returns {Promise<void>}
 */
export async function startPlannerApp(){
	try {
		initPlannerApp({
			angularRef: window.angular,
			$: window.jQuery,
			loadData: loadData
		});
	} catch (err){
		console.error("Failed to load data", err);
	}
}

startPlannerApp();
