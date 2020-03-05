describe('clean_link', function() {
	it('should clean the link to the target in path', () =>
		Rules.loaded.then(() => expect(clean_link('http://www.foobar.com/track=ftp://gnu.org'))
			.to.equal('ftp://gnu.org/')
		)
	);
	it('should clean the link to the base 64 encoded URL', () =>
		Rules.loaded.then(() => expect(clean_link('http://example.com/aHR0cDovL3d3dy5nb29nbGUuY29t?arg=val'))
			.to.equal('http://www.google.com/')
		)
	);
	it('should clean the link to the URL-encoded URL in parameters', () =>
		Rules.loaded.then(() => expect(clean_link('https://l.messenger.com/l.php?u=https%3A%2F%2Fwww.airbnb.co.uk%2Frooms%2F123456789&h=ATO7e0WkmJSY2jU_U6fyz6-MmwWZvfV4NAQwuaK1aB9QwmXdOZuHbPceKl8FCqHYTbEpoSWufsOmj36S4K0DI6BLpuIyGoRK_OcE5UHyPnY'))
			.to.equal('https://www.airbnb.co.uk/rooms/123456789')
		)
	);
	it('should clean the link to the Doubly encoded URL in path and parameters', () =>
		Rules.loaded.then(() => expect(clean_link('http://two.level.redir.ect/https%3A%2F%2Fl.messenger.com%2Fl.php%3Fu%3Dhttps%253A%252F%252Fwww.airbnb.co.uk%252Frooms%252F123456789%26h%3DATO7e0WkmJSY2jU_U6fyz6-MmwWZvfV4NAQwuaK1aB9QwmXdOZuHbPceKl8FCqHYTbEpoSWufsOmj36S4K0DI6BLpuIyGoRK_OcE5UHyPnY'))
			.to.equal('https://www.airbnb.co.uk/rooms/123456789')
		)
	);
	it('should preserve a link without redirects', () =>
	{
		let link = 'https://assets-cdn.github.com/assets/frameworks-95aff0b550d3fe338b645a4deebdcb1b.css?arg=val&ref=stuff#hashtag'
		return Rules.loaded.then(() => expect(clean_link(link)).to.equal(link));
	});
	it('should identify a www-link in a path component', () =>
	{
		let link = 'https://www.laas.fr/public/sites/www.laas.fr.public/files/logos/LAAS-2016.png'
		return Rules.loaded.then(() => expect(clean_link(link)).to.equal('https://www.laas.fr.public/files/logos/LAAS-2016.png'));
	});
	it('should manage fb mobile URLs with all the path in the hash', () =>
	{
		let link = 'https://m.facebook.com/home.php#!/photo.php?fbid=1234567890&id=1234567890&set=a.1234567890&source=1234567890&refid=1234567890&_ft_=qid.1234567890%1234567890Amf_story_key.1234567890%1234567890Aog_action_id.1234567890%1234567890Atop_level_post_id.1234567890%1234567890Asrc.1234567890%1234567890Aphoto_id.1234567890&__tn__=EH-R'
		return Rules.loaded.then(() => expect(clean_link(link)).to.equal(link));
	});
	it('should keep valid encoded characters in cleaned links', () =>
	{
		let link ='https://www.google.com/url?sa=t&rct=j&url=https%3A%2F%2Fzh.wikipedia.org%2Fzh%2F%25E6%25B1%2589%25E8%25AF%25AD&source=web'
		return Rules.loaded.then(() => expect(clean_link(link)).to.equal('https://zh.wikipedia.org/zh/%E6%B1%89%E8%AF%AD'))
	});
	it('should keep valid ~username in cleaned links', () =>
	{
		let link ='https://www.google.com/url?url=https%3A%2F%2Fwww.mcs.anl.gov%2F~zhenxie%2Farchive%2FLetterANL%2Fletter.html'
		return Rules.loaded.then(() => expect(clean_link(link))
			.to.equal('https://www.mcs.anl.gov/~zhenxie/archive/LetterANL/letter.html')
		)
	});
	it('should detect unencoded embedded URLs', () =>
		Rules.loaded.then(() => expect(clean_link('https://forum.donanimhaber.com/externallinkredirect?url=https://www.amazon.com.tr/HP-6MQ72EA-Intel-Diz%C3%BCst%C3%BC-Bilgisayar/dp/B07PYT39WV/ref=sr_1_19?fst=as%3Aoff&sr=1-19'))
			.to.equal('https://www.amazon.com.tr/HP-6MQ72EA-Intel-Diz%C3%BCst%C3%BC-Bilgisayar/dp/B07PYT39WV?fst=as%3Aoff')
		)
	);
	it('should detect and decode partially encoded URLs', () =>
		Rules.loaded.then(() => expect(clean_link('https://www.google.com/url?q=https://some.thing/forum/viewtopic.php%3Ft%3D4960084'))
			.to.equal('https://some.thing/forum/viewtopic.php?t=4960084')
		)
	);
	it('should manage blob links correctly', () =>
	{
		let url = 'blob:https://web.whatsapp.com/a-hash-code-here'
		return Rules.loaded.then(() => expect(clean_link(url)).to.equal(url))
	});
	it('should detect and decode partially encoded URLs', () =>
		Rules.loaded.then(() => expect(clean_link('https://www.google.com/url?q=https://www.foobar2000.org/&sa=U&ved=2ahUKEwi8l6qs2dbnAhXeDmMBHYvBCVMQFjAAegQIBhAB&usg=AOvVaw2YoonF8M2_JRbtpQrjT0dE'))
			.to.equal('https://www.foobar2000.org/')
		)
	);
	it('should detect tripadvisor obfuscated redirects', () =>
		Rules.loaded.then(() => expect(clean_link('https://www.tripadvisor.com.au/ShowUrl-a_partnerKey.1-a_url.https%3A__2F____2F__play__2E__google__2E__com__2F__store__2F__apps__2F__details__3F__id%3Dcom__2E__tripadvisor__2E__tripadvisor__26__hl%3Den__26__referrer%3Dutm__5F__download__5F__tracking%253DBrand__5F__AppPage__5F__0__5F__18034-a_urlKey.8817ea41f0fea6faa.html'))
			.to.equal('https://play.google.com/store/apps/details?id=com.tripadvisor.tripadvisor&hl=en')
		)
	);
	it('should handle disqus links', () =>
		Rules.loaded.then(() => expect(clean_link('http://disq.us/?url=http%3A%2F%2Fpjmedia.com&key=S8VoVYehsrNqwgFikU4G6A'))
			.to.equal('http://pjmedia.com/')
		)
	);
	it('should handle disqus links with %3A suffixes', () =>
		Rules.loaded.then(() => expect(clean_link('https://disq.us/url?url=https%3A%2F%2Fscholarlyoa.com%2Fpublishers%2F%3A-EibzAO-QGxTovjeNTBl4GVHW68&cuid=1072384'))
			.to.equal('https://scholarlyoa.com/publishers/')
		)
	);
	it('should succeed on ClearUrl examples', () =>
		Promise.all([
			Rules.loaded.then(() => expect(clean_link('https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.fsf.org%2Fcampaigns%2F&h=ATP1kf98S0FxqErjoW8VmdSllIp4veuH2_m1jl69sEEeLzUXbkNXrVnzRMp65r5vf21LJGTgJwR2b66m97zYJoXx951n-pr4ruS1osMvT2c9ITsplpPU37RlSqJsSgba&s=1'))
				.to.equal('https://www.fsf.org/campaigns/')
			),
			Rules.loaded.then(() => expect(clean_link('https://out.reddit.com/t3_5pq7qd?url=https%3A%2F%2Finternethealthreport.org%2Fv01%2F&token=AQAAZV6JWHBBnIcVjV1wvxVg5gKyCQQSdUhGIvuEUmdPZhxhm8kH&app_name=reddit.com'))
				.to.equal('https://internethealthreport.org/v01/')
			),
			Rules.loaded.then(() => expect(clean_link('https://steamcommunity.com/linkfilter/?url=https://getfedora.org/'))
				.to.equal('https://getfedora.org/')
			),
		])
	);
	it('should allow logging in to AWS', () =>
	{
		let url = 'https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fconsole.aws.amazon.com%2Fconsole%2Fhome%3Fstate%3DhashArgs%2523%26isauthcode%3Dtrue&client_id=arn%3Aaws%3Aiam%3A%3A015428540659%3Auser%2Fhomepage&forceMobileApp=0'

		return Rules.loaded.then(() => expect(clean_link(url)).to.equal(url))
	});
	it('should clean BBC campaign tracking parameters', () =>
		Rules.loaded.then(() => expect(clean_link('https://www.bbc.com/news/world-latin-america-45982501?ocid=socialflow_facebook&ns_source=facebook&ns_mchannel=social&ns_campaign=bbcnews'))
			.to.equal('https://www.bbc.com/news/world-latin-america-45982501')
		)
	);
	it('should handle disqus links with %3A suffixes', () =>
		Rules.loaded.then(() => expect(clean_link('https://www.google.com/url?q=https://some.thing/forum/viewtopic.php%3Ft%3D4960084'))
			.to.equal('https://some.thing/forum/viewtopic.php?t=4960084')
		)
	);
});

describe('extract_javascript_link', function() {
	it('should clean the link to the simple javascript function argument', done =>
	{
		expect(extract_javascript_link("javascript:window.open('http://somesite.com/')")).to.equal('http://somesite.com/');
		done();
	});
	it('should clean the link to the complex javascript function argument', done =>
	{
		expect(extract_javascript_link("javascript:func(\"arg1\", 'arg2', 'http://somesite.com', 'target=\"_self\"')")).to.equal('http://somesite.com/');
		done();
	});
});

describe('extract_javascript_link + clean_link', function() {
	it('should clean the link to the javascript function relative path argument', () =>
	{
		let rel_url = "javascript:displayWindowzdjecie('/_misc/zdj_wym.php?url_zdjecie=https://static2.s-trojmiasto.pl/zdj/c/n/9/2079/1100x0/2079199-Wizualizacja-obrotowej-kladki-Sw-Ducha.jpg',1100,778);";
		let unjs_url = extract_javascript_link(rel_url, 'http://somedomain.com/a/page.html?foo=qux')
		console.log('After cleaning JS link: ' + unjs_url)
		return Rules.loaded.then(() => expect(clean_link(unjs_url)).to
			.equal('https://static2.s-trojmiasto.pl/zdj/c/n/9/2079/1100x0/2079199-Wizualizacja-obrotowej-kladki-Sw-Ducha.jpg')
		)
	});
});

describe('full clean_link functionality', function() {
	it('should strip the utm parameters', () =>
		Rules.loaded.then(() => expect(clean_link('https://www.aboutamazon.com/?keep=this&utm_source=gateway&utm_medium=footer'))
			.to.equal('https://www.aboutamazon.com/?keep=this')
		)
	);
});
