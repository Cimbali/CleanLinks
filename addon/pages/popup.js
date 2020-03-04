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

var tab_id = -1;

function set_selected(evt)
{
	var selected = document.querySelector('#history .selected');
	if (selected) selected.classList.remove('selected');

	var target = evt.target;
	while (target && target.tagName != 'P')
		target = target.parentNode;

	if (target) target.classList.add('selected');
	document.querySelector('#openonce').disabled = !target;
}


function add_option(orig, clean, classes)
{
	var history = document.querySelector('#history');

	var option = document.createElement('p');
	option.setAttribute('value', '' + history.querySelectorAll('p').length);
	option.setAttribute('title', orig + '\n-> ' + clean);
	classes.forEach(cl => option.classList.add(cl));

	var span = document.createElement('span');
	span.append(document.createTextNode(orig))
	span.setAttribute('class', 'original');
	option.appendChild(span);

	span = document.createElement('span');
	span.append(document.createTextNode(clean))
	span.setAttribute('class', 'cleaned');
	option.appendChild(span);

	option.onclick = set_selected

	history.appendChild(option);
}


function filter_from_input(input)
{
	var opts = Array.from(document.querySelectorAll('#history p.' + input.name));
	var displ = input.checked ? 'block' : 'none';
	opts.forEach(opt => opt.style.display = displ);
}


function populate_popup()
{
	document.querySelector('#title').prepend(document.createTextNode(title + ' v' + version));
	document.querySelector('#homepage').setAttribute('href', homepage);
	document.querySelector('#homepage').setAttribute('title', title + ' homepage');

	browser.tabs.query({active: true, currentWindow: true}).then(tabList =>
	{
		tab_id = tabList[0].id;
		browser.runtime.sendMessage({action: 'cleaned list', tab_id: tab_id}).then(response =>
		{
			response.forEach(clean => add_option(clean.orig, clean.url,
												'dropped' in clean ? ['dropped', clean.type] : [clean.type]));

			Array.from(document.querySelectorAll('#filters input')).forEach(input =>
			{
				filter_from_input(input);
				input.onchange = () => filter_from_input(input)
			});
		});
	});

	if (!prefValues.cltrack) document.querySelector('#history').classList.add('disabled')
	document.querySelector('button#whitelist').disabled = !prefValues.cltrack;
	document.querySelector('button#clearlist').disabled = !prefValues.cltrack;

	browser.tabs.query({active: true, currentWindow: true}).then(tabList =>
	{
		let tab_id = tabList[0].id;
		browser.runtime.sendMessage({action: 'check tab enabled', tab_id: tab_id}).then(answer =>
		{
			document.querySelector('input#enabled').checked = answer.enabled;
		})

		document.querySelector('#toggle').onclick = () =>
		{
			browser.runtime.sendMessage({action: 'toggle', tab_id: tab_id});
			document.querySelector('input#enabled').checked = !document.querySelector('input#enabled').checked;
		}
	});

	document.querySelector('#whitelist').onclick = () =>
	{
		var selected = document.querySelector('#history p.selected');
		var id = parseInt(selected.getAttribute('value'));
		browser.runtime.sendMessage({action: 'whitelist', item: id, tab_id: tab_id});
		// remove selected element, and renumber remaining ones (should be in sendMessage.then())
		selected.remove();
		document.querySelectorAll('#history p').forEach((opt, idx) => { opt.setAttribute('value', '' + idx) });
	}

	document.querySelector('#clearlist').onclick = () =>
	{
		browser.runtime.sendMessage({action: 'clearlist', tab_id: tab_id});
		// remove cleared (all) elements (should be in sendMessage.then())
		document.querySelectorAll('#history p').forEach(opt => { opt.remove() });
	}

	document.querySelector('#openonce').onclick = () =>
	{
		var selected = document.querySelector('#history .selected');
		if (selected)
			browser.runtime.sendMessage({action: 'open bypass', tab_id: tab_id, target: same_tab,
										 link: selected.childNodes[0].innerText});
	}

	document.querySelector('#options').onclick = () =>
	{
		browser.runtime.openOptionsPage();
		window.close();
	}

	document.addEventListener('copy', e =>
	{
		var selected = document.querySelector('#history .selected');

		if (selected)
		{
			e.clipboardData.setData('text/plain', selected.childNodes[0].innerText + '\n' + selected.childNodes[1].innerText);
			e.preventDefault();
		}
	});
}

apply_i18n()
loadOptions().then(() => populate_popup());
