// <reference path="./node_modules/cheerio/lib/type.d.ts" />

// @ts-ignore
export = {};

// @ts-ignore
import * as cheerio from 'cheerio';


// const cheerio = require('cheerio');
const PATH = require('path');



const revertResourceDirToJoplinScheme = (htmlBody: string, resourceDir: string) => {
	const $ = cheerio.load(htmlBody);
	const anchors = [...$(`a[href^="file://${resourceDir}"]`), ...$(`a[href^="${resourceDir}"]`)];
	for (let i = 0; i < anchors.length; i++) {
		const anchor = anchors[i] as cheerio.TagElement;
		const href = anchor.attribs.href;
		const filename = PATH.basename(href);
		const newHref = `joplin_resource://${filename}`;
		anchor.attribs.href = newHref;
	}

	const imgs = [...$(`img[src^="file://${resourceDir}"]`), ...$(`img[src^="${resourceDir}"]`)];
	for (let i = 0; i < imgs.length; i++) {
		const img = imgs[i] as cheerio.TagElement;
		const src = img.attribs.src;
		const filename = PATH.basename(src);
		const newSrc = `joplin_resource://${filename}`;
		img.attribs.src = newSrc;
	}
	return $;
};

self.onmessage = function(e) {
	console.log(`work received: ${JSON.stringify(e.data, null, 2)}`);
	const newData = revertResourceDirToJoplinScheme(e.data.md, e.data.resourceDir).html();

	(self as any).postMessage(newData);
};
// # sourceMappingURL=WebWorker.js.map
