let so_login = new URL("https://stackoverflow.com/users/login?ssrc=head&returnurl=https%3a%2f%2fstackoverflow.com%2f")
let google_search = new URL("https://www.google.com/search?client=firefox-b-ab&q=some+search+terms")
let amazon_url = new URL("https://www.amazon.es/gp/product/B06Y1VKRXJ/ref=ppx_od_dt_b_asin_title_s00?ie=UTF8&psc=1")
let cdn9gag_url = new URL("https://comment-cdn.9gag.com/v1/cacheable/comment-list.json?appId=a_dd8f2b7d304a10edaf6f29517ea0ca4100a43d1b&url=http:%2F%2F9gag.com%2Fgag%2FaY7v84w&count=10&order=score")
let wayback = new URL('https://web.archive.org/web/20200304112831/http://www.google.com/#spf=1583321325361')


describe('find_rules', function() {
	it('should return correct "returnurl" whitelist for SO login', () =>
		Rules.loaded.then(() =>
		{
			let result = Rules.find(so_login)
			expect(result.whitelist).to.have.members(['returnurl'])
		})
	);
	it('should return correct "q" whitelist for google search', () =>
		Rules.loaded.then(() =>
		{
			let result = Rules.find(google_search)
			expect(result.whitelist).to.have.members(['q'])
		})
	);
	it('should return correct pathname rewrite for amazon product pages', () =>
		Rules.loaded.then(() =>
		{
			let result = Rules.find(amazon_url)
			expect(result.rewrite).to.deep.equal([{search: '/ref=[^/]*', replace: '', flags: ''}])
		})
	);
	it('should return correct whitelist and removing for 9gag CDN pages', () =>
		Rules.loaded.then(() =>
		{
			let result = Rules.find(cdn9gag_url)
			expect(result.whitelist).to.have.members(['url', 'ref'])
		})
	);
	it('should return correct whitelist and removing for 9gag CDN pages', () =>
		Rules.loaded.then(() =>
		{
			let result = Rules.find(wayback)
			expect(result.whitelist_path).to.equal(true)
		})
	);
});

describe('Rules', function() {
	it('should return correct find rules', () =>
		Rules.loaded.then(async () =>
		{
			let url = new URL('https://addons.mozilla.org/en-GB-firefox/addon/clean-links-webext/reviews?score=5');
			let serialized_rule = {domain: url.host, path: '^' + url.pathname + '$', whitelist_path: true};

			expect(Rules.exists(serialized_rule)).to.equal(false)
			Rules.add(serialized_rule)
			expect(Rules.exists(serialized_rule)).to.equal(true)

			await Rules.reload()

			expect(Rules.exists(serialized_rule)).to.equal(true)
			Rules.remove(serialized_rule)
			expect(Rules.exists(serialized_rule)).to.equal(false)

			await Rules.reload()

			expect(Rules.exists(serialized_rule)).to.equal(false)
		})
	);
});
