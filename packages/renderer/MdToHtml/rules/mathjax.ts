export default {

	assets: function() {
		return [
			{ name: 'mathjax_render.js' },
			{ name: 'tex-svg.js' },
		];
	},
	plugin: function(markdownIt: any) {
		const defaultRender: Function = markdownIt.renderer.rules.fence || function(tokens: any[], idx: number, options: any, env: any, self: any) {
			return self.renderToken(tokens, idx, options, env, self);
		};

		markdownIt.renderer.rules.fence = function(tokens: any[], idx: number, options: {}, env: any, self: any) {
			return defaultRender(tokens, idx, options, env, self);
		};
	},
};
