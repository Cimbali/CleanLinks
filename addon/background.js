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


function setIcon(marker)
{
	if (marker == '~')
		marker = 0;

	browser.browserAction.setIcon(
	{
		path:
		{
			16: 'icons/16' + (marker || icon_default) + '.png',
			32: 'icons/32' + (marker || icon_default) + '.png'
		}
	})
}


// Count of clean links per page, reset it at every page load
var cleanedPerTab = {}
cleanedPerTab.get = tab_id =>
{
	if  (!(tab_id in cleanedPerTab))
		cleanedPerTab[tab_id] = {count: 0, history: []};
	return cleanedPerTab[tab_id];
}
cleanedPerTab.clear = tab_id => { delete cleanedPerTab[tab_id]; };
cleanedPerTab.getHistory = tab_id => cleanedPerTab.get(browser.tabs.TAB_ID_NONE).history.concat(cleanedPerTab.get(tab_id).history);
cleanedPerTab.getCount = tab_id => cleanedPerTab.get(tab_id).count;

var lastRightClick = {textLink: null, reply: () => {}}

// wrap the promise in an async function call, to catch a potential ReferenceError
var get_browser_version = (async () => await browser.runtime.getBrowserInfo())()
							.then(info => parseFloat(info.version)).catch(() => NaN)


function cleanRedirectHeaders(details)
{
	if (30 != parseInt(details.statusCode / 10) || 304 == details.statusCode)
		return {};

	var loc = details.responseHeaders.find(element => element.name.toLowerCase() == 'location')
	if (!loc || !loc.value)
		return {};

	var dest = loc.value, cleanDest = cleanLink(dest, details.url);

	/* NB.  XUL code seemed to mark redirected requests, due to infinite redirections on *.cox.net,
	 * see #13 & 8c280b7. However it is not clear whether this is necessary nor how to do this in webexts.
	 *
	 * NB2. XUL code also protected against "The page isn't redirecting properly" errors with the following:

	if (cleanDest != details.url)
		return {}
	*/

	if (cleanDest == dest)
		return {};

	handleMessage({ action: 'notify', url: cleanDest, orig: dest, type: 'header', tab_id: details.tabId });
	return {redirectUrl: cleanDest};
}


function onRequest(details)
{
	var dest = details.url, curLink = details.originUrl, cleanDest = cleanLink(dest, curLink), same_domain = false

	if (!cleanDest || cleanDest == dest)
		return {};

	try
	{
		same_domain = (new URL(cleanDest).domain == new URL(curLink).domain);
	} catch(e) {}

	// Prevent frame/script/etc. redirections back to top-level document (see 182e58e)
	if (same_domain && details.type != 'main_frame')
	{
		handleMessage({ action: 'notify', url: cleanDest, orig: dest, dropped: true, type: 'request', tab_id: details.tabId });
		return {cancel: true};
	}

	// Allowed requests when destination is self, to protect against infinite loops (see 42106fd).
	else if (cleanDest == curLink)
		return {}

	handleMessage({ action: 'notify', url: cleanDest, orig: dest, tab_id: details.tabId });
	return {redirectUrl: cleanDest};
}


function handleMessage(message, sender)
{
	log('received message :', JSON.stringify(message))

	switch (message.action)
	{
	case 'cleaned list':
		return Promise.resolve(cleanedPerTab.getHistory(message.tab_id));

	case 'notify':
		var p;
		if (prefValues.notifications)
		{
			p = browser.notifications.create(message.url,
			{
				type: 'basic',
				iconUrl: browser.extension.getURL('icon.png'),
				title: 'Link cleaned!',
				message: message.url
			});
			browser.alarms.create('clearNotification:' + message.url, {when: Date.now() + prefValues.notiftime});
		}
		else
			p = Promise.resolve(null);

		if (!('tab_id' in message))
			message['tab_id'] = 'tab' in sender ? sender.tab.id : browser.tabs.TAB_ID_NONE;
		else if (message.tab_id == -1)
			message.tab_id = browser.tabs.TAB_ID_NONE;

		if (prefValues.cltrack)
		{
			var hist = cleanedPerTab.get(message.tab_id).history;
			hist.push(Object.assign({}, message));
			if (hist.length > 100)
				hist.splice(0, hist.length - 100);
		}

		cleanedPerTab.get(message.tab_id).count += 1;

		browser.browserAction.setBadgeText({tabId: message.tab_id, text: '' + cleanedPerTab.getCount(message.tab_id)});

		return p;

	case 'open url':
		if (message.target == new_window)
			return browser.windows.create({ url: message.link });
		else if (message.target == new_tab)
		{
			return get_browser_version.then(v =>
				browser.tabs.create(Object.assign({ url: message.link, active: prefValues.switchToTab },
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

		var host = (new URL(entry.orig)).hostname;
		if (prefValues.skipdoms.indexOf(host) === -1)
		{
			prefValues.skipdoms.push(host);
			return browser.storage.local.set({configuration: serializeOptions()})
		}
		else
			return Promise.resolve(null)

	case 'clearlist':
		cleanedPerTab.clear(message.tab_id);
		browser.browserAction.setBadgeText({tabId: message.tab_id, text: null});
		return Promise.resolve(null);

	case 'options':
	case 'toggle':
		var oldPrefValues = Object.assign({}, prefValues);

		if (message.action == 'toggle')
		{
			prefValues.enabled = !prefValues.enabled;

			setIcon(prefValues.enabled ? icon_default : icon_disabled);
			var p = browser.storage.local.set({configuration: serializeOptions()});
		}
		else
			var p = loadOptions();

		return p.then(() =>
		{
			if (!prefValues.cltrack) {
				for (var key in cleanedPerTab)
					if (typeof cleanedPerTab[key] !== 'function')
						cleanedPerTab.clear(key);
			}

			// For each preference that requires action on change, get changes.pref = 1 if enabled, 0 unchanged, -1 disabled
			var changes = ['cbc', 'progltr', 'httpomr', 'textcl'].reduce((dict, prop) =>
				Object.assign(dict, {[prop]: (prefValues.enabled && prefValues[prop] === true ? 1 : 0)
										- (oldPrefValues.enabled && oldPrefValues[prop] === true ? 1 : 0)})
			, {});

			if (changes.cbc > 0)
				browser.contextMenus.create({
					id: 'copy-clean-link',
					title: 'Copy clean link',
					contexts: prefValues.textcl ? ['link', 'selection', 'page'] : ['link']
				});
			else if (changes.cbc < 0)
				browser.contextMenus.remove('copy-clean-link')
			else if (changes.textcl != 0)
				browser.contextMenus.update('copy-clean-link',
				{
					title: 'Copy clean link',
					contexts: prefValues.textcl ? ['link', 'selection', 'page'] : ['link']
				});

			if (changes.progltr > 0)
				browser.webRequest.onHeadersReceived.addListener(cleanRedirectHeaders, { urls: ['<all_urls>'] }, ['blocking', 'responseHeaders']);
			else if (changes.progltr < 0)
				browser.webRequest.onHeadersReceived.removeListener(cleanRedirectHeaders);

			if (changes.httpomr > 0)
				browser.webRequest.onBeforeRequest.addListener(onRequest, { urls: ['<all_urls>'] }, ['blocking']);
			else if (changes.httpomr < 0)
				browser.webRequest.onBeforeRequest.removeListener(onRequest);

			browser.tabs.query({}).then(tabs => tabs.forEach(tab =>
				browser.tabs.sendMessage(tab.id, {action: 'reload options'}).catch(() => {})
			));
		})

	case 'right click':
		return new Promise((resolve, rejecte) =>
		{
			lastRightClick = {
				textLink: message.link,
				reply: resolve
			}
		})

	default:
		return Promise.reject('Unexpected message: ' + String(message));
	}
}

function handleAlarm(alarm)
{
	if (alarm.name.startsWith('clearNotification:')) {
		var notif = alarm.name.substr('clearNotification:'.length);
		browser.notifications.clear(notif);
	}
}


browser.alarms.onAlarm.addListener(handleAlarm);
browser.runtime.onMessage.addListener(handleMessage);
browser.browserAction.setBadgeBackgroundColor({color: 'rgba(0, 0, 0, 0)'});

loadOptions().then(() =>
{
	// Always add the listener, even if CleanLinks is disabled. Only add the menu item on enabled.
	browser.contextMenus.onClicked.addListener((info, tab) =>
	{
		var link;
		if ('linkUrl' in info && info.linkUrl)
			link = info.linkUrl;
		else if ('selectionText' in info && info.selectionText)
			link = info.selectionText;

		// WARNING: potential race condition here (?) on right click we send a message to background,
		// that populates rightClickLink[tab.id]. If the option (this listener) is triggered really fast,
		// maybe it can happen before the link message gets here.
		// In that case, we'll need to pre-make a promise, resolved by the message, and .then() it here.
		else if (prefValues.textcl)
			link = lastRightClick.textLink;

		// Clean & copy
		lastRightClick.reply(cleanLink(link, tab.url))
	});

	if (!prefValues.enabled)
	{
		setIcon(icon_disabled);
		return;
	}

	if (prefValues.httpomr)
		browser.webRequest.onBeforeRequest.addListener(onRequest, { urls: ['<all_urls>'] }, ['blocking']);

	if (prefValues.progltr)
		browser.webRequest.onHeadersReceived.addListener(cleanRedirectHeaders, { urls: ['<all_urls>'] }, ['blocking', 'responseHeaders']);

	if (prefValues.cbc)
		browser.contextMenus.create({
			id: 'copy-clean-link',
			title: 'Copy clean link',
			contexts: prefValues.textcl ? ['link', 'selection', 'page'] : ['link']
		});

	// Auto update badge text for pages when loading is complete
	browser.tabs.onUpdated.addListener((id, changeInfo, tab) => {
		if (cleanedPerTab.getCount(tab.id))
			browser.browserAction.setBadgeText({tabId: id, text: '' + cleanedPerTab.getCount(tab.id)});
	});

	browser.tabs.onRemoved.addListener((id, removeInfo) => {
		cleanedPerTab.clear(id);
	});
});
