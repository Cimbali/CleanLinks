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

const _ = (...args) => browser.i18n.getMessage(...args) || args[0]
const attr_cleaned_count = 'data-cleanedlinks';
const attr_cleaned_link = 'data-cleanedlink';

const title = browser.runtime.getManifest().name;
const version = browser.runtime.getManifest().version;
const homepage = browser.runtime.getManifest().homepage_url;
const copyright = browser.runtime.getManifest().author;

const icon_default = '';
const icon_disabled = '-off';

const same_tab = 0;
const new_tab = 1;
const new_window = 2;


const pref_values = {
	highlight : true,                                          // highlight cleaned links
	hlstyle   : 'background:rgba(252,252,0,0.6); color: #000', // style for highlighted cleaned links
	show_clean_count: true,                                    // highlight cleaned links
	progltr   : true,                                          // http-on-examine-response: clean links on Location: redirect headers?
	httpall   : true,                                          // http capture all traffic, not just main frame
	context_menu: true,                                        // Context menus to clean links
	gotarget  : false,                                         // whether we respect target attributes on links that are being cleaned
	textcl    : true,                                          // search for & clean links in selected text
	ignhttp   : false,                                         // ignore non-http(s?) links
	cltrack   : true,                                          // whether we track the link cleaning
	switch_to_tab : true,                                      // Should be a copy of the browser preference: switch to a new tab when we open a link?
	debug     : true
}


function log()
{
	if (pref_values.debug) console.log.apply(null, arguments)
}


function apply_i18n()
{
	for (let elem of document.querySelectorAll('[i18n_text]'))
		elem.prepend(document.createTextNode(_(elem.getAttribute('i18n_text'))));

	for (let elem of document.querySelectorAll('[i18n_title]'))
		elem.setAttribute('title', _(elem.getAttribute('i18n_title')));
}


// Here only because it needs inclusion in both background and injected scripts
function extract_javascript_link(text_link, base_url)
{
	var [all, quote, cleaned_link] = text_link.match(/^(?:javascript:)?.+(["'])(.*?https?(?:\:|%3a).+?)\1/) || [];

	if (!cleaned_link)
		return null;

	log('matched javascript link: ' + cleaned_link)
	try
	{
		let url = new URL(cleaned_link, base_url)
		return cleaned_link;
	}
	catch (e)
	{
		return null;
	}
}


function serialize_options()
{
	let serialized = {};
	for (let [param, value] of Object.entries(pref_values))
	{
		if (value instanceof RegExp)
			serialized[param] = value.source;
		else if (Array.isArray(value))
			serialized[param] = value.join(',');
		else
			serialized[param] = value;
	}
	return serialized;
}


let import_domain_whitelist = undefined;

function upgrade_options(options)
{
	for (let [rename, newname] in Object.entries({'httpomr': 'httpall', 'switchToTab': 'switch_to_tab', 'cbc': 'context_menu'}))
		if (rename in options)
		{
			options[newname] = options[rename];
			delete options[rename];
		}

	if ('skipdoms' in options && import_domain_whitelist !== undefined)
	{
		const old_defaults = ['accounts.google.com', 'docs.google.com', 'translate.google.com',
			'login.live.com', 'plus.google.com', 'twitter.com',
			'static.ak.facebook.com', 'www.linkedin.com', 'www.virustotal.com',
			'account.live.com', 'admin.brightcove.com', 'www.mywot.com',
			'webcache.googleusercontent.com', 'web.archive.org', 'accounts.youtube.com',
			'accounts.google.com', 'signin.ebay.com']

		// These are already handled in the new default rules
		for (let handled of old_defaults)
		{
			let find = options.skipdoms.indexOf(handled)
			if (find !== -1)
				options.skipdoms.splice(find, 1)
		}

		let actions = {whitelist: ['.*'], whitelist_path: true};
		import_domain_whitelist(options.skipdoms.slice()).then(() =>
		{
			delete options.skipdoms;
		});
	}
}


function load_options()
{
	// return the promise so it can be chained
	return browser.storage.sync.get('configuration').then(data =>
	{
		if ('configuration' in data) {
			upgrade_options(data.configuration);

			for (var param in data.configuration) {
				if (typeof pref_values[param] === 'number')
					pref_values[param] = parseInt(data.configuration[param]);
				else if (typeof pref_values[param] === 'boolean')
				{
					pref_values[param] = data.configuration[param] === true
									|| data.configuration[param] === 'true'
									|| data.configuration[param] === 'on';
				}
				else if (typeof pref_values[param] === 'string')
					pref_values[param] = data.configuration[param] || '';
				else if (pref_values[param] instanceof RegExp)
				{
					try
					{
						pref_values[param] = new RegExp(data.configuration[param] || '.^');
					}
					catch (e)
					{
						log('Error parsing regex ' + (data.configuration[param] || '.^') + ' : ' + e.message);
					}
				}
				else if (Array.isArray(pref_values[param]))
					pref_values[param] = (data.configuration[param] || '').split(',').map(s => s.trim()).filter(s => s.length > 0);
			}
		}
		return pref_values;
	});
}

function clear_options()
{
	return browser.storage.sync.remove('configuration');
}

const Prefs = {values: pref_values, serialize: serialize_options, reload: load_options, clear: clear_options}
Prefs.loaded = Prefs.reload()
