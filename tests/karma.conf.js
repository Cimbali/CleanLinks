module.exports = config => Object.assign(config,
{
	basePath: '../addon/',
	frameworks: [
		'mocha',
		'chai',
		'sinon-chrome'
	],

	plugins: [
		'karma-firefox-launcher',
		'karma-mocha',
		'karma-chai',
		'karma-sinon-chrome'
	],

	files: [
		// Help setup shim environments
		'../tests/setup.js',

		// The files to be tested have to be served
		"modules/prefs.js",
		"modules/punycode.js",
		"modules/publicsuffixlist.js",
		"modules/rules.js",
		"modules/cleanlink.js",
		"inject.js",

		{type: 'css', included: false, served: true, nocache: true, pattern: "data/*"},

		// The tests, finally
		'../tests/*.test.js',
	],

	proxies: {
		'/modules/': 'http://localhost:9876/base/modules/',
		'/icons/': 'http://localhost:9876/base/icons/',
		'/data/': 'http://localhost:9876/base/data/',
	},

	reporters: ['progress'],
	colors: true,
	restartOnFileChange: true,
	logLevel: config.LOG_INFO,
	autoWatch: true,
	browsers: ['FirefoxHeadless'],
	singleRun: false,
	concurrency: Infinity,
});
