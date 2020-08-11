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

const Queue = {
	chain: Promise.resolve(),
	add: callable => { Queue.chain = Queue.chain.then(callable); }
};

let unsaved_changes = false;


function update_page(options)
{
	document.querySelector('input[name="hlstyle"]').disabled = !options.highlight;
}


function check_regexp(expr, error_span)
{
	try
	{
		let r = new RegExp(expr);
		error_span.innerText = '';
		return true;
	}
	catch (e)
	{
		error_span.innerText = _('Error Processing Regular expression:') + ' ' + e.message;
		return false;
	}
}


function actions_differ(rule, orig_rule)
{
	for (const [action, val] of Object.entries(default_actions))
	{
		if (Array.isArray(val) && orig_rule[action].length !== rule[action].length)
			return true;
		else if (Array.isArray(val))
		{
			orig_rule[action].sort()
			rule[action].sort()

			if (undefined !== rule[action].find((item, idx) => item !== orig_rule[action][idx]))
				return true;
		}
		else if (orig_rule[action] !== rule[action])
			return true;
	}

	return false;
}


function save_options()
{
	let options = {}
	for (let field of Array.from(document.querySelectorAll('input')))
	{
		if (typeof Prefs.values[field.name] == 'boolean')
			options[field.name] = field.checked;
		else if (field.name in Prefs.values)
			options[field.name] = field.value;
	}

	browser.storage.sync.set({configuration: options}).then(() =>
	{
		update_page(options);

		browser.runtime.sendMessage({action: 'options'});
		Prefs.reload();
	});
}


// for onKeyUp: save after 400ms of inactivity
function delayed_save(callback)
{
	browser.alarms.onAlarm.addListener(callback);
	return function()
	{
		browser.alarms.clear('save');
		browser.alarms.create('save', {when: Date.now() + 400});
	}
}


function reset_options()
{
	// clear options storage, reload everything
	Prefs.reset().then(() =>
	{
		browser.runtime.getBackgroundPage().then(page =>
		{
			page.location.reload();
			window.location.reload();
		})
	})
}


function populate_options()
{
	const values = Prefs.serialize();
	for (const [pref, value] of Object.entries(values))
	{
		const input = document.querySelector(`[name=${pref}]`);
		if (!input)
			continue;

		if (typeof value == 'boolean')
			input.checked = value;
		else
			input.value = value;

		input.onchange = save_options
		input.onkeyup = delayed_save(save_options)
	}

	update_page(values);
}


function remove_rule_item(list, element)
{
	let selection = document.getElementById('rule_selector');
	let selected_opt = selection[selection.selectedIndex];

	let rule = JSON.parse(selected_opt.getAttribute('rule'));
	let pos = rule[list].indexOf(element);
	if (pos === -1)
		return;

	rule[list].splice(pos, 1)
	selected_opt.setAttribute('rule', sorted_stringify(rule));

	rule_changed();
}


function show_rule_item(list, element, elemtype)
{
	let span = document.createElement('span'), text = element;
	if (list === 'rewrite')
		text = element.search + ' → ' + element.replace

	span.appendChild(document.createTextNode(text));
	if (elemtype !== 'inherit')
		span.onclick = () =>
		{
			remove_rule_item(list, element)
			span.remove()
		}

	document.getElementById(`${list}_${elemtype}list`).appendChild(span)
}


function add_rule_item(list, element, replace, flags)
{
	let selection = document.getElementById('rule_selector');
	let selected_opt = selection[selection.selectedIndex];

	if (list === 'rewrite')
		element = {search: element, replace: replace, flags: flags}

	let rule = JSON.parse(selected_opt.getAttribute('rule'));
	let pos = rule[list].indexOf(element);
	if (pos === -1)
	{
		rule[list].push(element)
		selected_opt.setAttribute('rule', sorted_stringify(rule));
		show_rule_item(list, element, 'item')
	}

	return true;
}


function validate_item(list)
{
	let input_name = list !== 'rewrite' ? list + '_edit' : 'search_edit';
	let input = document.querySelector(`input[name="${input_name}"]`);
	let error_span = document.getElementById(input_name + '_error');

	if (!input.value)
	{
		error_span.innerText = _('Empty expression!');
	}
	else if (check_regexp(input.value, error_span))
	{
		let args = [input.value];
		input.value = '';

		if (list === 'rewrite')
		{
			let replace = document.querySelector('input[name="replace_edit"]');
			let flags_g = document.querySelector('input[name="rewrite_repeat"]');
			let flags_i = document.querySelector('input[name="rewrite_icase"]');

			args.push(replace.value, (flags_g.checked ? 'g' : '') + (flags_i.checked ? 'i' : ''));

			replace.value = '';
			flags_g.checked = flags_i.checked = true;
		}

		add_rule_item(list, ...args);
		rule_changed()
		document.getElementById(list + '_editor').style.display = 'none';
	}
}


function no_rule_loaded()
{
	document.querySelector('input[name="domain"]').value = '';
	document.querySelector('input[name="path"]').value = '';
	document.querySelector('input[name="subdomains"]').checked = true;
	document.querySelector('input[name="whitelist_path"]').checked = false;
	document.querySelector('input[name="allow_js"]').checked = false;

	document.querySelector('input[name="domain"]').disabled = true;
	document.querySelector('input[name="path"]').disabled = true;
	document.querySelector('input[name="subdomains"]').disabled = true;
	document.querySelector('input[name="whitelist_path"]').disabled = true;
	document.querySelector('input[name="allow_js"]').disabled = true;

	document.getElementById('remove_rule').disabled = true
}


function sorted_actions(arr, is_rewrite)
{
	const strip = s => s.replace(/[^A-Za-z0-9]+/g, '')
	const cmp_str = (a, b) => strip(a || '').localeCompare(strip(b || ''));

	if (!is_rewrite)
		return arr.slice().sort(cmp_str)

	return arr.slice().sort((a, b) =>
		cmp_str(a.search, b.search) || cmp_str(a.replace, b.replace) || cmp_str(a.flags, b.flags)
	)
}


function load_rule()
{
	for (const list of document.querySelectorAll('span.itemlist, span.inheritlist, #parents'))
		while (list.lastChild)
			list.removeChild(list.lastChild);

	const select = document.getElementById('rule_selector');
	if (select.selectedIndex === -1)
		return no_rule_loaded();

	const rule_defaults = {domain: '*.*', path: '', inherited: {...default_actions}}
	const rule = {...rule_defaults, ...JSON.parse(select[select.selectedIndex].getAttribute('rule'))}

	const subdomains = !rule.domain.startsWith('.');
	document.querySelector('input[name="domain"]').value = rule.domain.substring(subdomains ? 0 : 1)
	document.querySelector('input[name="subdomains"]').checked = subdomains;
	document.querySelector('input[name="path"]').value = rule.path;
	document.querySelector('input[name="whitelist_path"]').checked = rule.whitelist_path
	document.querySelector('input[name="allow_js"]').checked = rule.allow_js

	document.querySelector('input[name="domain"]').disabled = false;
	document.querySelector('input[name="path"]').disabled = false;
	document.querySelector('input[name="subdomains"]').disabled = false;
	document.querySelector('input[name="whitelist_path"]').disabled = false;
	document.querySelector('input[name="allow_js"]').disabled = false;

	for (const [list, action] of Object.entries(default_actions))
	{
		if (!Array.isArray(action))
			continue;

		for (const val of sorted_actions(rule[list], list === 'rewrite'))
			show_rule_item(list, val, 'item');
		for (const val of sorted_actions(rule.inherited[list], list === 'rewrite'))
			show_rule_item(list, val, 'inherit');
	}

	document.getElementById('remove_rule').disabled = false;

	if (select[select.selectedIndex].hasAttribute('orig-rule'))
		rule_pristine();

	const list = document.getElementById('parents');
	if (select[select.selectedIndex].hasAttribute('parents'))
		for (const ancestor of JSON.parse(select[select.selectedIndex].getAttribute('parents')))
			insert_parent_rule(list, name_rule(ancestor), id_rule(ancestor));

	list.appendChild(document.createElement('span')).textContent = name_rule(rule);
}


function filter_rules()
{
	const search = new RegExp(document.getElementById('rule_filter').value.replace(/\s+/, '')
								.split('').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');

	for (const opt of document.querySelectorAll('#rule_selector option'))
		opt.style.display = !search || opt.text.match(search) ? 'block' : 'none';
}


function erase_rule()
{
	let select = document.getElementById('rule_selector');
	let selected_opt = select[select.selectedIndex];

	if (selected_opt === undefined)
		return;

	if (selected_opt.hasAttribute('orig-rule'))
	{
		Rules.remove(JSON.parse(selected_opt.getAttribute('orig-rule')))
			.then(() => browser.runtime.sendMessage({action: 'rules'}));
	}

	let next_up = selected_opt.previousSibling;
	while (next_up !== null && next_up.style.display === 'none')
		next_up = next_up.previousSibling;

	if (next_up !== null)
	{
		next_up.selected = true;
		load_rule();
	}
	else
	{
		select.selectedIndex = -1;
		no_rule_loaded();
	}

	selected_opt.remove();
}


function parse_rule(select)
{
	let rule = {
		...JSON.parse(select[select.selectedIndex].getAttribute('rule')),
		...{
			domain: document.querySelector('input[name="domain"]').value || '*.*',
			path: document.querySelector('input[name="path"]').value || '',
			whitelist_path: document.querySelector('input[name="whitelist_path"]').checked,
			allow_js: document.querySelector('input[name="allow_js"]').checked,
		}
	};

	if (rule.path !== '' && !check_regexp(rule.path, document.getElementById('path_error')))
		return;

	if (!document.querySelector('input[name="subdomains"]').checked && rule.domain !== '.*')
		rule.domain = '.' + rule.domain;

	return rule
}


function rule_changed()
{
	let select = document.getElementById('rule_selector');
	if (select.selectedIndex === -1)
		return rule_pristine();

	let opt = select[select.selectedIndex];
	let rule = {...default_actions, ...parse_rule(select)};
	let orig_rule = opt.hasAttribute('orig-rule') ? {...default_actions, ...JSON.parse(opt.getAttribute('orig-rule'))} : null;
	let same_node = orig_rule && (orig_rule.domain || '*.*') === rule.domain && (orig_rule.path || '') === rule.path;

	if (!same_node && Rules.exists(rule))
		document.getElementById('rule_error').innerText = _('Rule $RULE_NAME$ already exists', name_rule(rule));
	else
		document.getElementById('rule_error').innerText = '';

	unsaved_changes = !same_node || actions_differ(rule, orig_rule || default_actions);

	document.getElementById('save_rule').disabled = !unsaved_changes;
	document.getElementById('add_rule').disabled = unsaved_changes;
}


function rule_pristine()
{
	unsaved_changes = false;
	document.getElementById('save_rule').disabled = !unsaved_changes;
	document.getElementById('add_rule').disabled = unsaved_changes;
	document.getElementById('rule_error').innerText = '';
}


function insert_rule(is_new_rule, rule)
{
	const rule_with_defaults = {...default_actions, ...rule};
	const opt = new Option(name_rule(rule_with_defaults), id_rule(rule_with_defaults), false, is_new_rule);
	opt.setAttribute('name', id_rule(rule_with_defaults))

	opt.setAttribute('rule', sorted_stringify(rule_with_defaults));
	if (!is_new_rule)
		opt.setAttribute('orig-rule', opt.getAttribute('rule'));

	if (is_new_rule || !Rules.is_default(rule))
		opt.classList.add('user-rule');
	else
		opt.classList.add('default-rule');

	if (rule !== undefined && 'parents' in rule)
		opt.setAttribute('parents', JSON.stringify(rule.parents));

	document.getElementById('rule_selector').appendChild(opt);
	load_rule();
}


function insert_parent_rule(list, name, id)
{
	const a = document.createElement('span').appendChild(document.createElement('a'));
	a.appendChild(document.createTextNode(name));
	a.href = '#';
	a.setAttribute('title', _('Edit rule $RULE_NAME$', name));
	a.onclick = () =>
	{
		document.getElementById('rule_selector').value = id;
		load_rule()
	}

	list.prepend(a.parentNode);
}


function save_rule()
{
	let select = document.getElementById('rule_selector');

	if (select.selectedIndex === -1)
		return;

	let rule = parse_rule(select);
	let selected_opt = select[select.selectedIndex];

	// Perform the update operation immediately in the DOM
	selected_opt.replaceChild(document.createTextNode(name_rule(rule)), selected_opt.firstChild);
	selected_opt.value = id_rule(rule);

	const list = document.getElementById('parents');
	document.getElementById('parents').lastChild.textContent = name_rule(rule);

	let replacing = null;
	if (selected_opt.hasAttribute('orig-rule'))
		replacing = JSON.parse(selected_opt.getAttribute('orig-rule'));

	let rule_str = sorted_stringify(rule);
	selected_opt.setAttribute('rule', rule_str);
	selected_opt.setAttribute('orig-rule', rule_str);

	rule_pristine();
	filter_rules();

	// Then the same operation [old rule -> new rule] to the rule storage, the ensure operations happen in the same order
	if (replacing === null)
		Queue.add(() => Rules.add(rule));
	else
		Queue.add(() => Rules.update(replacing, rule));
	Queue.add(() =>
	{
		populate_rules();
		browser.runtime.sendMessage({action: 'rules'}).catch(console.error);
	});
}


function import_rules()
{
	const get_json = this.files[0].text();
	return get_json.then(data => Rules.replace(JSON.parse(data))).catch(err => console.error('Error importing rules', err))
			.then(() => window.location.reload());
}


function export_rules()
{
	return Rules.loaded.then(() =>
	{
		const blob = new Blob([JSON.stringify(Rules.all_rules, null, 2)], {type : 'data:application/json;charset=utf-8'})

		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'clean_links_rules.json';
		a.click();
	})
}


function reset_rules()
{
	// clear rules storage, reload everything
	Rules.reset().then(() =>
	{
		browser.runtime.sendMessage({action: 'rules'}).then(page =>
		{
			window.location.reload();
		})
	})
}


function fetch_rule(link)
{
	let url = new URL(link);
	let rule = {...default_actions, domain: url.hostname, path: '^' + url.pathname + '$'};

	if (Rules.exists(rule))
		return { rule, exists: true }

	// gather and normalize the data for this rule
	rule.parents = Rules.serialize_matching(url).reverse();
	rule.inherited = merge_rule_actions({}, default_actions)

	for (const p of rule.parents)
	{
		delete p.parents;
		delete p.inherited;

		merge_rule_actions(rule.inherited, p)
	}

	return { rule, exists: false }
}


function handle_prepopulate({ link })
{
	if (!link)
		return;

	const { rule, exists } = fetch_rule(link);

	if (exists)
	{
		document.getElementById('rule_selector').value = id_rule(rule);
		load_rule();
	}
	else
		insert_rule(true, rule);
}


function populate_rules()
{
	const select = document.getElementById('rule_selector'), restore_selection = select.value;

	while (select.lastChild)
		select.lastChild.remove();

	for (const rule of Rules.serialize())
		insert_rule(false, rule)

	for (const list of ['remove', 'whitelist', 'rewrite'])
	{
		let editor = document.querySelector(`#${list}_editor`);
		let input_name = list !== 'rewrite' ? list + '_edit' : 'search_edit';
		let input = document.querySelector(`input[name="${input_name}"]`);

		document.getElementById(list + '_add').onclick = () =>
		{
			for (let item of document.querySelectorAll('.editor'))
				item.style.display = item.id === list + '_editor' ? 'block' : 'none';
			input.select();
		}

		input.addEventListener('keyup', e =>
		{
			if (e.key === 'Enter')
			{
				e.stopPropagation();
				e.preventDefault();
				validate_item(list);
			}
		});

		editor.querySelector('.ok').onclick = () =>
		{
			validate_item(list);
		}
		editor.querySelector('.cancel').onclick = () =>
		{
			editor.style.display = 'none';
		}

		let check_val = () => check_regexp(input.value, document.getElementById(input_name + '_error'));
		input.onchange = check_val;
		input.onkeyup = delayed_save(check_val);
	}

	filter_rules();

	if (restore_selection === '')
		no_rule_loaded();
	else
	{
		select.value = restore_selection;
		load_rule();
	}
}


function add_listeners()
{
	document.querySelector('input[name="domain"]').onchange = rule_changed
	document.querySelector('input[name="domain"]').onkeyup = delayed_save(rule_changed)
	document.querySelector('input[name="path"]').onchange = rule_changed
	document.querySelector('input[name="path"]').onkeyup = delayed_save(rule_changed)
	document.querySelector('input[name="subdomains"]').onchange = rule_changed
	document.querySelector('input[name="whitelist_path"]').onchange = rule_changed
	document.querySelector('input[name="allow_js"]').onchange = rule_changed

	document.getElementById('rule_selector').onchange = load_rule
	document.getElementById('rule_filter').onchange = filter_rules
	document.getElementById('rule_filter').onkeyup = delayed_save(filter_rules)
	document.getElementById('remove_rule').onclick = erase_rule
	document.getElementById('save_rule').onclick = save_rule
	document.getElementById('add_rule').onclick = () => insert_rule(true)

	document.querySelector('button[name="reset_options"]').onclick = reset_options;
	document.querySelector('button[name="reset_rules"]').onclick = reset_rules
	document.querySelector('button[name="export_rules"]').onclick = export_rules
	document.querySelector('button[name="import_rules"]').onclick = () => document.getElementById('import_rules').click()
	document.getElementById("import_rules").onchange = import_rules

	document.addEventListener('keyup', e =>
	{
		if (e.key === 'Escape')
			for (let item of document.querySelectorAll('.editor'))
				if (item.style.display !== 'none')
				{
					e.stopPropagation();
					e.preventDefault();
					item.style.display = 'none';
				}
	});

	document.addEventListener('beforeunload', evt =>
	{
		if (unsaved_changes)
			evt.preventDefault();
	});

	browser.runtime.onMessage.addListener(message =>
	{
		if (message.action === 'set prepopulate')
		{
			handle_prepopulate(message);
			return browser.runtime.sendMessage({action: 'get prepopulate'}).catch(() => {});
		}
		else if (message.action === 'rules')
			return Rules.reload().then(populate_rules);
		else if (message.action === 'reload options')
			return Prefs.reload().then(populate_options());
		else
			return Promise.resolve('Options page ignored unknown message ' + message.action)
	});
}


apply_i18n();
add_listeners();
Promise.all([
	Prefs.loaded.then(populate_options),
	Rules.loaded.then(populate_rules),
]).then(() => browser.runtime.sendMessage({action: 'get prepopulate'})).then(handle_prepopulate);
