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


const default_actions = {'whitelist': [], 'remove': [], 'rewrite': [], 'whitelist_path': false}


function recursive_find(rules, domain_bits, path)
{
	let matches = []
	if ('actions' in rules)
		matches.push(rules.actions)

	if (domain_bits.length !== 0)
	{
		let bit = domain_bits[0]

		// wildcard domain match
		if (bit !== '.' && '.*' in rules)
			matches.push(...recursive_find(rules['.*'], domain_bits.slice(1), path))

		// normal (exact) domain match
		if (bit in rules)
			matches.push(...recursive_find(rules[bit], domain_bits.slice(1), path))
	}

	if (path === undefined)
		return matches

	// normal (regexp) path match
	let path_matches = Object.keys(rules).filter(key => !key.startsWith('.') && key !== 'actions')
										 .filter(key => path.match(new RegExp(key)))

	return path_matches.reduce((list, matching_key) => list.concat(recursive_find(rules[matching_key], [])), matches)
}


function split_suffix(hostname)
{
	if (hostname === undefined || hostname === '' || hostname === '*')
		return ['.*', '*']

	// use public domain instead of TLD
	let suffix = hostname.endsWith('.*') ? '.*' : ('.' + PublicSuffixList.get_public_suffix(hostname));
	let domain = hostname.substring(0, hostname.length - suffix.length)

	return [suffix, domain];
}


function merge_rule_actions(actions, add)
{
	for (let [key, action] of Object.entries(add))
	{
		if (!(key in actions))
			actions[key] = Array.isArray(action) ? [...action] : action;
		else if (Array.isArray(action))
			actions[key].push(...action.filter(val => !actions[key].includes(val)))
		else if (typeof action === 'boolean')
			actions[key] = actions[key] || action
	}

	return actions;
}


function find_rules(url, all_rules)
{
	let [suffix, domain] = split_suffix(url.hostname);
	let domain_bits = [suffix].concat(...domain.split('.').map(d => '.' + d).reverse(), '.');

	let aggregated = {}, action_list = recursive_find(all_rules, domain_bits, url.pathname)

	merge_rule_actions(aggregated, default_actions)
	for (let actions of action_list)
		merge_rule_actions(aggregated, actions)

	return aggregated;
}


function unserialize_rule(serialized_rule)
{
	let actions = {}
	for (let [key, default_val] of Object.entries(default_actions))
		if (serialized_rule.hasOwnProperty(key) && (
			(Array.isArray(default_val) && serialized_rule[key].length !== 0) ||
			(typeof default_val === 'boolean' && default_val !== serialized_rule[key])
		))
			actions[key] = serialized_rule[key];

	// pos is the hierarchical position in the JSON data, as the list of keys to follow from the root node
	let [suffix, domain] = split_suffix(serialized_rule.domain);
	let pos = [suffix].concat(domain.split('.').reverse().map(d => '.' + d));

	while (pos.length && pos[pos.length - 1] === '.*')
		pos.pop();

	if ('path' in serialized_rule && serialized_rule.path)
		pos.push(serialized_rule.path)

	return [pos, actions];
}


function serialize_rules(rules, serialized_rule)
{
	if (serialized_rule === undefined)
		serialized_rule = {domain: [], inherited: {...default_actions}, parents: []}

	let list = []

	if ('actions' in rules)
	{
		let obj = {...serialized_rule, ...rules.actions};
		if (serialized_rule.domain.length === 0)
			obj.domain = '*.*';
		else if (serialized_rule.domain.length === 1)
			obj.domain = '*' + serialized_rule.domain[0];
		else
			obj.domain = serialized_rule.domain.join('').substr(1) // remove leding .
		if (!('path' in obj)) obj.path = ''
		list.push(obj)

		// Add the actions to the set of inherited actions to pass on to the children
		serialized_rule.inherited = Object.assign({}, serialized_rule.inherited)
		for (let [key, value] of Object.entries(rules.actions))
		{
			if (Array.isArray(value))
				serialized_rule.inherited[key] = serialized_rule.inherited[key].concat(value)
			else if (typeof value === 'boolean')
				serialized_rule.inherited[key] = serialized_rule.inherited[key] || value
		}
		serialized_rule.parents = [obj].concat(serialized_rule.parents)
	}

	for (let [key, value] of Object.entries(rules))
	{
		if (key[0] === '.')
			list.push(...serialize_rules(value, {...serialized_rule, domain: [key].concat(serialized_rule.domain)}))
		else if (key !== 'actions')
			list.push(...serialize_rules(value, {...serialized_rule, path: key}))
	}

	return list
}


function pop_rule(all_rules, serialized_rule)
{
	let [keys, expected_actions] = unserialize_rule(serialized_rule)

	let node = all_rules, stack = [];
	for (let key of keys)
	{
		if (!(key in node))
			return;
		else
		{
			stack.push([node, key])
			node = node[key]
		}
	}

	// keep actions and backtrack removing all empty nodes
	let found_actions = {...node.actions}
	delete node.actions;

	while (stack.length !== 0 && Object.entries(node).length === 0)
	{
		let [parent_node, key] = stack.pop()
		delete parent_node[key]

		node = parent_node;
	}

	// return actions that were found but not expected
	for (let [action, expected_value] of Object.entries(expected_actions))
	{
		if (!(action in found_actions))
			continue;
		else if (Array.isArray(expected_value))
			found_actions[action] = found_actions[action].filter(x => !expected_value.includes(x));
		else if (typeof expected_value === 'boolean')
		{
			if (expected_value === found_actions[action])
				delete found_actions[action];
		}
	}

	return found_actions;
}


function push_rule(all_rules, serialized_rule)
{
	let [keys, actions] = unserialize_rule(serialized_rule)

	let node = all_rules;
	for (let key of keys)
	{
		if (!(key in node))
			node[key] = {}

		node = node[key]
	}

	if (!('actions' in node))
		node.actions = {...actions}
	else
		node.actions = merge_rule_actions(node.actions, actions)
}


function rule_exists(all_rules, serialized_rule)
{
	let [keys, actions] = unserialize_rule(serialized_rule)

	let node = all_rules;
	for (let key of keys)
	{
		if (!(key in node))
			return false;

		node = node[key]
	}

	return 'actions' in node;
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
			PublicSuffixList.loaded.then(() => done(rules));
		})
	})
}


function load_rules()
{
	return new Promise(done =>
	{
		let cached = browser.storage.sync.get({'rules': null})
		cached.then(data =>
		{
			if (data.rules)
				PublicSuffixList.loaded.then(() => done(data.rules));
			else
				load_default_rules(done);
		})
	});
}


let Rules = {
	all_rules: {},
	find: url => find_rules(url, Rules.all_rules),
	serialize: () => serialize_rules(Rules.all_rules),
	add: (new_rule) =>
	{
		push_rule(Rules.all_rules, new_rule)
		return save_rules(Rules.all_rules)
	},
	remove: (old_rule) =>
	{
		pop_rule(Rules.all_rules, old_rule)
		return save_rules(Rules.all_rules)
	},
	exists: (rule) =>
	{
		return rule_exists(Rules.all_rules, rule);
	},
	update: (old_rule, new_rule) =>
	{
		let found = pop_rule(Rules.all_rules, old_rule)
		merge_rule_actions(new_rule, found)
		push_rule(Rules.all_rules, new_rule)
		return save_rules(Rules.all_rules)
	},
	reload: () => load_rules().then(loaded => Rules.all_rules = loaded),
	replace: new_data => clear_rules().then(() =>
	{
		Rules.all_rules = new_data;
		return save_rules(Rules.all_rules);
	}),
	reset: () => clear_rules().then(() => load_rules().then(loaded => Rules.all_rules = loaded)),
}
Rules.loaded = Rules.reload()
