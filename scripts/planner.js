/**
 * Compatibility shim for legacy script includes.
 *
 * The app now boots from scripts/app.js as an ES module.
 * Keeping this file lets old integrations still load the planner.
 */
(function(){
	if (window.__plannerModuleBootstrap) return;
	window.__plannerModuleBootstrap = true;
	
	var script = document.createElement("script");
	script.type = "module";
	script.src = "scripts/app.js";
	document.head.appendChild(script);
})();
