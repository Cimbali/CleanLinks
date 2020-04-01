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

	if (android)
	{
		browser.browserAction.setTitle({tabId: tab_id, title: badge_title});
		browser.browserAction.setPopup({tabId: tab_id, popup: browser.runtime.getURL(`/pages/popup.html?tab=${tab_id}`)});
	}
	else
	{
		browser.browserAction.setBadgeText({tabId: tab_id, text: badge_text});
		browser.browserAction.setIcon(
		{
			path:
			{
				16: browser.runtime.getURL('/icons/16' + (enabled ? '' : '-off') + '.png'),
				32: browser.runtime.getURL('/icons/32' + (enabled ? '' : '-off') + '.png')
			},
			tabId: tab_id
		})
	}
}


function clean_redirect_headers({ documentUrl, originUrl, responseHeaders, statusCode, tabId, url })
{
	if (30 !== parseInt(statusCode / 10) || 304 === statusCode)
		return {};

	let loc = responseHeaders.find(element => element.name.toLowerCase() === 'location')
	if (!loc || !loc.value)
		return {};

	if (disabled_tabs.is_disabled(tabId))
		return {}

	const link = new URL(loc.value, url), { cleaned_link } = clean_link(link);

	if (!cleaned_link)
		return {};

	let cleaning_notif = { action: 'notify', url: cleaned_link, orig: link.href, type: 'header', tab_id: tabId };

	if (originUrl && cleaned_link.href === new URL(originUrl).href ||
			originUrl !== documentUrl && cleaned_link.href === new URL(documentUrl).href)
	{
		/* Risking an infinite loop of redirects here.
		 * Try it once (i.e. it's not in history yet), but if we already tried then allow it. */
		if (cleaned_per_tab.get(tabId).history.some(historic_message =>
			Object.keys(cleaning_notif).every(key => cleaning_notif[key] === historic_message[key])
		))
		{
			log(`Avoiding circular redirect ${link.href} -> ${originUrl}` );
			return {};
		}
	}

	handle_message(cleaning_notif);
	return { redirectUrl: cleaned_link.href };
}


function on_request({ documentUrl, frameAncestors, frameId, tabId, type, originUrl, url })
{
	if (!Prefs.values.httpall && frameId !== 0)
	{
		log('CleanLinks enabled only for top-level requests');
		return {};
	}

	if (disabled_tabs.is_disabled(tabId))
	{
		log('Disabled CleanLinks for tab ' + tabId);
		return {}
	}

	const current_url = (documentUrl || originUrl) ? new URL(documentUrl || originUrl) : {};
	const link = new URL(url, current_url.href);

	const url_pos = temporary_whitelist.indexOf(link.href);
	if (url_pos !== -1)
	{
		log('One-time whitelist for ' + JSON.stringify(link));
		temporary_whitelist.splice(url_pos, 1);
		return {};
	}

	const { cleaned_link, nesting } = clean_link(link);

	if (!cleaned_link)
		return {};

	// Check whether we have found an embedded link that is the current document
	const contains_parent_url = nesting !== 0 &&
								(cleaned_link.host + cleaned_link.pathname) === (current_url.host + current_url.pathname);


	let cleaning_notif = { action: 'notify', url: cleaned_link.href, orig: link.href, tab_id: tabId };
	if (type === 'main_frame')
		cleaning_notif.type = 'clicked';
	// Google opens some-tab redirects in an iframe in the current document, so simple redirection is not enough.
	// We need to cancel this request and direct the current tab to the cleaned destination URL.
	else if (link.hostname.startsWith('www.google.') && link.pathname.startsWith('/url'))
		cleaning_notif.type = 'promoted';
	else
		cleaning_notif.type = 'request';

	// Prevent frame/script/etc. redirections back to top-level document (see 182e58e)
	if (contains_parent_url && type !== 'main_frame')
	{
		handle_message({dropped: true, ...cleaning_notif});
		return {cancel: true};
	}

	// Allowed requests when destination is self, to protect against infinite loops (see 42106fd).
	else if (cleaned_link.href === current_url.href)
		return {}


	handle_message(cleaning_notif);

	if (cleaning_notif.type === 'promoted')
	{
		handle_message({
			action: 'open url',
			link: cleaned_link.href,
			target: same_tab,
			tab_id: tabId
		})
		return {cancel: true}
	}
	else
		return {redirectUrl: cleaned_link.href};
}


function handle_message(message, sender)
{
	log('received message', message)

	let tab_id = browser.tabs.TAB_ID_NONE;
	if ('tab_id' in message)
		tab_id = message.tab_id;
	else if (sender !== undefined && 'tab' in sender)
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
			hist.push({...message});
			if (hist.length > 100)
				hist.splice(0, hist.length - 100);
		}

		cleaned_per_tab.get(tab_id).count += 1;

		if (Prefs.values.show_clean_count && tab_id !== -1)
			update_action(tab_id);

		if (Prefs.values.highlight && tab_id !== -1, message.orig)
		{
			let orig_tab = tab_id;
			if (cleaned_per_tab.get(orig_tab).pending_highlight !== message.orig)
				[orig_tab, ] = Object.entries(cleaned_per_tab).find(([tab, data]) =>
									typeof data !== 'function' && data.pending_highlight === message.orig
								) || [];

			if (orig_tab !== undefined)
			{
				cleaned_per_tab.get(orig_tab).pending_highlight = null;
				return browser.tabs.sendMessage(parseInt(orig_tab), {action: 'highlight'}).catch(() => {})
			}
		}

		// if the message was not broadcasted, do so (we won’t get it here) to alert open popups
		if (sender === undefined)
			browser.runtime.sendMessage(message).catch(() => {})

		return Promise.resolve({});

	case 'open bypass':
		temporary_whitelist.push(new URL(message.link).href);
		return Promise.resolve({});

	case 'open url':
		if (message.target === new_window)
			return browser.windows.create({ url: message.link });
		else if (message.target === new_tab)
		{
			const extra = browser_version > 57 ? { openerTabId: tab_id } : {};
			browser.tabs.create({...extra, url: message.link, active: Prefs.values.switch_to_tab })
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
			else if (changes.textcl !== 0)
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
		prepopulate_link = message.link;
		return Promise.resolve({});

	case 'get prepopulate':
		if (prepopulate_link)
		{
			let link = prepopulate_link;
			prepopulate_link = undefined;
			return Promise.resolve({ link });
		}
		else
			return Promise.resolve({})

	default:
		return Promise.reject('Unexpected message: ' + String(message));
	}
}


function copy_clean_link({ linkUrl, selectionText }, { url })
{
	let link = linkUrl || selectionText;
	if (!link)
		return;

	try
	{
		link = extract_javascript_link(link, url) || new URL(link, url);
	}
	catch (e)
	{
		return;
	}

	// Clean & copy
	const { cleaned_link } = clean_link(link);
	navigator.clipboard.writeText(cleaned_link ? cleaned_link.href : link.href);
}


Promise.all([Prefs.loaded, Rules.loaded, ...load_metadata()]).then(() =>
{
	browser.runtime.onMessage.addListener(handle_message);
	browser.webRequest.onBeforeRequest.addListener(on_request, { urls: ['<all_urls>'] }, ['blocking']);

	if (Prefs.values.progltr)
		browser.webRequest.onHeadersReceived.addListener(clean_redirect_headers, { urls: ['<all_urls>'] },
														 ['blocking', 'responseHeaders']);

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
	browser.contextMenus.onClicked.addListener(copy_clean_link);

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
}


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
		// fetch the default rules from before the upgrade, from storage if version is 4.1.x otherwise from the web
		const old_storage = await browser.storage.sync.get({'default_rules': null});
		let get_old_rules;

		if (old_storage.default_rules)
			get_old_rules = Promise.resolve(old_storage.default_rules);
		else
		{
			const previous_rules_url = `https://github.com/Cimbali/CleanLinks/raw/v${prev_version}/addon/data/rules.json`;
			get_old_rules = fetch(new Request(previous_rules_url)).then(r => r.text()).then(data => JSON.parse(data));
		}

		// fall back to the user’s current rules
		let fallback = false;
		get_old_rules.catch(() =>
		{
			fallback = true;
			return Rules.all_rules;
		});

		// serialize deterministically both the previous rules and the new default rules
		const old_defaults = serialize_rules(await get_old_rules).map(sorted_stringify).sort();
		const new_defaults = serialize_rules(await load_default_rules()).map(sorted_stringify).sort();

		let i = 0, j = 0;
		while (i < new_defaults.length)
		{
			if (j === old_defaults.length || new_defaults[i] < old_defaults[j])
			{
				// NB: adding does not replace but merge with an existing rule
				Rules.add(JSON.parse(new_defaults[i]));
				i++;
			}
			else if (new_defaults[i] > old_defaults[j])
			{
				// NB: removing only removes the parameters passed in, not additional ones
				if (!fallback)
					Rules.remove(JSON.parse(old_defaults[j]));
				j++;
			}
			else
				i++, j++;
		}

		while (!fallback && j < old_defaults.length)
		{
			Rules.remove(JSON.parse(old_defaults[j]));
			j++;
		}
	}

	await load_default_rules().then(data => browser.storage.sync.set({default_rules: data}));
	await browser.storage.sync.set({configuration: options});
	await Prefs.reload();

	browser.runtime.sendMessage({action: 'reload options'}).catch(() => {});
	browser.runtime.sendMessage({action: 'rules'}).catch(() => {});
}


browser.runtime.onInstalled.addListener(({ reason, previousVersion }) =>
{
	if (reason === 'update')
		return upgrade_options(previousVersion);
	else if (reason === 'install')
		load_default_rules().then(data => browser.storage.sync.set({default_rules: data}));
});
