'use strict';

function update() {
	for (const div of document.querySelectorAll('.slide')) {
		if (window.scrollY + window.innerHeight > div.offsetTop) {
			div.classList.add('visible');
		} else {
			div.classList.remove('visible');
		}
	}

	document.getElementById('content').scroll({left: 0});

	const n = document.querySelectorAll('.slide.visible').length;
	[...document.querySelectorAll('#progress a')].forEach((elt, num) => {
		if (num < n) {
			elt.classList.add('uncovered');
		} else {
			elt.classList.remove('uncovered');
		}
	})
}

window.addEventListener('scroll', update)
window.addEventListener('load', () => {
	if (window.location.search.indexOf('update') !== -1) {
		for (const elt of document.querySelectorAll('.update')) {
			elt.style.display = 'block';
		}
	}

	const list = document.getElementById('left').appendChild(document.createElement('p'));
	list.id = 'progress';

	for (const slide_title of document.querySelectorAll('.slide h2')) {
		slide_title.parentNode.id = slide_title.textContent;
		const link = list.appendChild(document.createElement('a'));
		link.textContent = slide_title.textContent;
		link.href = `#${encodeURIComponent(link.textContent)}`
	}

	update();
})

apply_i18n();
