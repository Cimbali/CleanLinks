module.exports = config => Object.assign(config,
{
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
		'tests/setup.js',

		// Source
		'addon/cleanlink.js',

		// Tests
		'tests/*.test.js'
	],

	reporters: ['dots'],
	colors: true,
	logLevel: config.LOG_INFO,
	autoWatch: false,
	browsers: ['FirefoxHeadless'],
	singleRun: true,
	concurrency: Infinity,
});
