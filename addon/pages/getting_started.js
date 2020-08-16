'use strict';

function update_progress()
{
	for (const div of document.querySelectorAll('.slide'))
	{
		if (window.scrollY + window.innerHeight > div.offsetTop)
		{
			div.classList.add('visible');
		} else
		{
			div.classList.remove('visible');
		}
	}

	document.getElementById('content').scroll({left: 0});

	const n = document.querySelectorAll('.slide.visible').length;
	[...document.querySelectorAll('#progress a')].forEach((elt, num) =>
	{
		if (num < n)
		{
			elt.classList.add('uncovered');
		} else
		{
			elt.classList.remove('uncovered');
		}
	})
}

const preset_choices = [
	{auto_redir: false, drop_leaks: false, clean_headers: false, httpall:  true, only_http:  true},
	{auto_redir: false, drop_leaks: false, clean_headers:  true, httpall:  true, only_http: false},
	{auto_redir:  true, drop_leaks:  true, clean_headers:  true, httpall:  true, only_http: false},
];

const preset_slider = document.getElementById('vigor');
preset_slider.addEventListener('change', () =>
{
	const configuration = {...Prefs.values, ...preset_choices[document.getElementById('vigor').value]};
	browser.storage.sync.set({configuration}).then(() =>
	{
		browser.runtime.sendMessage({action: 'options'});
		Prefs.reload()
	})
});

for (const label of document.querySelectorAll('#vigor-display label'))
	label.addEventListener('click', evt =>
	{
		preset_slider.value = evt.target.getAttribute('value');
		preset_slider.dispatchEvent(new Event('change'));
	});

const is_update = window.location.search.indexOf('update_progress') !== -1;
for (const elt of document.querySelectorAll(is_update ? '.update_progress' : '.new-user'))
	elt.style.display = 'block';

const list = document.getElementById('progress');
for (const slide_title of document.querySelectorAll('.slide h2'))
{
	const link = list.appendChild(document.createElement('a'));
	link.textContent = slide_title.parentNode.id = slide_title.getAttribute('i18n_text');
	link.href = `#${encodeURIComponent(link.textContent)}`
}

apply_i18n();

update_progress();
window.addEventListener('scroll', update_progress)
