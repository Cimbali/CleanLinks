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


function split_suffix(hostname)
{
	if (hostname === undefined || hostname === '' || hostname === '*')
		return ['*', '.*']

	// use public domain instead of TLD
	let suffix = hostname.endsWith('.*') ? '.*' : ('.' + PublicSuffixList.get_public_suffix(hostname));
	let domain = hostname.substring(0, hostname.length - suffix.length)

	return [domain, suffix];
}


function url_search_keys(url)
{
	const [domain, suffix] = split_suffix(url.hostname);
	const domain_bits = [suffix, ...domain.split('.').map(d => '.' + d).reverse(), '.'];

	return [domain_bits, url.pathname];
}


function serialized_rule_keys(serialized_rule)
{
	// keys is the hierarchical position in the JSON data, as the list of keys to follow from the root node
	const [domain, suffix] = split_suffix(serialized_rule.domain);
	const keys = [suffix, ...domain.split('.').reverse().map(d => '.' + d)];

	while (keys.length && keys[keys.length - 1] === '.*')
		keys.pop();

	if ('path' in serialized_rule && serialized_rule.path)
		keys.push(serialized_rule.path)

	return keys;
}


function serialized_rule_actions(serialized_rule)
{
	const actions = {}

	for (const [key, default_val] of Object.entries(default_actions))
	{
		if (!(key in serialized_rule))
			continue;

		else if (Array.isArray(default_val) && serialized_rule[key].length !== 0)
			actions[key] = [...serialized_rule[key]];

		else if (typeof default_val === 'boolean' && default_val !== serialized_rule[key])
			actions[key] = serialized_rule[key];
	}

	return actions;
}


function merge_rule_actions(actions, add)
{
	for (const [key, action] of Object.entries(add))
	{
		// only copy valid actions
		if (!(key in default_actions))
			continue;

		else if (!(key in actions))
			actions[key] = Array.isArray(action) ? [...action] : action;

		else if (Array.isArray(action))
			// NB: n² merging
			actions[key] = actions[key].concat(action.filter(val => !actions[key].includes(val)))

		else if (typeof action === 'boolean')
			actions[key] = actions[key] || action
	}

	return actions;
}


function recursive_find(rules, domain_bits, path)
{
	const matches = []
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

	if (path !== undefined)
	{
		// normal (regexp) path match
		const path_matches = Object.keys(rules).filter(key => !key.startsWith('.') && key !== 'actions')
											   .filter(key => path.match(new RegExp(key)))

		for (const matching_key of path_matches)
			matches.push(...recursive_find(rules[matching_key], [], undefined))
	}

	return matches
}


function recursive_serialize(rules, serialized_rule, domain_bits, path)
{
	const matches = []

	if ('actions' in rules)
	{
		let rule = {...serialized_rule, ...rules.actions};
		if (serialized_rule.domain.length === 0)
			rule.domain = '*.*';
		else if (serialized_rule.domain.length === 1)
			rule.domain = '*' + serialized_rule.domain[0];
		else
			rule.domain = serialized_rule.domain.join('').substr(1) // remove leading .

		if (!('path' in rule))
			rule.path = ''

		matches.push(rule)

		// Add the actions to the set of inherited actions to pass on to the children
		serialized_rule.inherited = merge_rule_actions({...serialized_rule.inherited}, rules.actions)
		serialized_rule.parents = [{domain: rule.domain, path: rule.path, ...rules.actions}, ...serialized_rule.parents]
	}


	// No matching: recursively apply to all keys
	if (domain_bits === undefined && path === undefined)
	{
		for (const [key, value] of Object.entries(rules))
		{
			if (key[0] === '.')
				matches.push(...recursive_serialize(value, {...serialized_rule, domain: [key].concat(serialized_rule.domain)}))
			else if (key !== 'actions')
				matches.push(...recursive_serialize(value, {...serialized_rule, path: key}))
		}
	}

	// Recursive domain match
	if (domain_bits !== undefined && domain_bits.length !== 0)
	{
		const bit = domain_bits[0];

		// wildcard domain match
		if (bit !== '.' && '.*' in rules)
			matches.push(...recursive_serialize(rules['.*'], {...serialized_rule, domain: ['.*'].concat(serialized_rule.domain)},
												domain_bits.slice(1), path))

		// normal (exact) domain match
		if (bit in rules)
			matches.push(...recursive_serialize(rules[bit], {...serialized_rule, domain: [bit].concat(serialized_rule.domain)},
												domain_bits.slice(1), path))
	}

	// Recursive path match
	if (path !== undefined && path !== null)
	{
		// normal (regexp) path match
		const path_matches = Object.keys(rules).filter(key => !key.startsWith('.') && key !== 'actions')
											 .filter(key => path.match(new RegExp(key)))

		for (const matching_key of path_matches)
			matches.push(...recursive_serialize(rules[matching_key], {...serialized_rule, path: matching_key}, [], null))
	}

	return matches
}


function pop_rule(all_rules, serialized_rule)
{
	const stack = [];
	let node = all_rules;
	for (const key of serialized_rule_keys(serialized_rule))
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
	const found_actions = {...node.actions}
	delete node.actions;

	while (stack.length !== 0 && Object.entries(node).length === 0)
	{
		const [parent_node, key] = stack.pop()
		delete parent_node[key]

		node = parent_node;
	}

	// return actions that were found but not expected
	for (const [action, expected_value] of Object.entries(serialized_rule_actions(serialized_rule)))
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
	let node = all_rules;
	for (const key of serialized_rule_keys(serialized_rule))
	{
		if (!(key in node))
			node[key] = {}

		node = node[key]
	}

	if (!('actions' in node))
		node.actions = {...serialized_rule_actions(serialized_rule)}
	else
		node.actions = merge_rule_actions(node.actions, serialized_rule)
}


function rule_exists(all_rules, serialized_rule)
{
	let node = all_rules;
	for (const key of serialized_rule_keys(serialized_rule))
	{
		if (!(key in node))
			return false;

		node = node[key]
	}

	return 'actions' in node;
}


function find_rules(all_rules, url)
{
	const aggregated = merge_rule_actions({}, default_actions)

	for (const actions of recursive_find(all_rules, ...url_search_keys(url)))
		merge_rule_actions(aggregated, actions)

	return aggregated;
}


function serialize_rules(all_rules, url)
{
	const empty_serialized_rule = {domain: [], inherited: {...default_actions}, parents: []};
	const search_keys = url ? url_search_keys(url) : [];

	return recursive_serialize(all_rules, empty_serialized_rule, ...search_keys);
}


function clear_rules()
{
	return browser.storage.sync.remove('rules');
}


function save_rules(all_rules)
{
	return browser.storage.sync.set({rules: all_rules})
}


function load_default_rules(done)
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
	find: url => find_rules(Rules.all_rules, url),
	serialize: () => serialize_rules(Rules.all_rules),
	serialize_matching: url => serialize_rules(Rules.all_rules, url),
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
