let tests = {'publicsuffix.org': 'org', 'www.popsugar.co.uk': 'co.uk', 'www.perkins.pvt.k12.ma.us': 'pvt.k12.ma.us'}

describe('publicSuffixList.getPublicSuffix', function()
{
	Object.keys(tests).forEach(domain =>
	{
		it('should identify public domain ' + tests[domain], done =>
		{
			publicSuffixList.loaded.then(() =>
			{
				expect(publicSuffixList.getPublicSuffix(domain)).to.equal(tests[domain])
				done();
			}).catch(err => {console.error(err); done();});
		});
	});
});
