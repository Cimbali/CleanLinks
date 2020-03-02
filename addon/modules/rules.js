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


const default_actions = {'url_ok': [], 'strip': [], 'rewrite': []}


function recursive_find(rules, keys)
{
	if (!keys.length)
		return rules

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
		return Object.keys(default_actions).reduce((rule, action) => (
			{[action]: action in rules ? rules[action] : default_actions[action], ...rule}
		), {suffix: bits[0], domain: bits[1], path: bits[2]})
	}

	return [].concat(...Object.keys(rules).map(k => serialize_rules(rules[k], bits.concat([k]))))
}


function pop_rule(all_rules, rule)
{
	let pos = all_rules, stack = [];
	for (let key of [rule.suffix, rule.domain, rule.path])
	{
		if (!(key in pos))
			return;
		else
		{
			stack.push([pos, key])
			pos = pos[key]
		}
	}

	for (let [node, key] of stack.reverse())
	{
		delete node[key]
		if (Object.keys(node).length !== 0)
			break
	}

	return all_rules
}


function push_rule(all_rules, rule)
{
	let pos = all_rules;
	for (let key of [rule.suffix, rule.domain, rule.path])
	{
		if (!(key in pos))
			pos[key] = {}

		pos = pos[key]
	}
	Object.assign(all_rules[rule.suffix][rule.domain][rule.path],
		Object.keys(default_actions).reduce((rule_actions, action) => (
		{[action]: rule[action], ...rule_actions},
	{})))
	return all_rules
}


function clear_rules()
{
	return browser.storage.sync.remove('rules');
}

function save_rules(all_rules)
{
	return browser.storage.sync.set({rules: all_rules})
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


var load_rules = new Promise(done =>
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


let Rules = {
	find: async url => {
		let rules = await load_rules
		return find_rules(url, rules)
	},
	serialize: async url => {
		let rules = await load_rules
		return serialize_rules(rules)
	},
	add: async (new_rule) => {
		let rules = await load_rules
		rules = push_rule(rules, new_rule)
		save_rules(rules)
		load_rules = Promise.resolve(rules)
	},
	remove: async (old_rule) => {
		let rules = await load_rules
		rules = pop_rule(rules, old_rule)
		save_rules(rules)
		load_rules = Promise.resolve(rules)
	},
	update: async (old_rule, new_rule) => {
		let rules = await load_rules
		pop_rule(rules, old_rule)
		rules = push_rule(rules, new_rule)
		save_rules(rules)
		load_rules = Promise.resolve(rules)
	},
	clear: clear_rules,
}
