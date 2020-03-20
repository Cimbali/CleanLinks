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

// Count of clean links per page, reset it at every page load
const cleaned_per_tab = {
	get: tab_id =>
	{
		if  (!(tab_id in cleaned_per_tab))
			cleaned_per_tab[tab_id] = {count: 0, history: [], pending_highlight: null};
		return cleaned_per_tab[tab_id];
	},
	clear: tab_id => { delete cleaned_per_tab[tab_id]; },
	get_history: tab_id => cleaned_per_tab.get(browser.tabs.TAB_ID_NONE).history.concat(cleaned_per_tab.get(tab_id).history),
	get_count: tab_id => cleaned_per_tab.get(tab_id).count,
}

const disabled_tabs = []

disabled_tabs.is_enabled = tab => disabled_tabs.indexOf(tab) === -1
disabled_tabs.is_disabled = tab => disabled_tabs.indexOf(tab) !== -1
disabled_tabs.remove = tab => disabled_tabs.splice(disabled_tabs.indexOf(tab), 1)

// Links that are whitelisted just once (rudimentary)
const temporary_whitelist = []

let prepopulate_link = undefined;


let android = null;
let browser_version = null;


function load_metadata()
{
	return [browser.runtime.getPlatformInfo().then(info => { android = info.os === 'android' }),
			browser.runtime.getBrowserInfo().then(info => { browser_version = parseFloat(info.version); })
											 .catch(() => { browser_version = NaN; }),
	];
}


function update_action(tab_id)
{
	const enabled = disabled_tabs.is_enabled(tab_id), clean_count = cleaned_per_tab.get_count(tab_id);
	let badge_text = null, badge_title = title;

	if (!enabled)
		badge_title += ' (off)';

	else if (Prefs.values.show_clean_count)
	{
		badge_title += ` (${clean_count})`
		if (clean_count)
			badge_text = '' + clean_count;
	}

	browser.browserAction.setTitle({tabId: tab_id, title: badge_title});

	if (android)
	{
		log('Setting popup for tab', tab_id, 'to', browser.runtime.getURL(`/pages/popup.html?tab=${tab_id}`))
		browser.browserAction.setPopup({tabId: tab_id, popup: browser.runtime.getURL(`/pages/popup.html?tab=${tab_id}`)});
		return;
	}

	// on desktop only
	browser.browserAction.setBadgeText({tabId: tab_id, text: badge_text});
	browser.browserAction.setIcon(
	{
		path:
		{
			16: 'icons/16' + (enabled ? '' : '-off') + '.png',
			32: 'icons/32' + (enabled ? '' : '-off') + '.png'
		},
		tabId: tab_id
	})
}


function clean_redirect_headers(details)
{
	if (30 != parseInt(details.statusCode / 10) || 304 == details.statusCode)
		return {};

	let loc = details.responseHeaders.find(element => element.name.toLowerCase() == 'location')
	if (!loc || !loc.value)
		return {};

	if (disabled_tabs.is_disabled(details.tabId))
		return {}

	let dest = new URL(loc.value, details.url).href, clean_dest = clean_link(dest, details.url);

	if (clean_dest == dest)
		return {};

	let cleaning_notif = { action: 'notify', url: clean_dest, orig: dest, type: 'header', tab_id: details.tabId };

	if (details.originUrl && clean_dest == new URL(details.originUrl).href ||
			details.originUrl != details.documentUrl && clean_dest == new URL(details.documentUrl).href)
	{
		/* Risking an infinite loop of redirects here.
		 * Try it once (i.e. it's not in history yet), but if we already tried then allow it. */
		if (cleaned_per_tab.get(details.tabId).history.some(historic_message =>
			Object.keys(cleaning_notif).every(key => cleaning_notif[key] === historic_message[key])
		))
		{
			log('Avoiding circular redirect ' + dest + ' -> ' + details.originUrl);
			return {};
		}
	}

	handle_message(cleaning_notif);
	return {redirectUrl: clean_dest};
}


function on_request(details)
{
	let dest = details.url, current_page = details.originUrl;

	if (!Prefs.values.httpall && (details.frameId !== 0 || typeof details.documentUrl !== 'undefined'))
	{
		log('Disabled CleanLinks for tab ' + details.tabId);
		return {};
	}

	else if (disabled_tabs.is_disabled(details.tabId))
	{
		log('Disabled CleanLinks for tab ' + details.tabId);
		return {}
	}

	let urlpos = temporary_whitelist.indexOf(dest);
	if (urlpos >= 0)
	{
		log('One-time whitelist for ' + JSON.stringify(dest));
		temporary_whitelist.splice(urlpos, 1);
		return {};
	}

	let clean_dest = clean_link(dest, current_page);

	if (!clean_dest || clean_dest === dest)
		return {};

	let clean_url = new URL(clean_dest), contains_parent_url = false;
	try
	{
		let current_url = new URL(current_page);
		contains_parent_url = (clean_url.host + clean_url.pathname) === (current_url.host + current_url.pathname);
	} catch(e) {
		contains_parent_url = false;
	}

	for (let frame of details.frameAncestors)
		if (!contains_parent_url)
		{
			let parent_url = new URL(frame.url);
			contains_parent_url = (clean_url.host + clean_url.pathname) === (parent_url.host + parent_url.pathname);
		}


	let cleaning_notif = { action: 'notify', url: clean_dest, orig: dest, tab_id: details.tabId };
	if (details.type === 'main_frame')
		cleaning_notif.type = 'clicked';
	// Google opens some-tab redirects in an iframe in the current document, so simple redirection is not enough.
	// We need to cancel this request and direct the current tab to the cleaned destination URL.
	else if (dest.match(/^https:\/\/www.google.[a-z.]+\/url\?/))
		cleaning_notif.type = 'promoted';
	else
		cleaning_notif.type = 'request';

	// Prevent frame/script/etc. redirections back to top-level document (see 182e58e)
	if (contains_parent_url && details.type != 'main_frame')
	{
		handle_message({dropped: true, ...cleaning_notif});
		return {cancel: true};
	}

	// Allowed requests when destination is self, to protect against infinite loops (see 42106fd).
	else if (clean_dest == current_page)
		return {}


	handle_message(cleaning_notif);

	if (cleaning_notif.type === 'promoted')
	{
		handle_message({
			action: 'open url',
			link: clean_dest,
			target: same_tab,
			tab_id: details.tabId
		})
		return {cancel: true}
	}
	else
		return {redirectUrl: clean_dest};
}


function handle_message(message, sender)
{
	log('received message', message)

	let tab_id = browser.tabs.TAB_ID_NONE;
	if ('tab_id' in message)
		tab_id = message.tab_id;
	else if ('tab' in sender)
		tab_id = sender.tab.id;

	switch (message.action)
	{
	case 'cleaned list':
		return Promise.resolve(cleaned_per_tab.get_history(tab_id));

	case 'highlight':
		if (Prefs.values.highlight)
			cleaned_per_tab.get(tab_id).pending_highlight = message.link;
		return Promise.resolve({});

	case 'check tab enabled':
		return Promise.resolve({enabled: disabled_tabs.is_enabled(tab_id)});

	case 'notify':
		if (Prefs.values.cltrack)
		{
			let hist = cleaned_per_tab.get(tab_id).history;
			hist.push(Object.assign({}, message));
			if (hist.length > 100)
				hist.splice(0, hist.length - 100);
		}

		cleaned_per_tab.get(tab_id).count += 1;

		if (Prefs.values.show_clean_count && tab_id !== -1)
			update_action(tab_id);

		if (Prefs.values.highlight && tab_id !== -1)
		{
			let orig_tab = tab_id;
			if (cleaned_per_tab.get(orig_tab).pending_highlight !== message.orig)
				[orig_tab, ] = Object.entries(cleaned_per_tab).find(pair => typeof pair[1] !== 'function' && pair[1].pending_highlight === message.orig) || [];

			if (orig_tab !== undefined)
			{
				cleaned_per_tab.get(orig_tab).pending_highlight = null;
				return browser.tabs.sendMessage(parseInt(orig_tab), {action: 'highlight'}).catch(() => {})
			}
		}

		return Promise.resolve({});

	case 'open bypass':
		temporary_whitelist.push(message.link);
		return Promise.resolve({});

	case 'open url':
		if (message.target == new_window)
			return browser.windows.create({ url: message.link });
		else if (message.target == new_tab)
		{
			return get_browser_version.then(v =>
				browser.tabs.create(Object.assign({ url: message.link, active: Prefs.values.switch_to_tab },
												  isNaN(v) || v < 57 ? {} : { openerTabId: tab_id })))
		}
		else
			return browser.tabs.update(tab_id, { url: message.link });

	case 'clearlist':
		cleaned_per_tab.clear(tab_id);
		browser.browserAction.setBadgeText({tabId: tab_id, text: null});
		return Promise.resolve(null);

	case 'toggle':
		if (disabled_tabs.is_enabled(tab_id))
			disabled_tabs.push(tab_id)
		else
			disabled_tabs.remove(tab_id)

		update_action(tab_id);

		return browser.tabs.sendMessage(tab_id, {action: 'toggle', enabled: disabled_tabs.is_enabled(tab_id)}).catch(() => {})

	case 'options':
		let old_pref_values = {...Prefs.values};

		return Prefs.reload().then(() =>
		{
			if (!Prefs.values.cltrack)
			{
				for (const [key, val] of Object.entries(cleaned_per_tab))
					if (typeof val !== 'function')
						cleaned_per_tab.clear(key);
			}

			// For each preference that requires action on change, get changes.pref = 1 if enabled, 0 unchanged, -1 disabled
			let changes = {}
			for (let prop of ['context_menu', 'progltr', 'httpall', 'textcl', 'show_clean_count'])
				changes[prop] = (Prefs.values[prop] === true ? 1 : 0) - (old_pref_values[prop] === true ? 1 : 0)

			if (changes.context_menu > 0)
				browser.contextMenus.create(
				{
					id: 'copy-clean-link',
					title: 'Copy clean link',
					contexts: Prefs.values.textcl ? ['link', 'selection'] : ['link']
				});
			else if (changes.context_menu < 0)
				browser.contextMenus.remove('copy-clean-link')
			else if (changes.textcl != 0)
				browser.contextMenus.update('copy-clean-link',
				{
					title: 'Copy clean link',
					contexts: Prefs.values.textcl ? ['link', 'selection'] : ['link']
				});

			if (changes.progltr > 0)
				browser.webRequest.onHeadersReceived.addListener(clean_redirect_headers, {urls: ['<all_urls>']},
																 ['blocking', 'responseHeaders']);
			else if (changes.progltr < 0)
				browser.webRequest.onHeadersReceived.removeListener(clean_redirect_headers);

			browser.tabs.query({}).then(tabs =>
			{
				for (let tab of tabs)
				{
					browser.tabs.sendMessage(tab.id, {action: 'reload options'}).catch(() => {})

					if (changes.show_cleaned_count !== 0)
						update_action(tab.id);
				}
			});
		})

	case 'rules':
		return Rules.reload()

	case 'set prepopulate':
		return Promise.resolve(prepopulate_link = message.link);

	case 'get prepopulate':
		if (prepopulate_link)
		{
			let link = prepopulate_link;
			prepopulate_link = undefined;
			return Promise.resolve({link: link});
		}
		else
			return Promise.resolve({})

	default:
		return Promise.reject('Unexpected message: ' + String(message));
	}
}


Promise.all([Prefs.loaded, Rules.loaded, ...load_metadata()]).then(() =>
{
	browser.runtime.onMessage.addListener(handle_message);
	browser.webRequest.onBeforeRequest.addListener(on_request, { urls: ['<all_urls>'] }, ['blocking']);

	if (Prefs.values.progltr)
		browser.webRequest.onHeadersReceived.addListener(clean_redirect_headers, { urls: ['<all_urls>'] }, ['blocking', 'responseHeaders']);

	// Auto update badge text for pages when loading is complete
	browser.tabs.onCreated.addListener(info => { update_action(info.id); });
	browser.tabs.onUpdated.addListener(update_action);

	browser.tabs.onRemoved.addListener((id, remove_info) =>
	{
		cleaned_per_tab.clear(id);
		if (disabled_tabs.is_disabled(id))
			disabled_tabs.remove(id);
	});


	if (android)
		return;

	browser.browserAction.setBadgeBackgroundColor({color: '#666666'});
	browser.browserAction.setBadgeTextColor({color: '#FFFFFF'});

	// Always add the listener, even if CleanLinks is disabled. Only add the menu item on enabled.
	browser.contextMenus.onClicked.addListener((info, tab) =>
	{
		let link;
		if ('linkUrl' in info && info.linkUrl)
			link = info.linkUrl;
		else if ('selectionText' in info && info.selectionText)
			link = info.selectionText;

		// Clean & copy
		let clean_url = clean_link(extract_javascript_link(link, tab.url) || link, tab.url);
		navigator.clipboard.writeText(clean_url);
	});

	if (Prefs.values.context_menu)
		browser.contextMenus.create({
			id: 'copy-clean-link',
			title: 'Copy clean link',
			contexts: Prefs.values.textcl ? ['link', 'selection'] : ['link']
		});
});


function import_domain_whitelist(domains_list)
{
	return promise.then(async rules =>
	{
		let actions = {whitelist: ['.*'], whitelist_path: true};

		for (let fqdn of domains_list)
			await Rules.add({domain: fqdn, ...actions})
	});
};


async function upgrade_options(prev_version)
{
	let num_prev_version = prev_version.split('.').map(s => parseInt(s))
	const options = (await browser.storage.sync.get({'configuration': {}})).configuration;

	for (let [rename, newname] of Object.entries({'httpomr': 'httpall', 'switchToTab': 'switch_to_tab', 'cbc': 'context_menu'}))
		if (rename in options)
		{
			options[newname] = options[rename];
			delete options[rename];
		}

	if (num_prev_version[0] < 4)
	{
		const skipdoms = options.skipdoms.split(',').map(s => s.trim()).filter(s => s.length !== 0);

		const old_defaults = ['accounts.google.com', 'docs.google.com', 'translate.google.com',
			'login.live.com', 'plus.google.com', 'twitter.com',
			'static.ak.facebook.com', 'www.linkedin.com', 'www.virustotal.com',
			'account.live.com', 'admin.brightcove.com', 'www.mywot.com',
			'webcache.googleusercontent.com', 'web.archive.org', 'accounts.youtube.com',
			'accounts.google.com', 'signin.ebay.com']

		// These are already handled in the new default rules
		for (let handled of old_defaults)
		{
			let find = skipdoms.indexOf(handled)
			if (find !== -1)
				skipdoms.splice(find, 1)
		}

		let actions = {whitelist: ['.*'], whitelist_path: true};

		await Rules.loaded
		for (let fqdn of skipdoms)
			await Rules.add({domain: fqdn, ...actions})

		delete options.skipdoms;


		let remove = [], parentheses_balance = 0;
		const old_remove = '\\b((?:ref|aff)\\w*|utm_\\w+|(?:merchant|programme|media)ID)|fbclid';
		for (let item of options.remove.split('|').filter(s => s.length !== 0))
		{
			if (parentheses_balance === 0)
				remove.push(item)
			else
				remove.push(remove.pop() + '|' + item);

			parentheses_balance += (item.match(/\(/g) || []).length
			parentheses_balance -= (item.match(/\)/g) || []).length
		}

		await Rules.add({domain: '*.*', remove: remove})
	}
	else if (num_prev_version[0] >= 4)
	{
		const default_rules = serialize_rules(await new Promise(load_default_rules)).map(sorted_stringify).sort();
		const current_rules = Rules.serialize().map(sorted_stringify).sort();

		for (let i = 0, j = 0; i < default_rules.length; )
		{
			if (j === current_rules.length || default_rules[i] < current_rules[j])
			{
				// NB: adding does not replace but merge with an existing rule
				Rules.add(JSON.parse(default_rules[i]));
				i++;
			}
			else if (default_rules[i] > current_rules[j])
			{
				j++;
			}
			else
				i++, j++;
		}
	}

	await browser.storage.sync.set({configuration: options});
	await Prefs.reload();

	browser.runtime.sendMessage({action: 'reload options'}).catch(() => {});
	browser.runtime.sendMessage({action: 'rules'}).catch(() => {});
}


browser.runtime.onInstalled.addListener(details =>
{
	if (details.reason === 'update')
		return upgrade_options(details.previousVersion);
});
