// sinon-chrome defines chrome, but firefox uses browser
var browser = typeof chrome !== 'undefined' ? chrome : browser

// sinon-chrome does not get the manifest
browser.runtime = Object.assign({
	getManifest: () => ({
		"name": "Clean Links",
		"description": "Converts obfuscated/nested links to genuine clean links",
		"author": "Cimbali (maintainer), \nDiego Casorran (creator), \nEduard Braun (German translation), \nSimon Chan (Chinese and Taiwanese translations)",
		"version": "3.0.3",
		"homepage_url": "https://github.com/Cimbali/CleanLinks",
	}),
	getURL: (url) => ('/' + url.replace(/^\/+/, '')),
}, browser.runtime)
