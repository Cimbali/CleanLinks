'use strict';

// sinon-chrome defines chrome, but firefox uses browser
const browser = typeof chrome !== 'undefined' ? chrome : browser

// sinon-chrome does not get the manifest
browser.runtime = Object.assign({
	getManifest: () => ({
		"name": "Clean Links",
		"description": "Converts obfuscated/nested links to genuine clean links",
		"author": "Cimbali (maintainer), \nDiego Casorran (historic creator), \nEduard Braun (German translation), \nSimon Chan (Chinese and Taiwanese translations)",
		"version": "tests",
		"homepage_url": "https://github.com/Cimbali/CleanLinks",
	}),
	getURL: url => ('/' + url.replace(/^\/+/, '')),
	onMessage: {addListener: () => {}}
}, browser.runtime)

// sinon-chrome also does not handle storage
browser.storage.sync = browser.storage.local = {
	contents: {},
	get: function(keys)
	{
		let key_filter = () => true, defaults = {};

		if (keys === null || keys === undefined)
			;
		else if (Array.isArray(keys))
			key_filter = keys.includes
		else if (typeof keys === 'string')
			key_filter = candidate => candidate === keys
		else if (typeof keys === 'object')
		{
			key_filter = candidate => candidate in keys
			defaults = {...keys};
		}
		else
			return Promise.reject('Unknown type of key ' + keys)

		let result = Object.entries(this.contents).filter(pair => key_filter(pair[0]))
												 .reduce((obj, pair) => ({...obj, [pair[0]]: JSON.parse(pair[1])}),
														 defaults);
		return Promise.resolve(result);
	},
	set: function(keys)
	{
		try
		{
			for (let [key, val] of Object.entries(keys))
				this.contents[key] = JSON.stringify(val)
		}
		catch(e)
		{
			return Promise.reject(e);
		}
		console.log('Save OK')
		return Promise.resolve();
	},
	remove: function(keys)
	{
		if (typeof keys === 'string')
			delete this.contents[keys];
		else if (Array.isArray(keys))
			for (let key of keys)
			{
				if (typeof key === 'string')
					delete this.contents[key];
				else
					Promise.reject('Unexpected key type in array ' + key)
			}
		else
			Promise.reject('Unexpected key type ' + keys)

		return Promise.resolve()
	}
}
