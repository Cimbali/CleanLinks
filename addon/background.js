/* ***** BEGIN LICENSE BLOCK *****
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/
 *
 * The Original Code is CleanLinks Mozilla Extension.
 *
 * The Initial Developer of the Original Code is
 * Copyright (C)2012 Diego Casorran <dcasorran@gmail.com>
 * All Rights Reserved.
 *
 * ***** END LICENSE BLOCK ***** */

'use strict'

function setIcon(marker, tab_id)
{
	browser.browserAction.setIcon(
	{
		path:
		{
			16: 'icons/16' + (marker || icon_default) + '.png',
			32: 'icons/32' + (marker || icon_default) + '.png'
		},
		tabId: tab_id
	})
}


// Count of clean links per page, reset it at every page load
let cleanedPerTab = {}
cleanedPerTab.get = tab_id =>
{
	if  (!(tab_id in cleanedPerTab))
		cleanedPerTab[tab_id] = {count: 0, history: []};
	return cleanedPerTab[tab_id];
}
cleanedPerTab.clear = tab_id => { delete cleanedPerTab[tab_id]; };
cleanedPerTab.getHistory = tab_id => cleanedPerTab.get(browser.tabs.TAB_ID_NONE).history.concat(cleanedPerTab.get(tab_id).history);
cleanedPerTab.getCount = tab_id => cleanedPerTab.get(tab_id).count;

// wrap the promise in an async function call, to catch a potential ReferenceError
let get_browser_version = (async () => await browser.runtime.getBrowserInfo())()
							.then(info => parseFloat(info.version)).catch(() => NaN)

// Links that are whitelisted just once (rudimentary)
let disabledTabs = []
let temporaryWhitelist = []

async function cleanRedirectHeaders(details)
{
	if (30 != parseInt(details.statusCode / 10) || 304 == details.statusCode)
		return {};

	var loc = details.responseHeaders.find(element => element.name.toLowerCase() == 'location')
	if (!loc || !loc.value)
		return {};

	var dest = new URL(loc.value, details.url).href, cleanDest = await cleanLink(dest, details.url);

	if (cleanDest == dest)
		return {};

	var cleaning_notif = { action: 'notify', url: cleanDest, orig: dest, type: 'header', tab_id: details.tabId };

	if (details.originUrl && cleanDest == new URL(details.originUrl).href ||
			details.originUrl != details.documentUrl && cleanDest == new URL(details.documentUrl).href)
	{
		/* Risking an infinite loop of redirects here.
		 * Try it once (i.e. it's not in history yet), but if we already tried then allow it. */
		if (cleanedPerTab.get(details.tabId).history.some(historic_message =>
			Object.keys(cleaning_notif).every(key => cleaning_notif[key] === historic_message[key])
		))
		{
			log('Avoiding circular redirect ' + dest + ' -> ' + details.originUrl);
			return {};
		}
	}

	handleMessage(cleaning_notif);
	return {redirectUrl: cleanDest};
}


async function onRequest(details)
{
	var dest = details.url, curLink = details.originUrl;

	if (!prefs.values.httpall && (details.frameId != 0 || typeof(details.documentUrl) !== 'undefined'))
		return {};
	else if (disabledTabs.indexOf(details.tabId) !== -1)
		return {}

	var urlpos = temporaryWhitelist.indexOf(dest);
	if (urlpos >= 0) {
		log('One-time whitelist for ' + JSON.stringify(dest));
		temporaryWhitelist.splice(urlpos, 1);
		return {};
	}

	var cleanDest = await cleanLink(dest, curLink);

	if (!cleanDest) return {};

	var origUrl = new URL(dest), cleanUrl = new URL(cleanDest);

	if (cleanUrl.href == origUrl.href)
		return {};


	var containsParentUrl;
	try
	{
		var curUrl = new URL(curLink);
		containsParentUrl = (cleanUrl.host + cleanUrl.pathname) === (curUrl.host + curUrl.pathname);
	} catch(e) {
		containsParentUrl = false;
	}

	for (let frame of details.frameAncestors)
		if (!containsParentUrl)
		{
			var parentUrl = new URL(frame.url);
			containsParentUrl = (cleanUrl.host + cleanUrl.pathname) === (parentUrl.host + parentUrl.pathname);
		}


	var cleaning_notif = { action: 'notify', url: cleanDest, orig: dest, tab_id: details.tabId };
	if (details.type != 'main_frame')
		cleaning_notif.type = 'request';

	// Prevent frame/script/etc. redirections back to top-level document (see 182e58e)
	if (containsParentUrl && details.type != 'main_frame')
	{
		handleMessage(Object.assign(cleaning_notif, {dropped: true}));
		return {cancel: true};
	}

	// Allowed requests when destination is self, to protect against infinite loops (see 42106fd).
	else if (cleanDest == curLink)
		return {}

	handleMessage(cleaning_notif);
	return {redirectUrl: cleanDest};
}


function handleMessage(message, sender)
{
	log('received message : ' + JSON.stringify(message))

	switch (message.action)
	{
	case 'cleaned list':
		return Promise.resolve(cleanedPerTab.getHistory(message.tab_id));

	case 'check tab enabled':
		return Promise.resolve({enabled: disabledTabs.indexOf(message.tab_id) === -1});

	case 'notify':
		if (!('tab_id' in message))
			message['tab_id'] = 'tab' in sender ? sender.tab.id : browser.tabs.TAB_ID_NONE;
		else if (message.tab_id == -1)
			message.tab_id = browser.tabs.TAB_ID_NONE;

		if (prefs.values.cltrack)
		{
			var hist = cleanedPerTab.get(message.tab_id).history;
			hist.push(Object.assign({}, message));
			if (hist.length > 100)
				hist.splice(0, hist.length - 100);
		}

		cleanedPerTab.get(message.tab_id).count += 1;

		browser.browserAction.setBadgeText({tabId: message.tab_id, text: '' + cleanedPerTab.getCount(message.tab_id)});

		return Promise.resolve(null);;

	case 'open bypass':
		log('Adding to one-time whitelist ' + message.link);
		temporaryWhitelist.push(message.link);

	case 'open url':
		if (message.target == new_window)
			return browser.windows.create({ url: message.link });
		else if (message.target == new_tab)
		{
			return get_browser_version.then(v =>
				browser.tabs.create(Object.assign({ url: message.link, active: prefs.values.switchToTab },
												  isNaN(v) || v < 57 ? {} : { openerTabId: sender.tab.id })))
		}
		else
			return browser.tabs.update({ url: message.link });

	case 'whitelist':
		var nonHist = cleanedPerTab.get(browser.tabs.TAB_ID_NONE).history;
		var tabHist = cleanedPerTab.get(message.tab_id).history;
		if (message.item >= nonHist.length)
			var entry = tabHist.splice(message.item - nonHist.length, 1)[0];
		else
			var entry = nonHist.splice(message.item, 1)[0];

		var host = (new URL(entry.orig)).host;
		if (prefs.values.skipdoms.indexOf(host) === -1)
		{
			prefs.values.skipdoms.push(host);
			return browser.storage.local.set({configuration: prefs.serialize()()})
		}
		else
			return Promise.resolve(null)

	case 'clearlist':
		cleanedPerTab.clear(message.tab_id);
		browser.browserAction.setBadgeText({tabId: message.tab_id, text: null});
		return Promise.resolve(null);

	case 'toggle':
		let pos = disabledTabs.indexOf(message.tab_id);
		if (pos === -1)
		{
			disabledTabs.push(message.tab_id)
			setIcon(icon_disabled, message.tab_id);
		}
		else
		{
			disabledTabs.splice(pos, 1)
			setIcon(icon_default, message.tab_id);
		}

		return browser.tabs.sendMessage(message.tab_id, {action: 'toggle', enabled: pos === -1}).catch(() => {})

	case 'options':
		let oldPrefValues = Object.assign({}, prefs.values);

		return prefs.load().then(() =>
		{
			if (!prefs.values.cltrack) {
				for (let key of cleanedPerTab)
					if (typeof cleanedPerTab[key] !== 'function')
						cleanedPerTab.clear(key);
			}

			// For each preference that requires action on change, get changes.pref = 1 if enabled, 0 unchanged, -1 disabled
			let changes = {}
			for (let prop of ['cbc', 'progltr', 'httpall', 'textcl'])
				changes[prop] = (prefs.values[prop] === true ? 1 : 0) - (oldPrefValues[prop] === true ? 1 : 0)

			if (changes.cbc > 0)
				browser.contextMenus.create(
				{
					id: 'copy-clean-link',
					title: 'Copy clean link',
					contexts: prefs.values.textcl ? ['link', 'selection', 'page'] : ['link']
				});
			else if (changes.cbc < 0)
				browser.contextMenus.remove('copy-clean-link')
			else if (changes.textcl != 0)
				browser.contextMenus.update('copy-clean-link',
				{
					title: 'Copy clean link',
					contexts: prefs.values.textcl ? ['link', 'selection', 'page'] : ['link']
				});

			if (changes.progltr > 0)
				browser.webRequest.onHeadersReceived.addListener(cleanRedirectHeaders, {urls: ['<all_urls>']},
																 ['blocking', 'responseHeaders']);
			else if (changes.progltr < 0)
				browser.webRequest.onHeadersReceived.removeListener(cleanRedirectHeaders);

			browser.tabs.query({}).then(tabs => tabs.forEach(tab =>
				browser.tabs.sendMessage(tab.id, {action: 'reload options'}).catch(() => {})
			));
		})

	default:
		return Promise.reject('Unexpected message: ' + String(message));
	}
}

browser.runtime.onMessage.addListener(handleMessage);
browser.browserAction.setBadgeBackgroundColor({color: '#666666'});
browser.browserAction.setBadgeTextColor({color: '#FFFFFF'});

prefs.load().then(() =>
{
	browser.webRequest.onBeforeRequest.addListener(onRequest, { urls: ['<all_urls>'] }, ['blocking']);

	// Always add the listener, even if CleanLinks is disabled. Only add the menu item on enabled.
	browser.contextMenus.onClicked.addListener((info, tab) =>
	{
		var link;
		if ('linkUrl' in info && info.linkUrl)
			link = info.linkUrl;
		else if ('selectionText' in info && info.selectionText)
			link = info.selectionText;

		// Clean & copy
		link = extractJavascriptLink(link, tab.url) || link;
		cleanLink(link, tab.url).then(cleanUrl => navigator.clipboard.writeText(cleanUrl))
	});

	if (prefs.values.progltr)
		browser.webRequest.onHeadersReceived.addListener(cleanRedirectHeaders, { urls: ['<all_urls>'] }, ['blocking', 'responseHeaders']);

	if (prefs.values.cbc)
		browser.contextMenus.create({
			id: 'copy-clean-link',
			title: 'Copy clean link',
			contexts: prefs.values.textcl ? ['link', 'selection', 'page'] : ['link']
		});

	// Auto update badge text for pages when loading is complete
	browser.tabs.onUpdated.addListener((id, changeInfo, tab) => {
		if (cleanedPerTab.getCount(tab.id))
			browser.browserAction.setBadgeText({tabId: id, text: '' + cleanedPerTab.getCount(tab.id)});
	});

	browser.tabs.onRemoved.addListener((id, removeInfo) => {
		cleanedPerTab.clear(id);
		let pos = disabledTabs.indexOf(id);
		if (pos !== -1)
			disabledTabs.splice(pos, 1)
	});
});
console.log('Done loading background.js')
