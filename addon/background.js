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
var cleanedInSession = 0;
var historyCleanedLinks = [];
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

	handleMessage({ action: 'notify', url: cleanDest, orig: dest, type: 'header' });
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
		handleMessage({ action: 'notify', url: cleanDest, orig: dest, dropped: true, type: 'request' });
		return {cancel: true};
	}

	// Allowed requests when destination is self, to protect against infinite loops (see 42106fd).
	else if (cleanDest == curLink)
		return {}

	handleMessage({ action: 'notify', url: cleanDest, orig: dest });
	return {redirectUrl: cleanDest};
}


function handleMessage(message, sender)
{
	log('received message :', JSON.stringify(message))

	if (message.action == 'cleaned list')
	{
		return Promise.resolve(historyCleanedLinks);
	}

	else if (message.action == 'notify')
	{
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

		if (prefValues.cltrack)
		{
			historyCleanedLinks.push(Object.assign({}, message));
			if (historyCleanedLinks.length > 100)
				historyCleanedLinks.splice(0, historyCleanedLinks.length - 100);
		}

		cleanedInSession += 1;
		browser.browserAction.setBadgeText({text: '' + cleanedInSession});

		return p;
	}

	else if (message.action == 'open url')
	{
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
	}

	else if (message.action == 'whitelist')
	{
		var entry = historyCleanedLinks.splice(message.item, 1)[0];
		var host = (new URL(entry.orig)).hostname;
		if (prefValues.skipdoms.indexOf(host) === -1)
		{
			prefValues.skipdoms.push(host);
			return browser.storage.local.set({configuration: serializeOptions()})
		}
		else
			return Promise.resolve(null)
	}

	else if (message.action == 'options' || message.action == 'toggle')
	{
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
			if (!prefValues.cltrack)
				historyCleanedLinks.splice(0, historyCleanedLinks.length);

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
	}

	else if (message.action == 'right click')
	{
		return new Promise((resolve, rejecte) =>
		{
			lastRightClick = {
				textLink: message.link,
				reply: resolve
			}
		})
	}
	else
		return Promise.reject('Unexpected message: ' + String(message));
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
});