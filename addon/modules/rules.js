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

function recursive_find(rules, keys)
{
	if (!keys.length)
	{
		console.log('Leaf: returning ' + JSON.stringify(rules))
		return rules
	}

	var search = keys.shift();

	let matches = Object.keys(rules).filter(val => val === '*' || search.match(RegExp(val)))
	return matches.reduce((acc, val) => acc.concat(recursive_find(rules[val], [...keys])), [])
}


function find_rules(url, all_rules)
{
	// use public domain instead of TLD
	var suffix = '.' + publicSuffixList.getPublicSuffix(url.hostname);
	var domain = url.hostname.substr(0, url.hostname.length - suffix.length);

	let aggregated = {}, action_list = recursive_find(all_rules, [suffix, domain, url.pathname])
	for (let actions of action_list)
		for (let key of Object.keys(actions))
			aggregated[key] = actions[key].concat(key in aggregated ? aggregated[key] : [])

	return aggregated;
}


function serialize_rules(rules, bits)
{
	if (bits === undefined)
		bits = []

	if (bits.length === 3)
	{
		let match = {suffix: bits[0], domain: bits[1], path: bits[2]}, actions = ['strip', 'rewrite', 'url_ok'];
		// return [bits.concat(['strip', 'rewrite', 'url_ok'].map(key => key in rules ? rules[key] : ''))]
		return actions.reduce((obj, act) => Object.assign({[act]: act in rules ? rules[act] : ''}, obj), match)
	}

	return [].concat(...Object.keys(rules).map(k => serialize_rules(rules[k], bits.concat([k]))))
}


const load_default_rules = (done) =>
{
	fetch(new Request(browser.runtime.getURL('/data/rules.json'))).then((response) =>
	{
		response.text().then(data =>
		{
			let rules = JSON.parse(data);
			browser.storage.sync.set({rules: rules})
			done(rules);
		})
	}).catch(err =>
	{
		console.error(err)
		console.log('Trying: ' + local_url)
		fetch(new Request(local_url)).then(populate)
	});
}


const load_rules = new Promise(done =>
{
	var cached = browser.storage.sync.get('rules')
	if (cached === undefined)
		load_default_rules(done)
	else
		cached.then(data =>
		{
			if ('rules' in data)
				done(data.rules);
			else
				load_default_rules(done);
		})
});


function clear_rules()
{
	return browser.storage.sync.remove('rules');
}


let Rules = {
	find: async url => {
		let rules = await load_rules
		return find_rules(url, rules)
	},
	serialize: async url => {
		let rules = await load_rules
		return serialize_rules(rules)
	},
	clear: clear_rules,
}
