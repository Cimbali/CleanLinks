let so_login = new URL("https://stackoverflow.com/users/login?ssrc=head&returnurl=https%3a%2f%2fstackoverflow.com%2f")
let google_search = new URL("https://www.google.com/search?client=firefox-b-ab&q=some+search+terms")
let amazon_url = new URL("https://www.amazon.es/gp/product/B06Y1VKRXJ/ref=ppx_od_dt_b_asin_title_s00?ie=UTF8&psc=1")
let cdn9gag_url = new URL("https://comment-cdn.9gag.com/v1/cacheable/comment-list.json?appId=a_dd8f2b7d304a10edaf6f29517ea0ca4100a43d1b&url=http:%2F%2F9gag.com%2Fgag%2FaY7v84w&count=10&order=score")


describe('find_rules', function() {
	it('should return correct "returnurl" whitelist for SO login', () =>
	{
		return load_rules.then(all_rules =>
		{
			let result = find_rules(so_login, all_rules)
			console.log(so_login.href + '\nfound: ' + JSON.stringify(result))
			expect(result.whitelist).to.have.members(['returnurl'])
		});
	});
	it('should return correct "q" whitelist for google search', () =>
	{
		return load_rules.then(all_rules =>
		{
			let result = find_rules(google_search, all_rules)
			console.log(google_search.href + '\nfound: ' + JSON.stringify(Object.keys(result)))
			expect(result.whitelist).to.have.members(['q'])
		});
	});
	it('should return correct pathname rewrite for amazon product pages', () =>
	{
		return load_rules.then(all_rules =>
		{
			let result = find_rules(amazon_url, all_rules)
			console.log(amazon_url.href + '\nfound: ' + JSON.stringify(Object.keys(result)))
			expect(result.rewrite).to.have.members(['/ref=[^/]*'])
		});
	});
	it('should return correct whitelist and removing for 9gag CDN pages', () =>
	{
		return load_rules.then(all_rules =>
		{
			let result = find_rules(cdn9gag_url, all_rules)
			console.log(cdn9gag_url.href + '\nfound: ' + JSON.stringify(Object.keys(result)))
			expect(result.whitelist).to.have.members(['url'])
		});
	});
});
